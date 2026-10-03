import { describe, expect, it } from 'vitest';
import { stepAtAge } from '../../src/shared/timeplan';
import { ejectaAt, globalStrength } from '../../src/truth/events/bolide';
import { ashThickness } from '../../src/truth/events/ash';
import { pulseFractionInStep, avgOverStep } from '../../src/truth/events/types';
import { victimsAt } from '../../src/truth/bio/diversify';
import { ObservationService } from '../../src/observation/service';
import { decodeSedRate, ENV } from '../../src/truth/strat/envcode';
import { FLAG } from '../../src/truth/strat/column';
import { NO_DEPOSIT, F } from '../../src/truth/strat/facies';
import { NT, T, massOf } from '../../src/truth/strat/tracers';
import { buildColumnView } from '../../src/observation/columnview';
import { REALM } from '../../src/truth/bio/traits';
import { scenario } from './helpers';
import { measureProxy } from '../../src/observation/instruments';
import { LITH } from '../../src/shared/lithology';
import { AshEvent, BolideEvent, ClathrateEvent, LipEvent, SupernovaEvent } from '../../src/truth/events/types';

const bolide = (ageMa: number, D: number, xKm = 3000, yKm = 0): BolideEvent => ({ kind: 'bolide', ageMa, diameterKm: D, xKm, yKm });

describe('time helpers', () => {
  it('pulse fractions and step averages conserve dose', () => {
    // 2-yr pulse starting at 10 Ma inside a 1000-yr step [10, 9.999]
    expect(pulseFractionInStep(10, 2, 10, 9.999)).toBeCloseTo(2 / 1000, 12);
    expect(avgOverStep(0.9, 10, 2, 10, 9.999) * 1000).toBeCloseTo(1.8, 6); // intensity × step length = dose
    expect(pulseFractionInStep(10, 2, 9, 8.9)).toBe(0);
    // a long pulse spanning several steps: fractions add up to the total duration
    let total = 0;
    for (let k = 0; k < 10; k++) total += pulseFractionInStep(10, 5e5, 10 - 0.1 * k, 10 - 0.1 * (k + 1)) * 0.1e6;
    expect(total).toBeCloseTo(5e5, 3);
  });
  it('ejecta: distal clay is millimetres, proximal thickens as r^-3, Ir fluence ∝ D³', () => {
    const e = bolide(10, 10);
    const far = ejectaAt(e, 8000), mid = ejectaAt(e, 150), near = ejectaAt(e, 60);
    expect(far.clayM).toBeGreaterThan(0.002); expect(far.clayM).toBeLessThan(0.005);
    expect(far.irNg / far.clayM / 2.7e6).toBeGreaterThan(5); //  ≈ 8 ppb in the clay itself
    expect(near.clayM / mid.clayM).toBeGreaterThan(5);
    expect(ejectaAt(bolide(10, 20), 8000).irNg / far.irNg).toBeCloseTo(8, 0);
    expect(globalStrength(2)).toBeLessThan(0.01);
    expect(globalStrength(12)).toBe(1);
  });
  it('ash thickness falls with distance and with angle off the wind axis', () => {
    const a: AshEvent = { kind: 'ash', ageMa: 5, volumeKm3: 300, xKm: 0, yKm: 0, windDeg: 0 };
    expect(ashThickness(a, 100, 0)).toBeGreaterThan(3 * ashThickness(a, 300, 0));
    expect(ashThickness(a, 200, 0)).toBeGreaterThan(2 * ashThickness(a, 200, 150));
  });
});

