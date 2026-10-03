import { describe, expect, it } from 'vitest';
import { hash32 } from '../../src/shared/rng';
import { FLAG } from '../../src/truth/strat/column';
import { F, FACIES, NO_DEPOSIT, isAllowedTransition } from '../../src/truth/strat/facies';
import { classifyFacies } from '../../src/truth/strat/environment';
import { decodeDepth, ENV } from '../../src/truth/strat/envcode';
import { NT, T, solidOf } from '../../src/truth/strat/tracers';
import { carbonateTempFactor, shelfCarbonateRate } from '../../src/truth/strat/factory';
import { DEFAULT_STRAT } from '../../src/truth/strat/params';
import { StratSource, totalTracers } from '../../src/truth/strat/simulate';
import { carbonPulse } from '../earth/helpers';
import { EARTH_LIKE, makeWorld } from './helpers';

// One shared base world keeps the suite quick.
const base = makeWorld({ seed: 'base', nx: 16, durationMyr: 60 });

describe('mass balance', () => {
  it('every tracer: delivered − removed = what is in the columns', () => {
    const tot = totalTracers(base.world);
    const { delivered, removed } = base.world.tally;
    for (let k = 0; k < NT; k++) {
      const expected = delivered[k] - removed[k];
      const scale = Math.max(Math.abs(delivered[k]), 1e-9);
      expect(Math.abs(tot[k] - expected) / scale, `tracer ${k}`).toBeLessThan(1e-3);
    }
  });

  it('sediment routing conserves clastic mass: delivered = eroded + basement + external dust', () => {
    const w = base.world;
    const lhs = w.tally.delivered[T.clastic];
    const rhs = w.tally.removed[T.clastic] + w.tally.removed[T.ash] + w.tally.basementEroded + w.tally.external[T.clastic];
    expect(Math.abs(lhs - rhs) / lhs).toBeLessThan(1e-6);
    expect(lhs).toBeGreaterThan(0);
  });

  it('erased-interval log accounts for every metre of rock removed from the stack', () => {
    const w = base.world;
    let logged = 0;
    for (let i = 0; i < w.erased.n; i++) logged += w.erased.thickness[i];
    const removed = solidOf(w.tally.removed);
    expect(Math.abs(logged - removed) / Math.max(removed, 1)).toBeLessThan(1e-3);
  });
});

describe('columns', () => {
  it('ages get younger upward in every column', () => {
    let violations = 0, pairs = 0;
    for (const c of base.world.columns) {
      for (let i = 1; i < c.n; i++) { pairs++; if (c.ageMean[i] > c.ageMean[i - 1] + 1e-4) violations++; }
    }
    expect(pairs).toBeGreaterThan(500);
    expect(violations / pairs).toBeLessThan(0.002);
  });

  it('total solid thickness bookkeeping matches the layers', () => {
    for (const c of base.world.columns) {
      let s = 0;
      for (let i = 0; i < c.n; i++) s += c.solid[i];
      expect(Math.abs(s - c.totalSolid)).toBeLessThan(1e-2 + 1e-4 * s);
    }
  });

  it('every layer has finite, non-negative tracers', () => {
    for (const c of base.world.columns) for (let i = 0; i < c.n * NT; i++) {
      expect(Number.isFinite(c.tr[i])).toBe(true);
      if (c.tr[i] < -1e-6 && i % NT !== T.d13C_carb && i % NT !== T.d13C_org && i % NT !== T.d18O_carb && i % NT !== T.d15N) throw new Error(`negative tracer ${i % NT}`);
    }
  });
});

