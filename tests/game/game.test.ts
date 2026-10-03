import { describe, expect, it } from 'vitest';
import { AgePoint, depthAtAge, fitAgeModel } from '../../src/game/agemodel';
import { crossingTies, makeTie, propagateAges, TIE_SIGMA_MA } from '../../src/game/correlation';
import { Notebook } from '../../src/game/notebook';
import { parseSave, serialize } from '../../src/game/save';
import { Session } from '../../src/game/session';
import { makeConfig } from '../../src/shared/config';
import { loopback } from '../worker/loopback';

const pt = (depthM: number, ageMa: number, sigmaMa = 0.05, origin: 'date' | 'tie' = 'date'): AgePoint => ({ depthM, ageMa, sigmaMa, origin });

describe('age-depth model', () => {
  it('interpolates a clean series and reports the sedimentation rate', () => {
    const m = fitAgeModel([pt(0, 10), pt(100, 12), pt(300, 16)]);
    expect(m.at(50)!.ageMa).toBeCloseTo(11, 6);
    expect(m.at(200)!.ageMa).toBeCloseTo(14, 6);
    expect(m.segments.map((s) => s.rateMPerMyr)).toEqual([50, 50]);
    expect(m.at(-10)).toBeNull();
    expect(m.at(400)).toBeNull();
    expect(depthAtAge(m, 14)).toBeCloseTo(200, 6);
    expect(m.suspect).toHaveLength(0);
  });
  it('pools reversals so age never decreases downcore, and flags the segment as flat', () => {
    const m = fitAgeModel([pt(0, 10), pt(100, 15), pt(200, 13), pt(300, 20)]);
    let prev = -Infinity;
    for (let z = 0; z <= 300; z += 5) { const a = m.at(z)!.ageMa; expect(a).toBeGreaterThanOrEqual(prev - 1e-9); prev = a; }
    expect(m.segments.some((s) => s.flat)).toBe(true);
  });
  it('weights precise dates more, and gets tighter with more dates', () => {
    const m = fitAgeModel([pt(100, 10, 0.01), pt(100, 10.4, 1)]);
    expect(m.at(100)!.ageMa).toBeCloseTo(10, 1);
    expect(m.at(100)!.sigmaMa).toBeLessThan(0.0101);
  });
  it('flags a lone wild date as suspect only when neighbours pull the pooled fit away', () => {
    const m = fitAgeModel([pt(0, 10, 0.02), pt(100, 11, 0.02), pt(110, 30, 0.02), pt(200, 12, 0.02), pt(300, 13, 0.02)]);
    // 30 Ma at 110 m sits above 12 Ma at 200 m: pooled; the pooled block is the compromise, the point is far from it
    expect(m.suspect.length).toBeGreaterThan(0);
  });
});

describe('correlation', () => {
  const dates = new Map<string, AgePoint[]>([['A', [pt(10, 5, 0.01), pt(110, 7, 0.01)]]]);
  it('carries ages from a dated core to an undated one, adding the tie uncertainty', () => {
    const ties = [makeTie('t1', 'excursion', { coreId: 'A', depthM: 60 }, { coreId: 'B', depthM: 30 })];
    const r = propagateAges(['A', 'B'], dates, ties);
    expect(r.generation.get('A')).toBe(0);
    expect(r.generation.get('B')).toBe(1);
    const age = r.models.get('B')!.at(30)!;
    expect(age.ageMa).toBeCloseTo(6, 6);
    expect(age.sigmaMa).toBeGreaterThanOrEqual(TIE_SIGMA_MA.excursion);
  });
  it('chains through intermediate cores and does not count a date twice around a loop', () => {
    const ties = [
      makeTie('t1', 'ash', { coreId: 'A', depthM: 60 }, { coreId: 'B', depthM: 30 }),
      makeTie('t2', 'ash', { coreId: 'B', depthM: 30 }, { coreId: 'C', depthM: 5 }),
      makeTie('t3', 'ash', { coreId: 'C', depthM: 5 }, { coreId: 'A', depthM: 60 }),
    ];
    const r = propagateAges(['A', 'B', 'C'], dates, ties);
    expect(r.generation.get('C')).toBe(1);
    expect(r.models.get('A')!.points.every((p) => p.origin === 'date')).toBe(true);
    expect(r.models.get('C')!.at(5)!.ageMa).toBeCloseTo(6, 6);
  });
  it('leaves untied, undated cores without a model, and detects crossing ties', () => {
    const r = propagateAges(['A', 'Z'], dates, []);
    expect(r.models.has('Z')).toBe(false);
    const a = makeTie('x', 'manual', { coreId: 'A', depthM: 10 }, { coreId: 'B', depthM: 50 });
    const b = makeTie('y', 'manual', { coreId: 'A', depthM: 40 }, { coreId: 'B', depthM: 20 });
    expect(crossingTies([a, b])).toHaveLength(1);
    expect(crossingTies([a])).toHaveLength(0);
  });
});