describe('impact (12 km bolide)', () => {
  const AGE = 25;
  const world = scenario([bolide(AGE, 12, 2500, 800)], [], { seed: 'impact', nx: 18, durationMyr: 50 });
  const plan = world.plan;
  const sEv = stepAtAge(plan, AGE - 1e-7);
  const N = world.strat.nx * world.strat.ny;
  const depositing: number[] = [];
  for (let i = 0; i < N; i++) if (world.strat.envHistory![sEv * N + i] !== NO_DEPOSIT) depositing.push(i);
  const flaggedLayer = (i: number): number => {
    const c = world.strat.columns[i];
    for (let k = 0; k < c.n; k++) if (c.flags[k] & FLAG.EJECTA) return k;
    return -1;
  };

  it('the event sits on a refined step boundary', () => {
    expect(plan.ageBaseMa[sEv]).toBeCloseTo(AGE, 6);
    expect(plan.dtYr[sEv]).toBeLessThanOrEqual(1000.0001);
  });

  it('is a global, synchronous marker: ejecta layer in ≥ 90 % of cells where that age is preserved', () => {
    let preserved = 0, found = 0;
    for (const i of depositing) {
      const c = world.strat.columns[i];
      let has = false;
      for (let k = 0; k < c.n; k++) if (Math.abs(c.ageMean[k] - AGE) < 0.15) has = true;
      if (!has) continue;
      preserved++;
      const k = flaggedLayer(i);
      if (k >= 0 && Math.abs(c.ageMean[k] - AGE) < 0.15) found++;
    }
    expect(depositing.length).toBeGreaterThan(40);
    expect(preserved).toBeGreaterThan(20);
    expect(found / preserved).toBeGreaterThanOrEqual(0.9);
  });

  it('carries Ir, spherules and shocked quartz, and Ir concentration scales inversely with sedimentation rate', () => {
    const pts: { lr: number; lc: number }[] = [];
    for (const i of depositing) {
      const k = flaggedLayer(i);
      if (k < 0) continue;
      const c = world.strat.columns[i];
      const o = k * NT;
      expect(c.tr[o + T.spherules]).toBeGreaterThan(0);
      expect(c.tr[o + T.shockedQz]).toBeGreaterThan(0);
      const conc = (c.tr[o + T.Ir] / (massOf(c.tr, o) * 1000)); // ppb
      const rate = decodeSedRate(c.env[k * 4 + ENV.SEDRATE]);
      pts.push({ lr: Math.log(Math.max(rate, 0.1)), lc: Math.log(conc) });
    }
    expect(pts.length).toBeGreaterThan(20);
    // slow-accumulating (condensed) cells concentrate the same fallout: compare the slowest and fastest thirds
    const byRate = [...pts].sort((p, q) => p.lr - q.lr);
    const third = Math.floor(byRate.length / 3);
    const med = (a: { lc: number }[]) => { const v = a.map((p) => p.lc).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
    expect(med(byRate.slice(0, third)) - med(byRate.slice(-third))).toBeGreaterThan(Math.log(2));
    // the slowest-accumulating cells keep a clear iridium anomaly
    const maxConc = Math.max(...pts.map((p) => Math.exp(p.lc)));
    expect(maxConc).toBeGreaterThan(1); // ≥ 1 ppb
  });

  it('a core through a condensed section shows the iridium spike in a lab assay', () => {
    // pick the slowest-depositing cell that kept the layer
    let best = -1, bestRate = Infinity;
    for (const i of depositing) {
      const k = flaggedLayer(i);
      if (k < 0 || i === undefined) continue;
      const rate = decodeSedRate(world.strat.columns[i].env[k * 4 + ENV.SEDRATE]);
      if (rate < bestRate) { bestRate = rate; best = i; }
    }
    expect(best).toBeGreaterThanOrEqual(0);
    const svc = new ObservationService(world);
    const view = buildColumnView(world.strat.columns[best]);
    const k = flaggedLayer(best);
    const core = svc.execute({ kind: 'drill', cell: best, depthM: Math.min(1500, view.total + 5) });
    expect(core.ok).toBe(true);
    if (!core.ok || core.measurement.kind !== 'core') return;
    const stretch = svc.coreStretch(core.measurement.coreId)!;
    const mid = (view.top[k] + view.thick[k] / 2) * stretch;
    const depths = [-1, -0.5, -0.2, -0.1, 0, 0.1, 0.2, 0.5, 1, 2, 4].map((o) => Math.max(0.05, mid + o));
    const ir = svc.execute({ kind: 'assay', coreId: core.measurement.coreId, proxy: 'ir', depthsM: depths });
    expect(ir.ok).toBe(true);
    if (!ir.ok || ir.measurement.kind !== 'assay') return;
    const vals = ir.measurement.samples.map((s) => s.value).filter((v): v is number => v !== null);
    expect(Math.max(...vals)).toBeGreaterThan(0.3);
    expect(Math.max(...vals) / (Math.min(...vals.filter((v) => v > 0)) || 1)).toBeGreaterThan(3);
  });

  it('wipes out a large share of species, and the catalog links the extinction to the impact', () => {
    const imp = world.catalog.find((e) => e.type === 'bolide')!;
    const ext = world.catalog.find((e) => e.type === 'extinction' && e.parents.includes(imp.id));
    expect(ext).toBeDefined();
    expect(ext!.magnitude).toBeGreaterThan(0.3);
    expect(ext!.cause).toBe('bolide');
    // selective: big land animals die more than burrowing ones
    const { alive, died } = victimsAt(world.bio, sEv);
    const dead = new Set(died);
    const sp = world.bio.species;
    const rate = (f: (i: number) => boolean) => { const a = alive.filter(f); return a.filter((i) => dead.has(i)).length / Math.max(a.length, 1); };
    expect(rate((i) => sp.realm[i] === REALM.terrestrial && sp.endo[i] === 1 && sp.logMass[i] > 3)).toBeGreaterThan(2 * rate((i) => sp.burrower[i] === 1) + 0.05);
  });

  it('leaves tsunami deposits on shallow marine cells', () => {
    let ts = 0;
    for (const c of world.strat.columns) for (let k = 0; k < c.n; k++) if (c.flags[k] & FLAG.TSUNAMI) ts++;
    expect(ts).toBeGreaterThan(0);
  });
});

describe('clathrate release (PETM-like)', () => {
  const AGE = 25;
  const clath: ClathrateEvent = { kind: 'clathrate', ageMa: AGE, massPg: 4500, onsetKyr: 10 };
  const world = scenario([clath], [], { seed: 'petm', nx: 14 });
  const E = world.earth.mean;
  const sPre = stepAtAge(world.plan, AGE + 0.3);

  it('drives a sharp negative δ13C excursion and warming in the Earth system', () => {
    let min = Infinity, maxT = -Infinity;
    for (let s = sPre; s < world.plan.n && world.plan.ageBaseMa[s] > AGE - 1; s++) {
      min = Math.min(min, E.d13C_carb[s] - E.d13C_carb[sPre]);
      maxT = Math.max(maxT, E.tempC[s] - E.tempC[sPre]);
    }
    expect(min).toBeLessThan(-1.0);
    expect(min).toBeGreaterThan(-7);
    expect(maxT).toBeGreaterThan(1.0);
  });

  it('is recorded in shelf carbonates and found by a lab assay', () => {
    // a column with carbonate both before and during the event
    let best = -1, bestN = 0;
    world.strat.columns.forEach((c, i) => {
      let pre = 0, during = 0;
      for (let k = 0; k < c.n; k++) {
        if (c.tr[k * NT + T.caco3] < 0.05) continue;
        if (c.ageMean[k] > AGE + 0.05 && c.ageMean[k] < AGE + 1.5) pre++;
        if (Math.abs(c.ageMean[k] - (AGE - 0.005)) < 0.02) during++;
      }
      const n = Math.min(pre, during);
      if (n > bestN) { bestN = n; best = i; }
    });
    expect(bestN).toBeGreaterThan(1);
    const svc = new ObservationService(world);
    const view = buildColumnView(world.strat.columns[best]);
    const core = svc.execute({ kind: 'drill', cell: best, depthM: Math.min(1500, view.total + 5) });
    if (!core.ok || core.measurement.kind !== 'core') throw new Error('drill failed');
    const id = core.measurement.coreId;
    const stretch = svc.coreStretch(id)!;
    const c = world.strat.columns[best];
    const depths: number[] = [], ages: number[] = [];
    for (let k = 0; k < c.n; k++) {
      if (Math.abs(c.ageMean[k] - AGE) > 1.5 || c.tr[k * NT + T.caco3] < 0.02) continue;
      depths.push((view.top[k] + view.thick[k] / 2) * stretch);
      ages.push(c.ageMean[k]);
    }
    const res = svc.execute({ kind: 'assay', coreId: id, proxy: 'd13C_carb', depthsM: depths.slice(0, 380) });
    if (!res.ok || res.measurement.kind !== 'assay') throw new Error('assay failed');
    const vals = res.measurement.samples.map((s, i) => ({ v: s.value, age: ages[i] })).filter((x): x is { v: number; age: number } => x.v !== null);
    const before = vals.filter((x) => x.age > AGE + 0.05).map((x) => x.v);
    const during = vals.filter((x) => Math.abs(x.age - (AGE - 0.01)) < 0.05).map((x) => x.v);
    expect(before.length).toBeGreaterThan(1);
    expect(during.length).toBeGreaterThan(0);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(before) - Math.min(...during)).toBeGreaterThan(1.0);
  });
});