describe('facies successions (Walther\'s law)', () => {
  // impose a clean transgression-regression cycle: sea level rises 120 m, then falls back
  const cycle = makeWorld({
    seed: 'cycle', nx: 16, durationMyr: 40, template: 'passive-margin', baseDtYr: 200_000,
    latitude: (n) => new Float64Array(n).fill(15),
    tweakEarth: (e) => {
      const n = e.plan.n;
      for (let i = 0; i < n; i++) e.mean.seaLevel[i] = -40 + 160 * Math.sin((Math.PI * i) / n) ** 2;
    },
  });

  it('continuous successions only step between neighbouring environments', () => {
    let continuous = 0, bad = 0, drowned = 0, transitions = 0;
    for (const w of [base.world, cycle.world]) for (const c of w.columns) {
      for (let i = 1; i < c.n; i++) {
        if (c.facies[i] === c.facies[i - 1]) continue;
        transitions++;
        if (c.flags[i] & (FLAG.HIATUS | FLAG.DROWN)) { drowned++; continue; }
        continuous++;
        if (!isAllowedTransition(c.facies[i - 1], c.facies[i])) bad++;
      }
    }
    expect(continuous).toBeGreaterThan(100);
    expect(bad / continuous).toBeLessThan(0.02);
    // and the time step is fine enough that most facies changes are resolved, not condensed
    expect(drowned / transitions).toBeLessThan(0.5);
  });

  it('a sea-level cycle leaves deepening-then-shallowing sequences in the shoreline columns', () => {
    const rank = (f: number) => (f === F.fluvial || f === F.terrestrial || f === F.glacial ? 0 : f === F.deltaic || f === F.evaporite ? 1 : f === F.deepMarine ? 3 : 2);
    let sequences = 0;
    for (const c of cycle.world.columns) {
      // collapse to the sequence of distinct facies ranks
      const seq: number[] = [];
      for (let i = 0; i < c.n; i++) { const r = rank(c.facies[i]); if (seq[seq.length - 1] !== r) seq.push(r); }
      // deepening up (rank rises by ≥2 overall) followed by shallowing (rank falls by ≥1)
      let max = -1, iMax = 0;
      seq.forEach((r, i) => { if (r > max) { max = r; iMax = i; } });
      if (iMax > 0 && iMax < seq.length - 1 && max - seq[0] >= 1 && max - seq[seq.length - 1] >= 1) sequences++;
    }
    expect(sequences).toBeGreaterThanOrEqual(3);
  });

  it('shoreline columns record landward facies below seaward facies in a transgression (upward deepening)', () => {
    // for columns with both shelf and non-marine layers, the earliest transgressive contact has land below sea
    let landBelowSea = 0, seaBelowLand = 0;
    for (const c of cycle.world.columns) {
      let firstLand = -1, firstMarine = -1;
      for (let i = 0; i < c.n; i++) {
        const f = c.facies[i];
        if (firstLand < 0 && (f === F.fluvial || f === F.terrestrial)) firstLand = i;
        if (firstMarine < 0 && f >= F.deltaic && f !== F.evaporite) firstMarine = i;
      }
      if (firstLand >= 0 && firstMarine >= 0) { if (firstLand < firstMarine) landBelowSea++; else seaBelowLand++; }
    }
    expect(landBelowSea + seaBelowLand).toBeGreaterThan(0);
    expect(landBelowSea).toBeGreaterThanOrEqual(seaBelowLand);
  });
});

describe('unconformities and erosion', () => {
  // big sea-level fall in the middle of the run exposes and incises the shelf
  const fall = makeWorld({
    seed: 'fall', nx: 16, durationMyr: 40, template: 'passive-margin',
    latitude: (n) => new Float64Array(n).fill(20),
    tweakEarth: (e) => {
      const n = e.plan.n;
      for (let i = 0; i < n; i++) e.mean.seaLevel[i] = i < n / 2 ? 40 : i < n / 2 + 20 ? -160 : 40;
    },
  });

  it('exposure erodes shelf rock, logs the missing time, and the overlying beds record a hiatus', () => {
    const w = fall.world;
    expect(w.erased.n).toBeGreaterThan(5);
    let withHiatusAbove = 0, checked = 0;
    for (let e = 0; e < w.erased.n; e++) {
      const c = w.columns[w.erased.cell[e]];
      if (w.erased.thickness[e] < 1) continue;
      // find layers younger than the erased material that carry a hiatus flag
      const youngMa = w.erased.ageYoungMa[e];
      checked++;
      for (let i = 0; i < c.n; i++) if (c.ageMean[i] < youngMa - 1e-3 && c.flags[i] & FLAG.HIATUS) { withHiatusAbove++; break; }
    }
    expect(checked).toBeGreaterThan(3);
    expect(withHiatusAbove / checked).toBeGreaterThan(0.7);
  });

  it('erased intervals have sensible ages (old ≥ young, inside the simulated span)', () => {
    const w = fall.world;
    for (let e = 0; e < w.erased.n; e++) {
      expect(w.erased.ageOldMa[e]).toBeGreaterThanOrEqual(w.erased.ageYoungMa[e]);
      expect(w.erased.ageOldMa[e]).toBeLessThanOrEqual(40.01);
      expect(w.erased.stepEnd[e]).toBeGreaterThanOrEqual(w.erased.stepStart[e]);
    }
  });

  it('time is missing in the record: age gaps across HIATUS layers exceed the step length', () => {
    const w = fall.world;
    let gaps = 0;
    for (const c of w.columns) for (let i = 1; i < c.n; i++) if (c.flags[i] & FLAG.HIATUS && c.gap[i] > 0) gaps++;
    expect(gaps).toBeGreaterThan(0);
  });
});

