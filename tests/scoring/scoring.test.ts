import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/shared/rng';
import {
  ALPHA, EVENT_WEIGHT, MISS_BITS, ScoreTarget, ageBitsRaw, assign, binaryBits, brier, categoricalBits, intervalScore, matchEvents, scoreSubmission,
} from '../../src/shared/scoring';
import { CAUSES, SubmittedEvent, sanitizeSubmission } from '../../src/shared/submission';

const ev = (id: string, type: SubmittedEvent['type'], lo: number, hi: number, exists = 0.9, causes: SubmittedEvent['causes'] = {}): SubmittedEvent =>
  ({ id, type, ageMinMa: lo, ageMaxMa: hi, exists, causes });
const tg = (id: number, type: ScoreTarget['type'], old: number, young: number, cause: ScoreTarget['cause'] = 'unknown_natural', weight = 1, cluster = id): ScoreTarget =>
  ({ id, type, ageMa: [old, young], cause, weight, cluster });

describe('propriety: honest belief maximises expected score', () => {
  const grid = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
  it('binary log score (headline probability, event existence)', () => {
    for (const pi of [0.1, 0.4, 0.75]) {
      const exp = (p: number) => pi * binaryBits(p, true) + (1 - pi) * binaryBits(p, false);
      const best = grid.reduce((a, p) => (exp(p) > exp(a) ? p : a), 0.5);
      expect(Math.abs(best - pi)).toBeLessThanOrEqual(0.011);
    }
  });
  it('categorical log score over the causes', () => {
    const truth = [0.5, 0.2, 0.1, 0.1, 0.05, 0.03, 0.02];
    const exp = (q: number[]) => truth.reduce((a, t, i) => a + t * categoricalBits(q[i]), 0);
    const honest = exp(truth);
    const rng = new Rng('cat');
    for (let k = 0; k < 200; k++) {
      const raw = truth.map(() => rng.next() + 0.02); const s = raw.reduce((a, b) => a + b, 0);
      expect(exp(raw.map((x) => x / s))).toBeLessThanOrEqual(honest + 1e-9);
    }
  });
  it('Brier', () => {
    const pi = 0.3, exp = (p: number) => pi * brier(p, true) + (1 - pi) * brier(p, false);
    expect(exp(pi)).toBeLessThan(exp(0.5)); expect(exp(pi)).toBeLessThan(exp(0.1));
  });
  it('interval score is minimised by the true 10 % and 90 % quantiles', () => {
    const rng = new Rng('is');
    const xs = Array.from({ length: 6000 }, () => rng.normal());
    const exp = (l: number, u: number) => xs.reduce((a, x) => a + intervalScore(l, u, x), 0) / xs.length;
    const z = 1.2816;
    const honest = exp(-z, z);
    for (const [l, u] of [[-0.5, 0.5], [-3, 3], [-1, 2], [-2, 1], [-z * 0.8, z * 0.8], [-z * 1.3, z * 1.3]]) expect(exp(l, u)).toBeGreaterThan(honest);
    // and the age reward is an affine function of it, so it is proper too (before the floor)
    expect(ageBitsRaw(1)).toBeGreaterThan(ageBitsRaw(2));
    expect(ALPHA).toBe(0.2);
  });
  it('a well-calibrated whole submission beats an overconfident one in expectation', () => {
    // simulate worlds where the player truly has 70 % credence in an event that is real 70 % of the time
    const rng = new Rng('whole');
    const mean = (q: number) => {
      let tot = 0;
      for (let i = 0; i < 4000; i++) {
        const real = rng.next() < 0.7;
        const r = scoreSubmission({ pCivilization: 0.5, events: [ev('a', 'lip', 10, 11, q)] }, real ? [tg(1, 'lip', 10.5, 10.5)] : [], false);
        tot += r.totals.existence;
      }
      return tot / 4000;
    };
    expect(mean(0.7)).toBeGreaterThan(mean(0.99));
    expect(mean(0.7)).toBeGreaterThan(mean(0.3));
  });
});

