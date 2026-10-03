import { describe, expect, it } from 'vitest';
import { emptyDraft, newEvent, removeEvent, setCause } from '../../src/game/draft';
import { HISTORY_KEY, calibrationError, loadHistory, recordGame, reliability } from '../../src/game/history';
import { parseSave, serialize } from '../../src/game/save';
import { Session } from '../../src/game/session';
import { makeConfig } from '../../src/shared/config';
import { CAUSES } from '../../src/shared/submission';
import { loopback } from '../worker/loopback';

describe('draft editing', () => {
  it('adds events with unique ids and a uniform cause prior for episodes only', () => {
    const d = emptyDraft();
    const a = newEvent(d, 'extinction', 66, 65), b = newEvent(d, 'lip', 70, 69);
    expect(a.id).not.toBe(b.id);
    expect(a.ageMinMa).toBe(65);
    expect(Object.keys(b.causes)).toHaveLength(0);
    expect(Object.values(a.causes).reduce((x, y) => x + y!, 0)).toBeCloseTo(1, 9);
    removeEvent(d, a.id);
    expect(newEvent(d, 'oae', 1, 2).id).not.toBe(b.id);
  });
  it('setCause keeps the distribution normalised', () => {
    const e = newEvent(emptyDraft(), 'oae', 1, 2);
    setCause(e, 'lip', 0.7);
    expect(e.causes.lip).toBeCloseTo(0.7, 9);
    expect(CAUSES.reduce((a, c) => a + (e.causes[c] ?? 0), 0)).toBeCloseTo(1, 9);
    setCause(e, 'lip', 1);
    expect(e.causes.bolide).toBeCloseTo(0, 9);
    setCause(e, 'bolide', 0.5);
    expect(CAUSES.reduce((a, c) => a + (e.causes[c] ?? 0), 0)).toBeCloseTo(1, 9);
  });
});

describe('calibration history', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
  it('bins statements and measures the gap between stated probability and frequency', () => {
    const good = Array.from({ length: 1000 }, (_, i) => ({ kind: 'event' as const, p: 0.8, outcome: i % 10 < 8 }));
    const bad = Array.from({ length: 1000 }, (_, i) => ({ kind: 'event' as const, p: 0.9, outcome: i % 10 < 3 }));
    expect(calibrationError(reliability(good))).toBeLessThan(0.01);
    expect(calibrationError(reliability(bad))).toBeGreaterThan(0.5);
    expect(reliability(good).filter((b) => b.n > 0)).toHaveLength(1);
  });
  it('persists the last games, tolerates corrupt or missing storage', () => {
    const kv = mem();
    for (let i = 0; i < 55; i++) recordGame(kv, { seed: `s${i}`, at: i, total: i, headlineBits: 0, statements: [] });
    expect(loadHistory(kv)).toHaveLength(50);
    expect(loadHistory(kv)[49].seed).toBe('s54');
    kv.m.set(HISTORY_KEY, '{oops');
    expect(loadHistory(kv)).toEqual([]);
    expect(loadHistory(null)).toEqual([]);
    expect(() => recordGame(null, { seed: 'x', at: 1, total: 0, headlineBits: 0, statements: [] })).not.toThrow();
  });
});

describe('submission in the session and the save file', () => {
  const config = (() => { const c = makeConfig('submit-test', 'dev', { budget: 400, maxTries: 1 }); c.grid = { nx: 12, ny: 12, cellKm: 8 }; c.durationMyr = 30; return c; })();
  it('submit closes the investigation; a saved game that was submitted replays to the same reveal', async () => {
    const s1 = new Session(loopback().client);
    await s1.start(config, () => {});
    await s1.drill(60, 100);
    s1.draft.pCivilization = 0.25;
    newEvent(s1.draft, 'extinction', 5, 25);
    const r1 = await s1.submit();
    await expect(s1.drill(61, 50)).rejects.toMatchObject({ code: 'already_submitted' });
    const { save } = parseSave(serialize(s1.save()));
    expect(save.submitted).toBe(true);
    const s2 = new Session(loopback().client);
    await s2.restore(save, () => {});
    expect(s2.result).toEqual(r1);
    expect(s2.draft).toEqual(s1.draft);
  }, 60_000);
});
