import { describe, expect, it } from 'vitest';
import { ObservationService } from '../../src/observation/service';
import { measureProxy } from '../../src/observation/instruments';
import { classify } from '../../src/observation/lithology';
import { LITH, LITHOLOGIES } from '../../src/shared/lithology';
import { PROXIES } from '../../src/shared/proxies';
import { CoreResult, AssayResult } from '../../src/shared/protocol';
import { F } from '../../src/truth/strat/facies';
import { NT, T } from '../../src/truth/strat/tracers';
import { scenario } from '../events/helpers';
import { BolideEvent } from '../../src/truth/events/types';
import { makeConfig } from '../../src/shared/config';

const impact: BolideEvent = { kind: 'bolide', ageMa: 25, diameterKm: 12, xKm: 2500, yKm: 0 };
const world = scenario([impact], [], { seed: 'obs', nx: 16, durationMyr: 50 });
const N = world.strat.nx * world.strat.ny;

/** The deepest column of the world, so cores are long. */
const thickCell = (() => {
  let best = 0, bt = 0;
  world.strat.columns.forEach((c, i) => { const t = c.compactedThickness(); if (t > bt) { bt = t; best = i; } });
  return best;
})();

const drill = (svc: ObservationService, cell = thickCell, depth = 400): CoreResult => {
  const r = svc.execute({ kind: 'drill', cell, depthM: depth });
  if (!r.ok || r.measurement.kind !== 'core') throw new Error('drill failed: ' + JSON.stringify(r));
  return r.measurement;
};
const assay = (svc: ObservationService, coreId: string, proxy: Parameters<typeof svc.execute>[0] extends never ? never : 'toc', depths: number[]): AssayResult => {
  const r = svc.execute({ kind: 'assay', coreId, proxy, depthsM: depths });
  if (!r.ok || r.measurement.kind !== 'assay') throw new Error('assay failed: ' + JSON.stringify(r));
  return r.measurement;
};

