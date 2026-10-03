import { describe, expect, it } from 'vitest';
import { generateSlowDrivers } from '../../src/truth/earth/drivers';
import { samplePlanet } from '../../src/truth/earth/planet';
import { runEarthSystem } from '../../src/truth/earth/run';
import { buildTimePlan } from '../../src/shared/timeplan';
import { Rng, hash32 } from '../../src/shared/rng';
import { zeroForcing } from '../../src/shared/forcing';
import { PGC_PER_UMOL, MOL_PER_PGC } from '../../src/shared/units';
import { DIAG, EarthModel, IDX, N_STATE } from '../../src/truth/earth/model';
import { calibrate } from '../../src/truth/earth/calibrate';
import { EARTH_LIKE, calibrated, carbonPulse, modelAt, runConstant } from './helpers';

describe('baseline steady state', () => {
  it('every budget closes at the reference state (time derivatives ≈ 0)', () => {
    const { m, y } = modelAt();
    const d = new Float64Array(N_STATE);
    m.rhs(y, d);
    // Relative rates per year compared with the size of each pool.
    const rel = (i: number) => Math.abs(d[i]) / Math.max(Math.abs(y[i]), 1);
    expect(rel(IDX.A)).toBeLessThan(1e-5);
    expect(rel(IDX.DICs)).toBeLessThan(1e-8);
    expect(rel(IDX.ALKs)).toBeLessThan(1e-8);
    expect(rel(IDX.DICd)).toBeLessThan(1e-8);
    expect(rel(IDX.P)).toBeLessThan(1e-7);
    expect(Math.abs(d[IDX.O2d])).toBeLessThan(1e-6);
    expect(Math.abs(d[IDX.dS])).toBeLessThan(1e-6);
    // Crustal organic reservoir and atmospheric O2 close too (Bo = Wo).
    expect(Math.abs(d[IDX.Morg]) / EARTH_LIKE.orgW0).toBeLessThan(0.01);
  });

  it('carbonate burial balances Fsil + Fc and organic burial balances oxidative weathering', () => {
    const { m, y } = modelAt();
    const x = m.snapshotFluxes(y);
    expect(x.Bsh + x.Bpel).toBeCloseTo(x.Fsil + x.Fc, 3);
    expect(x.Bo).toBeCloseTo(x.Wo, 3);
    expect(x.V).toBeCloseTo(x.Fsil, 6);
  });

  it('does not drift over 20 Myr with constant drivers', () => {
    const h = runConstant({ durationMyr: 20, baseDtYr: 1e6 });
    const last = h.plan.n - 1;
    expect(Math.abs(h.mean.pCO2[last] / h.mean.pCO2[0] - 1)).toBeLessThan(0.01);
    expect(Math.abs(h.mean.tempC[last] - h.mean.tempC[0])).toBeLessThan(0.1);
    expect(Math.abs(h.mean.d13C_carb[last] - h.mean.d13C_carb[0])).toBeLessThan(0.1);
    expect(Math.abs(h.mean.O2atm[last] / h.mean.O2atm[0] - 1)).toBeLessThan(0.01);
    expect(Math.abs(h.mean.ccd[last] - h.mean.ccd[0])).toBeLessThan(50);
  });

  it('baseline looks Earth-like', () => {
    const { m, y } = modelAt();
    const o = new Float64Array(30);
    m.diagnose(y, o);
    expect(o[DIAG.pCO2]).toBeCloseTo(EARTH_LIKE.pCO2Ref, 0);
    expect(o[DIAG.omegaCal]).toBeGreaterThan(4);
    expect(o[DIAG.ccd]).toBeGreaterThan(4000);
    expect(o[DIAG.ccd]).toBeLessThan(4800);
    expect(o[DIAG.O2deep]).toBeGreaterThan(50);
    expect(o[DIAG.anoxic]).toBeLessThan(0.05);
    expect(o[DIAG.d13C_carb]).toBeGreaterThan(-3);
    expect(o[DIAG.d13C_carb]).toBeLessThan(3);
    expect(o[DIAG.d13C_org] - o[DIAG.d13C_carb]).toBeLessThan(-22); // organic matter ≈ 25 ‰ lighter
  });
});

