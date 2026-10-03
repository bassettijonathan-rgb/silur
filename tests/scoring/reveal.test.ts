import { describe, expect, it } from 'vitest';
import { auditEvents, scoreAndReveal, significance } from '../../src/observation/reveal';
import { makeConfig } from '../../src/shared/config';
import { Submission, SubmittedEvent, SubmissionType, CauseId } from '../../src/shared/submission';
import { worldHash } from '../../src/truth/world';
import { BolideEvent, LipEvent } from '../../src/truth/events/types';
import { scenario } from '../events/helpers';
import { loopback } from '../worker/loopback';

const lip: LipEvent = { kind: 'lip', ageMa: 40, durationMyr: 0.5, carbonPg: 15000, d13C: -6, sulfurPg: 2000, hgMult: 20, pulses: [0, 0.3] };
const impact: BolideEvent = { kind: 'bolide', ageMa: 20, diameterKm: 10, xKm: 0, yKm: 0 };
const world = scenario([lip, impact], [], { seed: 'reveal', nx: 16, durationMyr: 50, exhumeMyr: 0 });

const SUB_TYPES = new Set<string>(['glaciation', 'oae', 'hyperthermal', 'extinction', 'lip', 'bolide', 'clathrate', 'supernova', 'aridification', 'civilization']);
const CAUSE_IDS = new Set<string>(['lip', 'bolide', 'clathrate', 'supernova', 'civilization', 'tectonic', 'unknown_natural']);

/** A player who knows the truth exactly. */
function oracle(): Submission {
  const events: SubmittedEvent[] = world.catalog.filter((e) => SUB_TYPES.has(e.type)).map((e, i) => ({
    id: `o${i}`, type: e.type as SubmissionType, ageMinMa: e.ageMa[1] - 0.05, ageMaxMa: e.ageMa[0] + 0.05, exists: 0.9,
    causes: CAUSE_IDS.has(e.cause) ? { [e.cause as CauseId]: 0.9, unknown_natural: 0.1 } : {},
  }));
  return { pCivilization: 0.05, events };
}

describe('preservation audit', () => {
  const audits = auditEvents(world);
  it('has one entry per catalog event with sane numbers', () => {
    expect(audits).toHaveLength(world.catalog.length);
    for (const a of audits) {
      expect(a.detectability).toBeGreaterThanOrEqual(0); expect(a.detectability).toBeLessThanOrEqual(1);
      expect(a.weight).toBeCloseTo(a.significance * a.detectability, 12);
    }
  });
  it('events whose rock survives are detectable; small impacts are insignificant', () => {
    const l = world.catalog.findIndex((e) => e.type === 'lip');
    expect(audits[l].preservedCells).toBeGreaterThan(0);
    expect(audits[l].weight).toBeGreaterThan(0.5);
    expect(significance({ ...world.catalog[0], type: 'bolide', magnitude: 1 })).toBe(0);
    expect(significance({ ...world.catalog[0], type: 'bolide', magnitude: 10 })).toBe(1);
  });
  it('erosion lowers detectability: an exhumed world loses the record of old events', () => {
    const eroded = scenario([lip, impact], [], { seed: 'reveal', nx: 16, durationMyr: 50, exhumeMyr: 45 });
    const a = auditEvents(eroded), b = audits;
    const iL = eroded.catalog.findIndex((e) => e.type === 'lip');
    const iB = world.catalog.findIndex((e) => e.type === 'lip');
    expect(a[iL].preservedCells).toBeLessThanOrEqual(b[iB].preservedCells);
    expect(a[iL].erasedThicknessM).toBeGreaterThan(b[iB].erasedThicknessM);
    expect(eroded.strat.erased.n).toBeGreaterThan(0);
  });
});

describe('scoreAndReveal', () => {
  it('the oracle beats an empty answer and a confidently wrong one', () => {
    const o = scoreAndReveal(world, null, oracle()).score.totals.total;
    const empty = scoreAndReveal(world, null, { pCivilization: 0.5, events: [] }).score.totals.total;
    const wrong = scoreAndReveal(world, null, { pCivilization: 0.99, events: [{ id: 'x', type: 'clathrate', ageMinMa: 30, ageMaxMa: 31, exists: 0.99, causes: {} }] }).score.totals.total;
    expect(o).toBeGreaterThan(empty);
    expect(empty).toBeGreaterThan(wrong);
  });
  it('reports the whole truth, marks matched events, and carries the hash', () => {
    const { score, reveal } = scoreAndReveal(world, null, oracle());
    expect(reveal.worldHash).toBe(worldHash(world));
    expect(reveal.events).toHaveLength(world.catalog.length);
    expect(reveal.civilization.present).toBe(false);
    expect(reveal.ideal).toBeNull();
    expect(reveal.curves.series.every((s) => s.values.length === reveal.curves.ageMa.length)).toBe(true);
    expect(reveal.curves.series.flatMap((s) => s.values).every(Number.isFinite)).toBe(true);
    expect(score.matches.length).toBeGreaterThan(1);
    const matchedIds = new Set(reveal.events.filter((e) => e.audit.matchedBy).map((e) => e.id));
    expect(matchedIds.size).toBe(score.matches.length);
    expect(score.matches.every((m) => m.covered)).toBe(true);
  });
  it('is structured-clone safe', () => { expect(() => structuredClone(scoreAndReveal(world, null, oracle()))).not.toThrow(); });
});

describe('sealing through the worker protocol', () => {
  const config = (() => { const c = makeConfig('seal', 'dev', { budget: 100, maxTries: 1 }); c.grid = { nx: 12, ny: 12, cellKm: 8 }; c.durationMyr = 30; return c; })();
  it('reveals nothing before a submission; afterwards closes the investigation; allows one submission', async () => {
    const { client, log } = loopback(() => world);
    await client.generate(config);
    const core = await client.act({ kind: 'drill', cell: 60, depthM: 50 });
    expect(core.kind).toBe('core');
    expect(log.some((m) => m.kind === 'revealed')).toBe(false);
    expect(JSON.stringify(log)).not.toContain('"catalog"');
    const res = await client.submit({ pCivilization: 0.3, events: [] });
    expect(res.reveal.events.length).toBe(world.catalog.length);
    await expect(client.act({ kind: 'drill', cell: 61, depthM: 50 })).rejects.toMatchObject({ code: 'already_submitted' });
    await expect(client.submit({ pCivilization: 0.3, events: [] })).rejects.toMatchObject({ code: 'already_submitted' });
  });
  it('with the real world factory the ideal observer\'s verdict comes with the reveal', async () => {
    const { client } = loopback();
    await client.generate(config);
    const res = await client.submit({ pCivilization: 0.4, events: [] });
    expect(res.reveal.ideal).not.toBeNull();
    expect(res.reveal.ideal!.pCivilization).toBeGreaterThanOrEqual(0);
    expect(res.reveal.ideal!.attempts).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