describe('free map information', () => {
  const info = new ObservationService(world).publicInfo();
  it('has the right shape and no hidden fields', () => {
    expect(info.elevationM.length).toBe(N);
    expect(info.surfaceClass.length).toBe(N);
    expect(info.exposure.length).toBe(N);
    expect(Object.keys(info).sort()).toEqual(['budget', 'cellKm', 'drillCost', 'elevationM', 'exposure', 'maxCoreM', 'nx', 'ny', 'proxies', 'surfaceClass']);
    for (const v of info.surfaceClass) expect(v).toBeLessThan(LITHOLOGIES.length);
    for (const v of info.exposure) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
  it('remote sensing is wrong about 15 % of the time', () => {
    let wrong = 0;
    world.strat.columns.forEach((c, i) => {
      const truth = c.n === 0 ? LITH['crystalline basement'] : classify(c.tr, (c.n - 1) * NT, c.facies[c.n - 1]).lith;
      if (info.surfaceClass[i] !== truth) wrong++;
    });
    expect(wrong / N).toBeGreaterThan(0.06);
    expect(wrong / N).toBeLessThan(0.26);
  });
  it('topography is within a few metres of the truth', () => {
    for (let i = 0; i < N; i += 7) expect(Math.abs(info.elevationM[i] - (world.strat.surface[i] - world.strat.seaLevelNow))).toBeLessThan(20);
  });
});

describe('drilling', () => {
  const svc = new ObservationService(world);
  const core = drill(svc);

  it('returns beds that tile the recovered core, in order, with sensible rock names', () => {
    expect(core.beds.length).toBeGreaterThan(3);
    let prev = -1;
    for (const b of core.beds) {
      expect(b.topM).toBeGreaterThanOrEqual(prev - 1e-6);
      expect(b.baseM).toBeGreaterThan(b.topM);
      expect(b.lith).toBeGreaterThanOrEqual(0);
      expect(b.lith).toBeLessThan(LITHOLOGIES.length);
      prev = b.baseM;
    }
    expect(core.lengthM).toBeLessThanOrEqual(400 * 1.02);
  });

  it('loses some core (≈ 8 %) and stretches the depth scale slightly', () => {
    const long = drill(svc, thickCell, 1000);
    const lost = long.gaps.reduce((a, g) => a + (g.baseM - g.topM), 0);
    expect(lost / long.lengthM).toBeGreaterThan(0.02);
    expect(lost / long.lengthM).toBeLessThan(0.2);
    const stretch = svc.coreStretch(long.coreId)!;
    expect(Math.abs(stretch - 1)).toBeLessThan(0.02);
    // no bed overlaps a lost interval
    for (const b of long.beds) for (const g of long.gaps) expect(b.baseM <= g.topM + 1e-6 || b.topM >= g.baseM - 1e-6).toBe(true);
  });

  it('costs budget once; asking again is free and identical', () => {
    const fresh = new ObservationService(world);
    const before = fresh.budget;
    const a = drill(fresh, thickCell, 300);
    expect(a.cost).toBeGreaterThan(5);
    expect(fresh.budget).toBeCloseTo(before - a.cost, 9);
    const b = drill(fresh, thickCell, 300);
    expect(b.cost).toBe(0);
    expect(fresh.budget).toBeCloseTo(before - a.cost, 9);
    expect({ ...b, cost: 0, budgetLeft: 0 }).toEqual({ ...a, cost: 0, budgetLeft: 0 });
  });

  it('a hole drilled to the bottom reaches crystalline basement; a bare cell is basement all the way', () => {
    const deep = drill(new ObservationService(world), thickCell, 1500);
    if (deep.reachedBasement) expect(LITHOLOGIES[deep.beds[deep.beds.length - 1].lith]).toBe('crystalline basement');
    const bare = world.strat.columns.findIndex((c) => c.n === 0);
    if (bare >= 0) {
      const b = drill(new ObservationService(world), bare, 50);
      expect(b.beds.every((x) => LITHOLOGIES[x.lith] === 'crystalline basement')).toBe(true);
    }
  });

  it('validates requests', () => {
    expect(svc.execute({ kind: 'drill', cell: -1, depthM: 100 })).toMatchObject({ ok: false, code: 'out_of_range' });
    expect(svc.execute({ kind: 'drill', cell: 0, depthM: 99999 })).toMatchObject({ ok: false, code: 'out_of_range' });
    expect(svc.execute({ kind: 'assay', coreId: 'nope', proxy: 'toc', depthsM: [1] })).toMatchObject({ ok: false, code: 'unknown_core' });
  });
});

describe('assays', () => {
  it('are deterministic and independent of what else the player did', () => {
    const depths = [3, 10.5, 22.25, 40, 75];
    const s1 = new ObservationService(world), s2 = new ObservationService(world);
    const c1 = drill(s1), c2 = drill(s2);
    assay(s2, c2.coreId, 'toc', [1, 2, 3]); // the other player wandered first
    for (const p of ['toc', 'd13C_carb', 'ir', 'hg'] as const) {
      const a = s1.execute({ kind: 'assay', coreId: c1.coreId, proxy: p, depthsM: depths });
      const b = s2.execute({ kind: 'assay', coreId: c2.coreId, proxy: p, depthsM: depths });
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok && a.measurement.kind === 'assay' && b.measurement.kind === 'assay') expect(a.measurement.samples).toEqual(b.measurement.samples);
    }
  });

  it('charge per sample, refuse when broke, and change nothing when refused', () => {
    const poor = new ObservationService(scenario([impact], [], { seed: 'poor', nx: 12, durationMyr: 30, budget: 12 }));
    const c = poor.execute({ kind: 'drill', cell: 0, depthM: 20 });
    expect(c.ok).toBe(true);
    if (!c.ok || c.measurement.kind !== 'core') return;
    const left = poor.budget;
    const r = poor.execute({ kind: 'assay', coreId: c.measurement.coreId, proxy: 'fe60', depthsM: [1, 2, 3, 4] }); // 4 × 6
    expect(r).toMatchObject({ ok: false, code: 'insufficient_budget' });
    expect(poor.budget).toBe(left);
    const ok = poor.execute({ kind: 'assay', coreId: c.measurement.coreId, proxy: 'toc', depthsM: [1, 2] });
    if (ok.ok) expect(poor.budget).toBeCloseTo(left - 2 * PROXIES.toc.cost, 9);
  });

  it('report lost core and out-of-range samples honestly', () => {
    const svc = new ObservationService(world);
    const core = drill(svc, thickCell, 600);
    const g = core.gaps[0];
    const r = assay(svc, core.coreId, 'toc', [(g.topM + g.baseM) / 2, core.lengthM + 50, -3]);
    expect(r.samples[0]).toMatchObject({ value: null, note: 'lost core' });
    expect(r.samples[1]).toMatchObject({ value: null, note: 'out of range' });
    expect(r.samples[2]).toMatchObject({ value: null, note: 'out of range' });
  });

  it('never expose the hidden vocabulary', () => {
    const svc = new ObservationService(world);
    const core = drill(svc);
    const text = JSON.stringify(core) + JSON.stringify(assay(svc, core.coreId, 'toc', [5, 6]));
    for (const w of ['shelfCarbonate', 'deepMarine', 'facies', 'ageMa', 'tracer', 'bolide', 'catalog', 'EJECTA']) expect(text).not.toContain(w);
    expect(Object.keys(core.beds[0]).sort()).toEqual(['baseM', 'carbonatePct', 'contact', 'lith', 'notes', 'organicPct', 'sandPct', 'topM']);
  });
});

describe('instrument physics', () => {
  const mk = (over: Partial<Record<keyof typeof T, number>>): Float64Array => {
    const a = new Float64Array(NT);
    a[T.clastic] = 0.5; a[T.caco3] = 0.5;
    for (const [k, v] of Object.entries(over)) a[T[k as keyof typeof T]] = v as number;
    return a;
  };
  const ctx = (o: Partial<Parameters<typeof measureProxy>[2]> = {}) => ({ seed: 'phys', noiseScale: 1, cell: 3, depthKey: 0, ageMa: 30, burialM: 100, ...o });

  it('δ13C reproduces the composition with ≈ 0.1 ‰ scatter', () => {
    const acc = mk({ d13C_carb: 0.5 * 2.0 });
    const v: number[] = [];
    for (let k = 0; k < 2000; k++) v.push(measureProxy('d13C_carb', acc, ctx({ depthKey: k })).value!);
    const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    expect(m).toBeCloseTo(2.0, 1);
    expect(sd).toBeGreaterThan(0.08); expect(sd).toBeLessThan(0.12);
  });
  it('δ18O is shifted lighter by burial diagenesis (≈ 0.5 ‰ per km) and age', () => {
    const acc = mk({ d18O_carb: 0.5 * -1 });
    const mean = (burialM: number, ageMa: number) => { let s = 0; for (let k = 0; k < 400; k++) s += measureProxy('d18O_carb', acc, ctx({ depthKey: k, burialM, ageMa })).value!; return s / 400; };
    expect(mean(0, 1) - mean(3000, 1)).toBeGreaterThan(1.0);
    expect(mean(500, 1) - mean(500, 200)).toBeGreaterThan(0.5);
  });
  it('no carbonate → no δ13C; trace elements have detection limits; Ir is a concentration (dilutes with mass)', () => {
    expect(measureProxy('d13C_carb', mk({ caco3: 0 }), ctx()).note).toBe('no carbonate');
    expect(measureProxy('ir', mk({ Ir: 1 }), ctx()).value).toBeNull();
    const thin = measureProxy('ir', mk({ Ir: 5e4, clastic: 0.005, caco3: 0 }), ctx()).value!;
    const thick = measureProxy('ir', mk({ Ir: 5e4, clastic: 0.5, caco3: 0 }), ctx()).value!;
    expect(thin / thick).toBeGreaterThan(70);
    expect(thin / thick).toBeLessThan(130);
  });
  it('persistent-organics readings are contaminated ~3 % of the time (natural false positives)', () => {
    const acc = mk({ persistOrg: 1000 });
    const vals: number[] = [];
    for (let k = 0; k < 4000; k++) vals.push(measureProxy('persistOrg', acc, ctx({ depthKey: k })).value!);
    const med = [...vals].sort((a, b) => a - b)[2000];
    const high = vals.filter((v) => v > 3 * med).length / vals.length;
    expect(high).toBeGreaterThan(0.015); expect(high).toBeLessThan(0.05);
  });
  it('counting measurements are Poisson', () => {
    const acc = mk({ spherules: 5, clastic: 0.0005, caco3: 0 });
    const vals: number[] = [];
    for (let k = 0; k < 1500; k++) vals.push(measureProxy('spherules', acc, ctx({ depthKey: k })).value!);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length, v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
    expect(m).toBeGreaterThan(5); expect(v / m).toBeGreaterThan(0.8); expect(v / m).toBeLessThan(1.25);
  });
});

describe('rock classification', () => {
  const rock = (o: Partial<Record<keyof typeof T, number>>, facies: number = F.shelfSiliciclastic) => {
    const a = new Float64Array(NT);
    for (const [k, v] of Object.entries(o)) a[T[k as keyof typeof T]] = v as number;
    return LITHOLOGIES[classify(a, 0, facies).lith];
  };
  it('names rocks from composition', () => {
    expect(rock({ caco3: 1 })).toBe('limestone');
    expect(rock({ caco3: 0.4, clastic: 0.6 })).toBe('marl');
    expect(rock({ clastic: 1, sand: 0.1 })).toBe('mudstone');
    expect(rock({ clastic: 1, sand: 0.5 })).toBe('muddy sandstone');
    expect(rock({ clastic: 1, sand: 0.9 })).toBe('sandstone');
    expect(rock({ evap: 1 })).toBe('evaporite');
    expect(rock({ ash: 1 })).toBe('tuff (volcanic ash)');
    expect(rock({ clastic: 0.8, orgC: 0.2 * 600 })).toBe('black shale');
    expect(rock({ clastic: 0.5, orgC: 0.5 * 600 })).toBe('coal');
    expect(rock({ clastic: 1, sand: 0.5 }, F.glacial)).toBe('diamictite');
  });
});

void makeConfig;