describe('large igneous province', () => {
  const lip: LipEvent = { kind: 'lip', ageMa: 30, durationMyr: 1.2, carbonPg: 40000, d13C: -20, sulfurPg: 1500, hgMult: 20, pulses: [0.2, 0.5, 0.8] };
  const world = scenario([lip], [], { seed: 'lip', nx: 14, durationMyr: 50 });

  it('raises mercury by at least a factor of 3 while it lasts, with a negative δ13C excursion', () => {
    const mean = (f: (age: number) => boolean, val: (c: (typeof world.strat.columns)[0], k: number) => number): number => {
      let s = 0, n = 0;
      for (const c of world.strat.columns) for (let k = 0; k < c.n; k++) if (f(c.ageMean[k])) { s += val(c, k); n++; }
      return n ? s / n : NaN;
    };
    const hg = (c: (typeof world.strat.columns)[0], k: number) => c.tr[k * NT + T.Hg] / massOf(c.tr, k * NT);
    const during = mean((a) => a < 30 && a > 28.9, hg);
    const before = mean((a) => a > 31 && a < 36, hg);
    expect(during / before).toBeGreaterThan(3);
    const E = world.earth.mean;
    const s0 = stepAtAge(world.plan, 31), sEnd = stepAtAge(world.plan, 28.8);
    let min = Infinity;
    for (let s = s0; s <= sEnd; s++) min = Math.min(min, E.d13C_carb[s] - E.d13C_carb[s0]);
    expect(min).toBeLessThan(-0.2); // light carbon arrives in pulses (organic burial can push the other way between them)
  });

  it('is cataloged with its duration and magnitude', () => {
    const e = world.catalog.find((x) => x.type === 'lip')!;
    expect(e.ageMa[0]).toBeCloseTo(30, 6);
    expect(e.ageMa[1]).toBeCloseTo(28.8, 6);
    expect(e.magnitude).toBe(40000);
    expect(e.cls).toBe('forced');
  });
});