describe('carbonate factory law', () => {
  const P = DEFAULT_STRAT;
  it('depends strongly on light (depth), temperature, saturation and mud', () => {
    const r = (d: number, T = 28, om = 1, cl = 0) => shelfCarbonateRate(P, d, carbonateTempFactor(P, T), om, cl);
    expect(r(5)).toBeGreaterThan(r(50));
    expect(r(50)).toBeGreaterThan(5 * r(120));
    expect(r(20, 28)).toBeGreaterThan(3 * r(20, -5));
    expect(r(20, 28, 1)).toBeGreaterThan(2 * r(20, 28, 0.4));
    expect(r(20, 28, 1, 0)).toBeGreaterThan(5 * r(20, 28, 1, 1.2e-4));
    expect(r(20, 28, 0)).toBe(0); // undersaturated ocean: no platform
    // a healthy tropical platform grows tens to hundreds of metres per Myr
    expect(r(10) * 1e6).toBeGreaterThan(50);
    expect(r(10) * 1e6).toBeLessThan(1000);
  });
});

describe('carbonate factory and the CCD', () => {
  /** Total shelf carbonate made (m·cells). */
  const frac = (w: ReturnType<typeof makeWorld>['world']) => {
    let carb = 0;
    for (const c of w.columns) for (let i = 0; i < c.n; i++) if (c.facies[i] === F.shelfCarbonate || c.facies[i] === F.shelfSiliciclastic) carb += c.tr[i * NT + T.caco3];
    return carb;
  };
  it('tropical shelves make more carbonate than polar shelves', () => {
    const common = { nx: 14, durationMyr: 40, template: 'passive-margin' as const, seed: 'belts', tweakEarth: (e: { mean: { seaLevel: Float64Array } }) => { e.mean.seaLevel.fill(60); } };
    const warm = makeWorld({ ...common, latitude: (n) => new Float64Array(n).fill(8) });
    const cold = makeWorld({ ...common, latitude: (n) => new Float64Array(n).fill(75) });
    // platforms fill their accommodation either way, so the world-level contrast is modest...
    expect(frac(warm.world)).toBeGreaterThan(frac(cold.world) * 1.05);
  });

  it('no pelagic carbonate accumulates below the CCD', () => {
    const w = makeWorld({ seed: 'ccd', nx: 14, durationMyr: 40, template: 'passive-margin', tweakEarth: (e) => { e.mean.ccd.fill(1500); } }).world;
    let deepLayers = 0, withCarb = 0;
    for (const c of w.columns) for (let i = 0; i < c.n; i++) {
      if (c.facies[i] !== F.deepMarine || decodeDepth(c.env[i * 4 + ENV.DEPTH]) < 1700) continue;
      deepLayers++;
      if (c.tr[i * NT + T.caco3] > 1e-6) withCarb++;
    }
    expect(deepLayers).toBeGreaterThan(5);
    expect(withCarb / deepLayers).toBeLessThan(0.02);
  });

  it('deep marine sediment above the CCD is carbonate-rich', () => {
    const w = makeWorld({ seed: 'ccd2', nx: 14, durationMyr: 40, template: 'passive-margin', tweakEarth: (e) => { e.mean.ccd.fill(6000); } }).world;
    let carb = 0, solid = 0;
    for (const c of w.columns) for (let i = 0; i < c.n; i++) if (c.facies[i] === F.deepMarine) { carb += c.tr[i * NT + T.caco3]; solid += c.solid[i]; }
    expect(carb / solid).toBeGreaterThan(0.2);
  });
});

describe('injected event layers (infrastructure for impacts, M4)', () => {
  const stepEvent = 40;
  const spike: StratSource = {
    add(step, _cell, _dt, _age, tr) {
      if (step !== stepEvent) return 0;
      tr[T.Ir] += 5e7; tr[T.spherules] += 1e4; tr[T.shockedQz] += 1e3;
      return FLAG.EVENT | FLAG.EJECTA;
    },
  };
  const w = makeWorld({ seed: 'ejecta', nx: 14, durationMyr: 40, sources: [spike], template: 'passive-margin' }).world;

  it('every cell that was depositing at the event has a flagged layer; totals conserved', () => {
    let depositing = 0, found = 0;
    const stepOf = stepEvent;
    for (let ci = 0; ci < w.columns.length; ci++) {
      if (!w.envHistory || w.envHistory[stepOf * w.nx * w.ny + ci] === NO_DEPOSIT) continue;
      depositing++;
      const c = w.columns[ci];
      for (let i = 0; i < c.n; i++) if (c.flags[i] & FLAG.EJECTA) { found++; break; }
    }
    expect(depositing).toBeGreaterThan(50);
    // the cell may later erode the layer away; require ≥ 60 % still carry it
    expect(found / depositing).toBeGreaterThan(0.6);
    const tot = totalTracers(w);
    const exp = 5e7 * depositing;
    expect(tot[T.spherules] / (1e4 * depositing)).toBeLessThanOrEqual(1.0001);
    expect(tot[T.Ir]).toBeGreaterThan(exp * 0.5);
  });
});