describe('notebook', () => {
  it('adds, links without duplicates, clamps confidence, round-trips through JSON', () => {
    const nb = new Notebook();
    const h = nb.add({ title: 'A civilization burned the forests', claimType: 'civilization', p: 1.7 }, 3);
    expect(h.p).toBe(1);
    nb.link(h.id, { kind: 'assay', ref: 'c1/hg', label: 'Hg spike' });
    nb.link(h.id, { kind: 'assay', ref: 'c1/hg', label: 'Hg spike' });
    expect(nb.get(h.id)!.evidence).toHaveLength(1);
    nb.update(h.id, { p: 0.3, status: 'supported' });
    const copy = Notebook.fromJSON(JSON.parse(JSON.stringify(nb.toJSON())));
    expect(copy.list()).toEqual(nb.list());
    expect(copy.add({ title: 'second' }).id).toBe('h2');
    expect(() => nb.update('nope', {})).toThrow();
  });
});

describe('save / load', () => {
  const config = (() => {
    const c = makeConfig('save-test', 'dev', { budget: 400 });
    c.grid = { nx: 12, ny: 12, cellKm: 8 };
    c.durationMyr = 30;
    return c;
  })();

  it('replays the action log into an identical session, including ties and notebook', async () => {
    const s1 = new Session(loopback().client);
    const info = await s1.start(config, () => {});
    const cell = Array.from(info.exposure).findIndex((e, i) => e > 20 && info.elevationM[i] > 10);
    const core = await s1.drill(60, 150);
    await s1.assay(core.coreId, 'toc', [2, 4, 6]);
    await s1.date(core.coreId, 20);
    await s1.fossilSample(core.coreId, 30, 2);
    await s1.drill(60, 150); // repeats are not logged twice
    if (cell >= 0) await s1.survey(cell);
    const other = await s1.drill(61, 100);
    s1.addTie('manual', { coreId: core.coreId, depthM: 10 }, { coreId: other.coreId, depthM: 12 });
    s1.notebook.add({ title: 'test' }, s1.actionCount);

    const text = serialize(s1.save());
    const { save, warnings } = parseSave(text);
    expect(warnings).toEqual([]);
    const s2 = new Session(loopback().client);
    const w = await s2.restore(save, () => {});
    expect(w).toEqual([]);
    expect(s2.budget).toBeCloseTo(s1.budget, 9);
    expect([...s2.cores.keys()].sort()).toEqual([...s1.cores.keys()].sort());
    for (const [id, c] of s1.cores) expect(s2.cores.get(id)).toEqual(c);
    expect(s2.assays.get(core.coreId)).toEqual(s1.assays.get(core.coreId));
    expect(s2.dates.get(core.coreId)).toEqual(s1.dates.get(core.coreId));
    expect([...s2.fossils.keys()]).toEqual([...s1.fossils.keys()]);
    expect(s2.ties).toEqual(s1.ties);
    expect(s2.notebook.list()).toEqual(s1.notebook.list());
  }, 60_000);

  it('rejects foreign files and warns about a different model version', () => {
    expect(() => parseSave('{"a":1}')).toThrow();
    const s = JSON.stringify({ format: 'silur-save', version: 1, config: { ...config, modelVersion: '0.0.1' }, actions: [] });
    expect(parseSave(s).warnings).toHaveLength(1);
    expect(() => parseSave(JSON.stringify({ format: 'silur-save', version: 99, config, actions: [] }))).toThrow();
  });
});