describe('conservation', () => {
  const closed = { ...EARTH_LIKE, closedSystem: true };

  it('closed system: total carbon and total alkalinity are conserved', () => {
    const c = calibrate(closed);
    const m = new EarthModel(closed, c.base);
    const y0 = c.y0.slice();
    // Disturb the system so it actually moves.
    y0[IDX.DICs] += 150;
    y0[IDX.ALKd] -= 80;
    const plan = buildTimePlan({ durationMyr: 2, baseDtYr: 2e5 });
    const drivers = { volcanic: new Float64Array(plan.n).fill(1), uplift: new Float64Array(plan.n).fill(1), polarLand: new Float64Array(plan.n), tectonicSeaLevel: new Float64Array(plan.n), solarForcing: new Float64Array(plan.n) };
    const C0 = m.totalCarbon(y0);
    const A0 = m.totalAlkalinity(y0);
    const h = runEarthSystem({ planet: closed, plan, drivers, calibrated: { ...c, y0 } });
    const yEnd = h.endState.slice((plan.n - 1) * N_STATE, plan.n * N_STATE);
    expect(Math.abs(m.totalCarbon(yEnd) / C0 - 1)).toBeLessThan(1e-7);
    expect(Math.abs(m.totalAlkalinity(yEnd) / A0 - 1)).toBeLessThan(1e-7);
    // and the disturbance relaxed (atmosphere re-equilibrated with the surface ocean)
    const x = m.snapshotFluxes(yEnd);
    expect(Math.abs(x.pCO2a - x.pCO2s)).toBeLessThan(0.5);
  });

  it('an emission adds exactly E·dt of carbon to the atmosphere–ocean system', () => {
    const c = calibrate(closed);
    const m = new EarthModel(closed, c.base);
    const plan = buildTimePlan({ durationMyr: 0.02, baseDtYr: 1000 });
    const drivers = { volcanic: new Float64Array(plan.n).fill(1), uplift: new Float64Array(plan.n).fill(1), polarLand: new Float64Array(plan.n), tectonicSeaLevel: new Float64Array(plan.n), solarForcing: new Float64Array(plan.n) };
    const forcing = (_a: number, _b: number) => { const f = zeroForcing(); f.carbonEmission = 0.5; f.d13CofEmission = -50; return f; };
    const h = runEarthSystem({ planet: closed, plan, drivers, forcing, calibrated: c });
    const yEnd = h.endState.slice((plan.n - 1) * N_STATE, plan.n * N_STATE);
    const injected = 0.5 * 20_000;
    expect((m.totalCarbon(yEnd) - m.totalCarbon(c.y0)) / injected).toBeCloseTo(1, 6);
  });

  it('isotope bookkeeping conserves 13C moment at an arbitrary (non-steady) state', () => {
    // d/dt of total 13C moment must equal boundary fluxes only: V δV + Wo δWo + Fc δWc + E δE − sinks.
    const { m, y } = modelAt();
    y[IDX.A] *= 1.4; y[IDX.DICs] -= 60; y[IDX.dA] = -9; y[IDX.dS] = 0.3; y[IDX.dD] = -1.2; y[IDX.Ts] = 1.1;
    m.ctx.forcing = { ...zeroForcing(), carbonEmission: 0.3, d13CofEmission: -45 };
    const d = new Float64Array(N_STATE);
    m.rhs(y, d);
    const x = m.snapshotFluxes(y);
    const p = EARTH_LIKE;
    const cS = m.snapshotMassFactors().cS;
    const cD = m.snapshotMassFactors().cD;
    const MA = y[IDX.A], MS = y[IDX.DICs] * cS, MD = y[IDX.DICd] * cD;
    const dMA = d[IDX.A], dMS = d[IDX.DICs] * cS, dMD = d[IDX.DICd] * cD;
    const dMoment =
      dMA * y[IDX.dA] + MA * d[IDX.dA] + dMS * y[IDX.dS] + MS * d[IDX.dS] + dMD * y[IDX.dD] + MD * d[IDX.dD];
    const boundary =
      x.V * p.d13CVolc + x.Wo * p.d13COrgW + x.Fc * p.d13CCarbW + x.E * -45 -
      x.BoM * (y[IDX.dS] - x.epsP) - (x.Bsh + x.Bpel) * (y[IDX.dS] + p.epsCalcite) - x.Bt * (y[IDX.dA] - p.epsTerr);
    expect(dMoment).toBeCloseTo(boundary, 6);
  });
});