describe('end-to-end: a carbon-cycle event is recorded in the rock', () => {
  it('a clathrate pulse appears as a negative δ13C excursion in shelf carbonates', () => {
    const onset = 6.0;
    const { world } = makeWorld({
      seed: 'petm', nx: 12, durationMyr: 10, template: 'passive-margin', baseDtYr: 100_000,
      planet: { ...EARTH_LIKE, pCO2Ref: 500, ecs: 4 },
      windows: [
        { ageStartMa: onset, ageEndMa: onset - 0.01, dtYr: 500, tag: 1 },
        { ageStartMa: onset - 0.01, ageEndMa: onset - 0.3, dtYr: 3000, tag: 2 },
      ],
      forcing: carbonPulse(onset, 10, 4500, -60),
      latitude: (n) => new Float64Array(n).fill(12),
      tweakEarth: (e) => { e.mean.seaLevel.fill(40); },
    });
    // find the shelf carbonate column with the most layers around the event and compare δ13C before/within
    let best = -1, bestN = 0;
    world.columns.forEach((c, ci) => {
      let n = 0;
      for (let i = 0; i < c.n; i++) if (c.facies[i] === F.shelfCarbonate && Math.abs(c.ageMean[i] - onset) < 0.4) n++;
      if (n > bestN) { bestN = n; best = ci; }
    });
    expect(best).toBeGreaterThanOrEqual(0);
    const c = world.columns[best];
    const d13 = (i: number) => c.tr[i * NT + T.d13C_carb] / Math.max(c.tr[i * NT + T.caco3], 1e-12);
    let before = 0, nb = 0, min = Infinity;
    for (let i = 0; i < c.n; i++) {
      if (c.facies[i] !== F.shelfCarbonate || c.tr[i * NT + T.caco3] < 1e-6) continue;
      if (c.ageMean[i] > onset + 0.5) { before += d13(i); nb++; }
      else if (Math.abs(c.ageMean[i] - (onset - 0.01)) < 0.15) min = Math.min(min, d13(i));
    }
    expect(nb).toBeGreaterThan(0);
    expect(before / nb - min).toBeGreaterThan(1.5);
  });
});

describe('environment classifier', () => {
  const base = { clasticRate: 0, sandFrac: 0, carb: 0, clastic: 1, evap: 0, areaKm2: 10, isSink: false, humidity: 0.6, glaciated: false, shelfDepthMax: 200, riverAreaKm2: 600 };
  it('walks the shore-normal profile in the right order', () => {
    const seq = [-50, 5, 30, 80, 400].map((d) => classifyFacies({ ...base, waterDepth: d, clasticRate: d === 5 || d === 30 ? 1e-4 : 1e-6, sandFrac: 0.5 }));
    expect(seq).toEqual([F.terrestrial, F.deltaic, F.deltaic, F.shelfSiliciclastic, F.deepMarine]);
  });
  it('carbonate-dominated shelf, playa, river, glacial', () => {
    expect(classifyFacies({ ...base, waterDepth: 40, carb: 3, clastic: 0.1 })).toBe(F.shelfCarbonate);
    expect(classifyFacies({ ...base, waterDepth: -5, isSink: true, humidity: 0.1 })).toBe(F.evaporite);
    expect(classifyFacies({ ...base, waterDepth: -5, areaKm2: 5000, sandFrac: 0.4 })).toBe(F.fluvial);
    expect(classifyFacies({ ...base, waterDepth: -5, glaciated: true })).toBe(F.glacial);
  });
});

describe('determinism', () => {
  it('same seed -> identical stratigraphy', () => {
    const hash = (w: ReturnType<typeof makeWorld>['world']) => {
      let h = 0;
      for (const c of w.columns) { h = hash32(h, c.n); for (let i = 0; i < Math.min(c.n, 40); i++) h = hash32(h, c.tr[i * NT + T.clastic], c.ageMean[i], c.facies[i]); }
      return hash32(h, w.erased.n);
    };
    const a = makeWorld({ seed: 'det', nx: 10, durationMyr: 20 }).world;
    const b = makeWorld({ seed: 'det', nx: 10, durationMyr: 20 }).world;
    const c = makeWorld({ seed: 'det2', nx: 10, durationMyr: 20 }).world;
    expect(hash(a)).toBe(hash(b));
    expect(hash(a)).not.toBe(hash(c));
  });
});

void FACIES;