describe('assignment and matching', () => {
  it('finds the minimum-cost assignment, rectangular in either direction', () => {
    expect(assign([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
    expect(assign([[1, 9], [9, 1], [5, 5]]).filter((j) => j >= 0).sort()).toEqual([0, 1]);
    expect(assign([[5, 1, 9]])).toEqual([1]);
    expect(assign([])).toEqual([]);
  });
  it('matches by type and overlapping age, preferring the closest pair', () => {
    const targets = [tg(1, 'oae', 85.9, 85.8), tg(2, 'oae', 85.6, 85.5), tg(3, 'lip', 85.9, 85.8)];
    const subs = [ev('x', 'oae', 85.55, 85.62), ev('y', 'oae', 85.8, 85.95), ev('z', 'glaciation', 85.8, 85.9)];
    const m = matchEvents(subs, targets);
    expect(m.get('x')!.id).toBe(2);
    expect(m.get('y')!.id).toBe(1);
    expect(m.has('z')).toBe(false);
  });
  it('does not let two submissions claim one event', () => {
    const m = matchEvents([ev('a', 'lip', 10, 10.4), ev('b', 'lip', 10.1, 10.5)], [tg(1, 'lip', 10.3, 10.2)]);
    expect(m.size).toBe(1);
  });
  it('a submission far from the truth in age does not match', () => {
    expect(matchEvents([ev('a', 'lip', 50, 51)], [tg(1, 'lip', 10, 9.9)]).size).toBe(0);
  });
});

describe('scoreSubmission', () => {
  const targets = [tg(1, 'extinction', 66.1, 66.0, 'bolide'), tg(2, 'lip', 70, 69, 'lip', 1), tg(3, 'bolide', 20, 20, 'bolide', 0)];
  it('rewards a right answer, charges for false positives and detectable misses, and never for undetectable ones', () => {
    const sub = { pCivilization: 0.1, events: [
      ev('e1', 'extinction', 66, 66.2, 0.9, { bolide: 0.8, lip: 0.1, unknown_natural: 0.1 }),
      ev('fp', 'glaciation', 30, 32, 0.8),
    ] };
    const r = scoreSubmission(sub, targets, false);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].covered).toBe(true);
    expect(r.matches[0].causeBits).toBeGreaterThan(1);
    expect(r.falsePositives.map((f) => f.submittedId)).toEqual(['fp']);
    expect(r.falsePositives[0].bits).toBeLessThan(0);
    expect(r.misses.map((m) => m.truthId)).toEqual([2]); // the weight-0 impact costs nothing
    expect(r.misses[0].bits).toBe(-MISS_BITS);
    expect(r.headline.bits).toBeGreaterThan(0);
    expect(r.totals.total).toBeCloseTo(r.totals.headline + r.totals.existence + r.totals.cause + r.totals.age + r.totals.miss, 9);
  });
  it('blanket honesty about not knowing gives 0 headline bits; overconfident-and-wrong is floored, not infinite', () => {
    expect(scoreSubmission({ pCivilization: 0.5, events: [] }, [], true).totals.headline).toBeCloseTo(0, 9);
    const wrong = scoreSubmission({ pCivilization: 0, events: [] }, [], true).totals.headline;
    expect(wrong).toBeCloseTo(Math.log2(0.01 / 0.5), 9);
  });
  it('an episode without a stated cause scores 0 cause bits (uniform)', () => {
    const r = scoreSubmission({ pCivilization: 0.5, events: [ev('a', 'extinction', 66, 66.2, 0.9)] }, targets, false);
    expect(r.matches[0].causeBits).toBeCloseTo(0, 9);
  });
  it('age reward falls with a wider or a wrong interval', () => {
    const f = (lo: number, hi: number) => scoreSubmission({ pCivilization: 0.5, events: [ev('a', 'lip', lo, hi)] }, [tg(2, 'lip', 70, 69, 'lip')], false).totals.age;
    expect(f(69.4, 69.6)).toBeGreaterThan(f(68, 71));
    expect(f(68, 71)).toBeGreaterThan(f(69.9, 70.05)); // narrow and wrong is worse than wide and right
  });
  it('lists every cause the sanitiser accepts', () => { expect(CAUSES).toContain('civilization'); });
});

describe('forgiving rules', () => {
  it('an episode claim can stand for the forced event that caused it, and is then judged on its cause', () => {
    const t = [tg(1, 'clathrate', 56, 55.9, 'clathrate')];
    const r = scoreSubmission({ pCivilization: 0.5, events: [ev('a', 'hyperthermal', 55.8, 56.1, 0.8, { clathrate: 0.7, lip: 0.3 })] }, t, false);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].causeBits).toBeGreaterThan(1);
    const wrong = scoreSubmission({ pCivilization: 0.5, events: [ev('a', 'hyperthermal', 55.8, 56.1, 0.8, { lip: 0.9, clathrate: 0.1 })] }, t, false);
    expect(wrong.matches[0].causeBits!).toBeLessThan(0);
  });
  it('exact types are preferred to aliases', () => {
    const t = [tg(1, 'clathrate', 56, 55.9, 'clathrate'), tg(2, 'hyperthermal', 56, 55.9, 'clathrate')];
    const m = matchEvents([ev('a', 'hyperthermal', 55.8, 56.1)], t);
    expect(m.get('a')!.id).toBe(2);
  });
  it('misses are charged once per cluster, and not at all if any member was found', () => {
    const cluster = [tg(1, 'lip', 70, 69, 'lip', 1, 7), tg(2, 'oae', 69.5, 69.4, 'lip', 0.8, 7), tg(3, 'extinction', 69.3, 69.2, 'lip', 0.6, 7)];
    const none = scoreSubmission({ pCivilization: 0.5, events: [] }, cluster, false);
    expect(none.misses).toHaveLength(1);
    expect(none.totals.miss).toBeCloseTo(-MISS_BITS * EVENT_WEIGHT, 9);
    expect(none.doNothing).toBeCloseTo(-MISS_BITS * EVENT_WEIGHT, 9);
    const some = scoreSubmission({ pCivilization: 0.5, events: [ev('x', 'oae', 69.3, 69.6, 0.9, { lip: 1 })] }, cluster, false);
    expect(some.misses).toHaveLength(0);
  });
});