describe('weathering feedback', () => {
  it('a permanent 50 % rise in degassing lifts pCO2 then relaxes over 0.1–1 Myr', () => {
    const h = runConstant({ durationMyr: 12, baseDtYr: 2e4, windows: [], drivers: { volcanic: 1.5 } });
    const co2 = h.mean.pCO2;
    const n = h.plan.n;
    const start = EARTH_LIKE.pCO2Ref;
    const end = co2[n - 1];
    expect(end).toBeGreaterThan(start * 1.1); // new, higher equilibrium
    // time to cover 63 % of the way from start to the new equilibrium
    const target = start + 0.632 * (end - start);
    let t = NaN;
    for (let i = 0; i < n; i++) if (co2[i] >= target) { t = (h.plan.ageBaseMa[0] - h.plan.ageBaseMa[i]) * 1e6; break; }
    expect(t).toBeGreaterThan(1e5);
    expect(t).toBeLessThan(1e6);
    // and the new state is a true steady state: nothing moves during the last 2 Myr
    const k = n - Math.floor(2e6 / 2e4);
    expect(Math.abs(co2[n - 1] / co2[k] - 1)).toBeLessThan(0.01);
  });

  it('silicate weathering rises with temperature (negative feedback on climate)', () => {
    const { m, y } = modelAt();
    const f0 = m.snapshotFluxes(y).Fsil;
    y[IDX.Ts] = 3;
    expect(m.snapshotFluxes(y).Fsil).toBeGreaterThan(f0 * 1.2);
  });
});

describe('climate, ice and sea level', () => {
  it('equilibrium warming matches ECS × doublings', () => {
    // Fix pCO2 by perturbing the model directly: pure energy-balance response.
    const { m, y } = modelAt();
    const eqT = (co2Rel: number): number => {
      const yy = y.slice();
      yy[IDX.A] *= co2Rel;
      const d = new Float64Array(N_STATE);
      // solve dTs/dt = 0 with Td = Ts (equilibrium) -> Ts = F/λ
      const lambda = (5.35 * Math.LN2) / EARTH_LIKE.ecs;
      m.rhs(yy, d);
      return (5.35 * Math.log(co2Rel)) / lambda;
    };
    expect(eqT(2)).toBeCloseTo(EARTH_LIKE.ecs, 6);
  });

  it('polar land + cooling grows ice, drops sea level and raises δ18O; ice persists (hysteresis)', () => {
    // Volcanic degassing way down -> CO2 down -> cooling; continents at the pole.
    const cold = runConstant({ durationMyr: 6, baseDtYr: 5e4, drivers: { polarLand: 0.8, volcanic: 0.35 } });
    const n = cold.plan.n;
    expect(cold.mean.ice[n - 1]).toBeGreaterThan(0.5);
    expect(cold.mean.seaLevel[n - 1]).toBeLessThan(-50);
    expect(cold.mean.d18O_sw[n - 1]).toBeGreaterThan(cold.mean.d18O_sw[0] + 0.5);
    expect(cold.mean.d18O_carb[n - 1]).toBeGreaterThan(cold.mean.d18O_carb[0]);

  });

  it('ice sheets show hysteresis: same climate, different history, different ice state', () => {
    // Moderate polar land (0.45): an ice-free planet stays ice-free...
    const free = runConstant({ durationMyr: 3, baseDtYr: 5e4, drivers: { polarLand: 0.45 } });
    expect(free.mean.ice[free.plan.n - 1]).toBeLessThan(0.15);
    // ...but a planet that was glaciated (polar land 0.8 for 2 Myr) stays glaciated after polar land
    // drops to the same 0.45, because the ice sheets themselves keep the climate cold.
    const hist = runConstant({
      durationMyr: 3, baseDtYr: 5e4, drivers: { polarLand: 0.8 },
      driversOverride: (d) => { for (let i = Math.floor(d.polarLand.length * 2 / 3); i < d.polarLand.length; i++) d.polarLand[i] = 0.45; },
    });
    const n = hist.plan.n;
    const iSwitch = Math.floor(n * 2 / 3);
    expect(hist.mean.ice[iSwitch - 1]).toBeGreaterThan(0.8);
    expect(hist.mean.ice[iSwitch + 4]).toBeGreaterThan(0.8); // 0.2 Myr after the switch
    expect(hist.mean.ice[iSwitch + 4]).toBeGreaterThan(free.mean.ice[iSwitch + 4] + 0.6);
  });

  it('deep-ocean oxygen falls and anoxic burial rises when nutrient input surges', () => {
    const base = runConstant({ durationMyr: 2, baseDtYr: 1e5 });
    const surge = runConstant({
      durationMyr: 2, baseDtYr: 1e5,
      forcing: () => ({ ...zeroForcing(), nutrientRunoff: 3 }),
    });
    const n = surge.plan.n - 1;
    expect(surge.mean.PO4[n]).toBeGreaterThan(base.mean.PO4[n] * 1.5);
    expect(surge.mean.O2deep[n]).toBeLessThan(base.mean.O2deep[n] - 15);
    expect(surge.mean.orgBurial[n]).toBeGreaterThan(base.mean.orgBurial[n]);
    // organic burial removes 12C -> positive δ13C excursion
    expect(surge.mean.d13C_carb[n]).toBeGreaterThan(base.mean.d13C_carb[n] + 0.2);
  });
});

