import { describe, expect, it } from 'vitest';
import { Rng, hash32, hashNormal, hashUnit } from '../../src/shared/rng';
import { buildTimePlan } from '../../src/shared/timeplan';
import { addForcing, zeroForcing } from '../../src/shared/forcing';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng('seed-1');
    const b = new Rng('seed-1');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('different seeds differ', () => {
    expect(new Rng('a').next()).not.toBe(new Rng('b').next());
  });
  it('fork depends only on (key, label), not on how much the parent has drawn', () => {
    const p1 = new Rng('world');
    const p2 = new Rng('world');
    for (let i = 0; i < 50; i++) p2.next();
    expect(p1.fork('bio').next()).toBe(p2.fork('bio').next());
    expect(p1.fork('bio').next()).not.toBe(p1.fork('earth').next());
  });
  it('uniform and normal draws have the right moments', () => {
    const r = new Rng('moments');
    let su = 0, sn = 0, sn2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) { su += r.next(); const z = r.normal(); sn += z; sn2 += z * z; }
    expect(su / n).toBeGreaterThan(0.49);
    expect(su / n).toBeLessThan(0.51);
    expect(Math.abs(sn / n)).toBeLessThan(0.03);
    expect(sn2 / n).toBeGreaterThan(0.95);
    expect(sn2 / n).toBeLessThan(1.05);
  });
  it('poisson mean is lambda', () => {
    const r = new Rng('poi');
    for (const lam of [0.5, 4, 50]) {
      let s = 0; const n = 5000;
      for (let i = 0; i < n; i++) s += r.poisson(lam);
      expect(Math.abs(s / n - lam) / lam).toBeLessThan(0.07);
    }
  });
});

describe('stateless hashing', () => {
  it('is order-independent of calls and stable', () => {
    expect(hash32('w', 3, 4.5)).toBe(hash32('w', 3, 4.5));
    expect(hash32('w', 3, 4.5)).not.toBe(hash32('w', 3, 4.25));
    expect(hash32('a', 'b')).not.toBe(hash32('b', 'a'));
    // Golden value: if this changes, every saved observation changes.
    expect(hash32('silur', 1, 2)).toMatchInlineSnapshot(`4290517812`);
  });
  it('hashUnit in [0,1) and hashNormal ~ N(0,1)', () => {
    let s = 0, s2 = 0; const n = 20000;
    for (let i = 0; i < n; i++) {
      const u = hashUnit('u', i); expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1);
      const z = hashNormal('z', i); s += z; s2 += z * z;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(s2 / n).toBeGreaterThan(0.95);
    expect(s2 / n).toBeLessThan(1.05);
  });
});

describe('TimePlan', () => {
  it('is contiguous, covers the duration and ends at the present', () => {
    const p = buildTimePlan({ durationMyr: 100, baseDtYr: 250_000 });
    expect(p.ageBaseMa[0]).toBeCloseTo(100, 10);
    expect(p.ageTopMa[p.n - 1]).toBe(0);
    for (let i = 1; i < p.n; i++) expect(p.ageBaseMa[i]).toBeCloseTo(p.ageTopMa[i - 1], 12);
    let total = 0; for (let i = 0; i < p.n; i++) total += p.dtYr[i];
    expect(total).toBeCloseTo(100e6, 0);
  });
  it('refines inside windows and starts/stops exactly on window edges', () => {
    const p = buildTimePlan({ durationMyr: 10, baseDtYr: 100_000, windows: [{ ageStartMa: 5, ageEndMa: 4.9, dtYr: 1000, tag: 7 }] });
    const inside = [...p.dtYr].filter((_d, i) => p.tag[i] === 7);
    expect(inside.length).toBe(100);
    expect(Math.max(...inside)).toBeLessThanOrEqual(1000 + 1e-6);
    expect(p.ageBaseMa.some((a) => Math.abs(a - 5) < 1e-9)).toBe(true);
    expect(p.ageTopMa.some((a) => Math.abs(a - 4.9) < 1e-9)).toBe(true);
  });
  it('coarsens windows to respect maxSteps', () => {
    const p = buildTimePlan({ durationMyr: 10, baseDtYr: 100_000, maxSteps: 400, windows: [{ ageStartMa: 5, ageEndMa: 4, dtYr: 100 }] });
    expect(p.n).toBeLessThanOrEqual(400);
  });
});

describe('Forcing', () => {
  it('addForcing sums rates and flux-weights δ13C', () => {
    const a = zeroForcing(); a.carbonEmission = 1; a.d13CofEmission = -60;
    const b = zeroForcing(); b.carbonEmission = 3; b.d13CofEmission = -20;
    const c = addForcing(a, b);
    expect(c.carbonEmission).toBe(4);
    expect(c.d13CofEmission).toBeCloseTo(-30, 10);
  });
});
