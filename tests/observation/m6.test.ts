import { describe, expect, it } from 'vitest';
import { ObservationService } from '../../src/observation/service';
import { CoreResult, DateResult, FossilResult } from '../../src/shared/protocol';
import { NT, T } from '../../src/truth/strat/tracers';
import { AshEvent } from '../../src/truth/events/types';
import { scenario } from '../events/helpers';

const ash: AshEvent = { kind: 'ash', ageMa: 20, volumeKm3: 800, xKm: 0, yKm: 0, windDeg: 0 };
const world = scenario([], [ash], { seed: 'm6', nx: 16, durationMyr: 50, exhumeMyr: 0 });
const N = world.strat.nx * world.strat.ny;
const thick = (() => {
  let best = 0, bt = 0;
  world.strat.columns.forEach((c, i) => { const t = c.compactedThickness(); if (t > bt) { bt = t; best = i; } });
  return best;
})();

/** The cell holding the most ash, with a deep core available. */
const ashCell = (() => {
  let best = thick, ba = 0;
  world.strat.columns.forEach((c, i) => {
    let a = 0;
    for (let l = 0; l < c.n; l++) a += c.tr[l * NT + T.ash];
    if (a > ba) { ba = a; best = i; }
  });
  return best;
})();

const exec = (svc: ObservationService, a: Parameters<ObservationService['execute']>[0]) => svc.execute(a);
const core = (svc: ObservationService, cell = ashCell, depth = 600): CoreResult => {
  const r = exec(svc, { kind: 'drill', cell, depthM: depth });
  if (!r.ok || r.measurement.kind !== 'core') throw new Error('drill failed');
  return r.measurement;
};
const date = (svc: ObservationService, coreId: string, depthM: number): DateResult => {
  const r = exec(svc, { kind: 'date', coreId, depthM });
  if (!r.ok || r.measurement.kind !== 'date') throw new Error('date failed');
  return r.measurement;
};

describe('outcrop survey', () => {
  const svc = new ObservationService(world);
  const info = svc.publicInfo();
  const land = Array.from({ length: N }, (_, i) => i).filter((i) => info.elevationM[i] > 20);
  const sea = Array.from({ length: N }, (_, i) => i).filter((i) => info.elevationM[i] < -50);

  it('only works on land, costs little, and is deterministic and free to repeat', () => {
    expect(land.length).toBeGreaterThan(0);
    expect(sea.length).toBeGreaterThan(0);
    const bad = exec(svc, { kind: 'survey', cell: sea[0] });
    expect(bad.ok).toBe(false);
    const a = exec(svc, { kind: 'survey', cell: land[0] });
    expect(a.ok).toBe(true);
    if (!a.ok || a.measurement.kind !== 'core') throw new Error('expected core');
    expect(a.measurement.source).toBe('outcrop');
    expect(a.measurement.cost).toBeLessThan(15);
    const b = exec(svc, { kind: 'survey', cell: land[0] });
    if (!b.ok || b.measurement.kind !== 'core') throw new Error();
    expect(b.measurement.cost).toBe(0);
    expect(b.measurement.beds).toEqual(a.measurement.beds);
  });

  it('outcrops are covered in places (gaps) and cores are labelled as cores', () => {
    let anyCovered = false;
    for (const c of land.slice(0, 20)) {
      const r = exec(new ObservationService(world), { kind: 'survey', cell: c });
      if (r.ok && r.measurement.kind === 'core' && r.measurement.gaps.length > 0) anyCovered = true;
    }
    expect(anyCovered).toBe(true);
    expect(core(new ObservationService(world)).source).toBe('core');
  });
});

describe('radiometric dating', () => {
  it('returns the eruption age within errors where there is ash, nothing elsewhere', () => {
    const svc = new ObservationService(world);
    const c = core(svc);
    let hits = 0, good = 0, none = 0;
    for (let d = 0; d < c.lengthM; d += 0.25) {
      const r = date(svc, c.coreId, d);
      if (r.ageMa === null) { if (r.note === 'no datable ash') none++; continue; }
      hits++;
      if (Math.abs(r.ageMa - 20) < 5 * r.sigmaMa + 0.05) good++;
    }
    expect(hits).toBeGreaterThan(5);
    expect(good / hits).toBeGreaterThan(0.7);
    expect(none).toBeGreaterThan(0);
  });
  it('is charged even when it fails, deterministic, and free to repeat', () => {
    const svc = new ObservationService(world);
    const c = core(svc);
    const before = svc.publicInfo().costs.date;
    const a = date(svc, c.coreId, 1);
    expect(a.cost).toBe(before);
    const b = date(svc, c.coreId, 1);
    expect(b.cost).toBe(0);
    expect(b.ageMa).toBe(a.ageMa);
  });
  it('refuses out-of-range depths', () => {
    const svc = new ObservationService(world);
    const c = core(svc, ashCell, 50);
    const r = date(svc, c.coreId, c.lengthM + 500);
    expect(r.ageMa).toBeNull();
  });
});

describe('fossil sampling', () => {
  const svc = new ObservationService(world);
  const c = core(svc);
  const fossils = (depthM: number, effort: number): FossilResult => {
    const r = exec(svc, { kind: 'fossils', coreId: c.coreId, depthM, effort });
    if (!r.ok || r.measurement.kind !== 'fossils') throw new Error('fossils failed ' + JSON.stringify(r));
    return r.measurement;
  };
  it('is deterministic, free to repeat and scales cost with effort', () => {
    const a = fossils(100, 2);
    expect(a.cost).toBe(2 * svc.publicInfo().costs.fossilsPerEffort);
    const b = fossils(100, 2);
    expect(b.cost).toBe(0);
    expect(b.found).toEqual(a.found);
  });
  it('finds named morphotypes, and more effort finds more of them', () => {
    let lo = 0, hi = 0;
    for (const d of [50, 150, 250, 350]) {
      lo += fossils(d, 1).found.length;
      hi += fossils(d, 4).found.length;
    }
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeGreaterThanOrEqual(lo);
    const any = fossils(150, 4).found;
    for (const m of any) { expect(m.name.length).toBeGreaterThan(2); expect(m.count).toBeGreaterThan(0); }
  });
});