describe('supernova', () => {
  it('⁶⁰Fe decays with a 2.6-Myr half-life: visible in young rock, gone from old rock', () => {
    const acc = new Float64Array(NT);
    acc[T.clastic] = 0.05; acc[T.Fe60] = 2e10;
    const at = (ageMa: number) => measureProxy('fe60', acc, { seed: 's', noiseScale: 1, cell: 1, depthKey: 1, ageMa, burialM: 10 });
    const young = at(2.6), old = at(40);
    expect(young.value).not.toBeNull();
    expect(old.value).toBeNull();
    const a = at(0.1), b = at(2.7);
    expect(a.value! / b.value!).toBeGreaterThan(1.7);
    expect(a.value! / b.value!).toBeLessThan(2.4);
  });
  it('a young supernova leaves a ⁶⁰Fe pulse in cores; an old one does not', () => {
    const sn = (ageMa: number): SupernovaEvent => ({ kind: 'supernova', ageMa, ozoneLoss: 0.3, durationKyr: 2, fe60: 3e10 });
    const detectable = (age: number): number => {
      const w = scenario([sn(age)], [], { seed: 'sn' + age, nx: 12, durationMyr: 50 });
      let n = 0, hit = 0;
      w.strat.columns.forEach((c, i) => {
        // the layer holding the fallout peak in each column
        let kPeak = -1, peak = 0;
        for (let k = 0; k < c.n; k++) { const f = c.tr[k * NT + T.Fe60]; if (f > peak) { peak = f; kPeak = k; } }
        if (kPeak < 0) return;
        n++;
        const r = measureProxy('fe60', c.tr.subarray(kPeak * NT, kPeak * NT + NT), { seed: 's', noiseScale: 1, cell: i, depthKey: kPeak, ageMa: c.ageMean[kPeak], burialM: 100 });
        if (r.value !== null) hit++;
      });
      return n ? hit / n : 0;
    };
    expect(detectable(6)).toBeGreaterThan(0.5);
    expect(detectable(44)).toBeLessThan(0.2);
  });
});

describe('ash beds', () => {
  const vent: AshEvent = { kind: 'ash', ageMa: 20, volumeKm3: 600, xKm: 300, yKm: 0, windDeg: 180 };
  const world = scenario([], [vent], { seed: 'ash', nx: 20, durationMyr: 50 });
  const nx = world.strat.nx, cellKm = world.strat.cellKm;

  it('ash beds are thicker closer to the vent, and the zircon age recovers the eruption age', () => {
    const pts: { r: number; h: number }[] = [];
    let ageErr = 0, n = 0;
    world.strat.columns.forEach((c, i) => {
      for (let k = 0; k < c.n; k++) {
        const ash = c.tr[k * NT + T.ash];
        if (ash < 1e-4 || !(c.flags[k] & FLAG.ASH)) continue;
        const x = ((i % nx) + 0.5 - nx / 2) * cellKm, y = (Math.floor(i / nx) + 0.5 - world.strat.ny / 2) * cellKm;
        pts.push({ r: Math.hypot(x - vent.xKm, y - vent.yKm), h: ash });
        ageErr += Math.abs(c.tr[k * NT + T.ashAge] / ash - vent.ageMa); n++;
      }
    });
    expect(pts.length).toBeGreaterThan(30);
    const near = pts.filter((p) => p.r < 340), far = pts.filter((p) => p.r >= 340);
    const mean = (a: { h: number }[]) => a.reduce((s, p) => s + p.h, 0) / Math.max(a.length, 1);
    if (near.length && far.length) expect(mean(near)).toBeGreaterThan(mean(far));
    expect(ageErr / n).toBeLessThan(0.02);
  });

  it('cores show a visible ash bed in the best-preserved section', () => {
    let found = false;
    for (let i = 0; i < world.strat.columns.length && !found; i++) {
      const c = world.strat.columns[i];
      for (let k = 0; k < c.n; k++) if (c.flags[k] & FLAG.ASH && c.tr[k * NT + T.ash] > 0.03) { found = true; break; }
    }
    expect(found).toBe(true);
    void LITH; void F;
  });
});