describe('sanitizeSubmission', () => {
  it('clamps, orders, normalises, and rejects nonsense', () => {
    const s = sanitizeSubmission({ pCivilization: 1.4, events: [{ id: 'a', type: 'oae', ageMinMa: 5, ageMaxMa: 3, exists: -1, causes: { lip: 2, bolide: 2, civilization: 0 } }] });
    expect(s.pCivilization).toBe(1);
    expect(s.events[0]).toMatchObject({ ageMinMa: 3, ageMaxMa: 5, exists: 0 });
    expect(s.events[0].causes).toEqual({ lip: 0.5, bolide: 0.5 });
    expect(() => sanitizeSubmission(null)).toThrow();
    expect(() => sanitizeSubmission({ pCivilization: 'x', events: [] })).toThrow();
    expect(() => sanitizeSubmission({ pCivilization: 0.5, events: [{ id: 'a', type: 'dragon', ageMinMa: 1, ageMaxMa: 2, exists: 1, causes: {} }] })).toThrow();
    expect(() => sanitizeSubmission({ pCivilization: 0.5, events: [{ id: 'a', type: 'lip', ageMinMa: NaN, ageMaxMa: 2, exists: 1, causes: {} }] })).toThrow();
    const dup = { id: 'a', type: 'lip', ageMinMa: 1, ageMaxMa: 2, exists: 1, causes: {} };
    expect(() => sanitizeSubmission({ pCivilization: 0.5, events: [dup, dup] })).toThrow();
  });
});