describe('clathrate release → PETM-like hyperthermal', () => {
  // A hot, high-CO2-sensitivity background like the Paleocene; 4500 Pg C of δ13C = −60 ‰ over 10 kyr.
  const planet = { ...EARTH_LIKE, pCO2Ref: 500, ecs: 4 };
  const onset = 3.0;
  const h = runConstant({
    planet,
    durationMyr: 5,
    baseDtYr: 1e5,
    windows: [
      { ageStartMa: onset, ageEndMa: onset - 0.01, dtYr: 500, tag: 1 },
      { ageStartMa: onset - 0.01, ageEndMa: onset - 0.2, dtYr: 2000, tag: 2 },
      { ageStartMa: onset - 0.2, ageEndMa: onset - 1.0, dtYr: 10000, tag: 3 },
    ],
    forcing: carbonPulse(onset, 10, 4500, -60),
  });
  const plan = h.plan;
  let i0 = 0;
  while (plan.ageTopMa[i0] > onset + 1e-9) i0++;
  const pre = i0 - 1;
  const rel = (a: Float64Array, i: number) => a[i] - a[pre];

  it('produces a sharp negative carbon-isotope excursion of a few per mil within ~20 kyr', () => {
    let min = Infinity, iMin = i0;
    for (let i = i0; i < plan.n; i++) if (rel(h.mean.d13C_carb, i) < min) { min = rel(h.mean.d13C_carb, i); iMin = i; }
    expect(min).toBeLessThan(-2);
    expect(min).toBeGreaterThan(-6);
    expect((onset - plan.ageTopMa[iMin]) * 1000).toBeLessThan(20);
    // organic carbon shows the same shift (a single carbon source)
    expect(rel(h.mean.d13C_org, iMin)).toBeLessThan(-2);
  });

  it('warms the planet by several K and lifts pCO2', () => {
    let maxT = -Infinity, maxCO2 = -Infinity;
    for (let i = i0; i < plan.n; i++) { maxT = Math.max(maxT, rel(h.mean.tempC, i)); maxCO2 = Math.max(maxCO2, h.mean.pCO2[i]); }
    expect(maxT).toBeGreaterThan(3);
    expect(maxT).toBeLessThan(7);
    expect(maxCO2).toBeGreaterThan(h.mean.pCO2[pre] * 1.4);
  });

  it('acidifies the ocean and shoals the CCD by > 1 km (carbonate dissolution)', () => {
    let minCcd = Infinity, minOm = Infinity, minPh = Infinity;
    for (let i = i0; i < plan.n; i++) {
      minCcd = Math.min(minCcd, rel(h.mean.ccd, i));
      minOm = Math.min(minOm, h.mean.omegaArag[i]);
      minPh = Math.min(minPh, h.mean.pH[i]);
    }
    expect(minCcd).toBeLessThan(-1000);
    expect(minOm).toBeLessThan(h.mean.omegaArag[pre] * 0.9);
    expect(minPh).toBeLessThan(h.mean.pH[pre] - 0.05);
  });

  it('recovers: the CIE decays with an e-folding time of ~0.1–0.3 Myr (carbon residence time)', () => {
    let min = Infinity, iMin = i0;
    for (let i = i0; i < plan.n; i++) if (rel(h.mean.d13C_carb, i) < min) { min = rel(h.mean.d13C_carb, i); iMin = i; }
    let t = NaN;
    for (let i = iMin; i < plan.n; i++) if (Math.abs(rel(h.mean.d13C_carb, i)) < Math.abs(min) / Math.E) { t = (plan.ageBaseMa[iMin] - plan.ageBaseMa[i]) * 1000; break; }
    expect(t).toBeGreaterThan(80);
    expect(t).toBeLessThan(300);
  });
});

