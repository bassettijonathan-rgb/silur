import { describe, expect, it } from 'vitest';
import { makeConfig } from '../../src/shared/config';
import { generateWorld, worldHash } from '../../src/truth/world';

const cfg = (seed: string) => { const c = makeConfig(seed, 'dev'); c.grid = { nx: 14, ny: 14, cellKm: 8 }; c.durationMyr = 60; return c; };

describe('whole-world generation', () => {
  it('is reproducible from the seed alone, and different seeds give different worlds', () => {
    const a = generateWorld(cfg('w1')), b = generateWorld(cfg('w1')), c = generateWorld(cfg('w2'));
    expect(worldHash(a)).toBe(worldHash(b));
    expect(worldHash(a)).not.toBe(worldHash(c));
    expect(a.catalog.map((e) => [e.type, e.ageMa[0]])).toEqual(b.catalog.map((e) => [e.type, e.ageMa[0]]));
  });
  it('event density scales the number of catastrophes', () => {
    const lo = makeConfig('dens', 'dev', { eventDensity: 0.2 }), hi = makeConfig('dens', 'dev', { eventDensity: 4 });
    for (const c of [lo, hi]) { c.grid = { nx: 10, ny: 10, cellKm: 8 }; c.durationMyr = 100; }
    expect(generateWorld(hi).forced.length).toBeGreaterThan(generateWorld(lo).forced.length + 3);
  });
  it('every catalog entry is well-formed', () => {
    const w = generateWorld(cfg('w3'));
    for (const e of w.catalog) {
      expect(e.ageMa[0]).toBeGreaterThanOrEqual(e.ageMa[1]);
      expect(e.ageMa[0]).toBeLessThanOrEqual(60.01);
      for (const p of e.parents) expect(w.catalog[p].ageMa[0]).toBeGreaterThanOrEqual(e.ageMa[0] - 0.06);
    }
  });
});