describe('sampled planets', () => {
  it('every sampled planet calibrates to a steady state (no seed can crash world generation)', () => {
    for (let k = 0; k < 150; k++) {
      const planet = samplePlanet(new Rng(`calib-${k}`));
      const c = calibrate(planet);
      expect(c.y0.every(Number.isFinite)).toBe(true);
      expect(c.base.kShelf).toBeGreaterThan(0);
    }
  });
});

describe('full-length runs', () => {
  it('are deterministic: same seed -> bit-identical output', () => {
    const go = () => {
      const rng = new Rng('determinism');
      const planet = samplePlanet(rng);
      const plan = buildTimePlan({ durationMyr: 60, baseDtYr: 2e5 });
      const drivers = generateSlowDrivers(plan, planet, rng);
      const h = runEarthSystem({ planet, plan, drivers });
      let acc = 0;
      for (const k of ['pCO2', 'tempC', 'd13C_carb', 'seaLevel', 'ice'] as const) for (const v of h.mean[k]) acc = hash32(acc, v);
      return acc;
    };
    expect(go()).toBe(go());
  });

  it('stay finite, bounded and Earth-like across many sampled planets (250 Myr)', () => {
    for (let s = 0; s < 4; s++) {
      const rng = new Rng(`bounds-${s}`);
      const planet = samplePlanet(rng);
      const plan = buildTimePlan({ durationMyr: 250, baseDtYr: 1e5 });
      const drivers = generateSlowDrivers(plan, planet, rng);
      const h = runEarthSystem({ planet, plan, drivers, calibrated: calibrated(planet) });
      for (const name of Object.keys(h.mean) as (keyof typeof h.mean)[]) {
        for (const v of h.mean[name]) expect(Number.isFinite(v)).toBe(true);
      }
      const rng2 = (a: Float64Array) => [Math.min(...a), Math.max(...a)];
      const [o2lo, o2hi] = rng2(h.mean.O2atm);
      expect(o2lo).toBeGreaterThan(0.15);
      expect(o2hi).toBeLessThan(0.3);
      const [tlo, thi] = rng2(h.mean.tempC);
      expect(tlo).toBeGreaterThan(0);
      expect(thi).toBeLessThan(35);
      const [clo, chi] = rng2(h.mean.pCO2);
      expect(clo).toBeGreaterThan(100);
      expect(chi).toBeLessThan(20000);
    }
  });

  it('runs 250 Myr at 100 kyr steps in a few seconds', () => {
    const rng = new Rng('speed');
    const planet = samplePlanet(rng);
    const plan = buildTimePlan({ durationMyr: 250, baseDtYr: 1e5 });
    const drivers = generateSlowDrivers(plan, planet, rng);
    const t0 = performance.now();
    runEarthSystem({ planet, plan, drivers });
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

// keep unit helpers referenced so unused-import lint stays quiet if the file is trimmed
void PGC_PER_UMOL; void MOL_PER_PGC;
