import { describe, expect, it } from 'vitest';
import { buildTimePlan } from '../../src/shared/timeplan';
import { findEpisodes, findRuns } from '../../src/truth/events/segmenter';
import { buildCatalog } from '../../src/truth/events/catalog';
import type { BioWorld } from '../../src/truth/bio/diversify';
import type { EarthHistory } from '../../src/truth/earth/run';
import { LipEvent, ClathrateEvent, BolideEvent } from '../../src/truth/events/types';

const plan = buildTimePlan({ durationMyr: 100, baseDtYr: 100_000 });
const n = plan.n;
const zero = () => new Float64Array(n);
const stepOf = (age: number) => plan.ageBaseMa.findIndex((a) => a <= age);

function fakeEarth(patch: (m: { anoxic: Float64Array; ice: Float64Array; seaLevel: Float64Array; tempC: Float64Array }) => void): EarthHistory {
  const m = { anoxic: zero(), ice: zero(), seaLevel: zero(), tempC: new Float64Array(n).fill(15) };
  patch(m);
  return { mean: m } as unknown as EarthHistory;
}
function fakeBio(patch: (b: { deaths: Int32Array; living: Int32Array }) => void): BioWorld {
  const b = { deaths: new Int32Array(n).fill(1), living: new Int32Array(n).fill(1000) };
  for (let s = 0; s < n; s++) b.deaths[s] = Math.round(0.1 * (plan.dtYr[s] / 1e6) * 1000); // 0.1 per species per Myr background
  patch(b);
  return b as unknown as BioWorld;
}

describe('findRuns', () => {
  it('finds, merges and filters runs', () => {
    const x = zero();
    for (const s of [10, 11, 12, 14, 15, 40]) x[s] = 1;
    const runs = findRuns(plan, x, 0.5, 0.15, 0.25);
    expect(runs.length).toBe(1); // 10–15 merged across a 0.1-Myr gap; the lone step at 40 is too short
    expect(runs[0].s0).toBe(10); expect(runs[0].s1).toBe(15);
  });
});

describe('segmenter', () => {
  it('detects OAEs, glaciations and hyperthermals, with ages and magnitudes', () => {
    const e = fakeEarth((m) => {
      for (let s = stepOf(60); s < stepOf(59.2); s++) m.anoxic[s] = 0.7;
      for (let s = stepOf(40); s < stepOf(36); s++) { m.ice[s] = 0.9; m.seaLevel[s] = -90; }
      for (let s = stepOf(20); s < stepOf(19.8); s++) m.tempC[s] = 21;
    });
    const eps = findEpisodes(plan, e, fakeBio(() => undefined));
    const by = (t: string) => eps.filter((x) => x.type === t);
    expect(by('oae').length).toBe(1);
    expect(by('oae')[0].ageMa[0]).toBeGreaterThan(59.9); expect(by('oae')[0].magnitude).toBeCloseTo(0.7, 6);
    expect(by('glaciation').length).toBe(1);
    expect(by('glaciation')[0].params.minSeaLevelM).toBe(-90);
    expect(by('hyperthermal').length).toBe(1);
    expect(by('hyperthermal')[0].magnitude).toBeGreaterThan(2.5);
    expect(by('extinction').length).toBe(0); // background only
  });

  it('detects a mass extinction but ignores noise', () => {
    const s0 = stepOf(70);
    const bio = fakeBio((b) => { for (let s = s0; s < s0 + 3; s++) b.deaths[s] = 150; b.deaths[stepOf(30)] += 8; });
    const eps = findEpisodes(plan, fakeEarth(() => undefined), bio).filter((x) => x.type === 'extinction');
    expect(eps.length).toBe(1);
    expect(eps[0].magnitude).toBeGreaterThan(0.3);
    expect(eps[0].ageMa[0]).toBeCloseTo(plan.ageBaseMa[s0], 6);
  });
});

describe('catalog', () => {
  const lip: LipEvent = { kind: 'lip', ageMa: 80, durationMyr: 1, carbonPg: 1e4, d13C: -20, sulfurPg: 1000, hgMult: 10, pulses: [0.5] };
  const clath: ClathrateEvent = { kind: 'clathrate', ageMa: 50, massPg: 4000, onsetKyr: 10 };
  const bol: BolideEvent = { kind: 'bolide', ageMa: 30, diameterKm: 10, xKm: 1000, yKm: 0 };

  it('lists forced events with their ages and links effects to causes', () => {
    const earth = fakeEarth((m) => {
      for (let s = stepOf(79.5); s < stepOf(78.8); s++) m.anoxic[s] = 0.8; // OAE during/after the LIP
      for (let s = stepOf(49.9); s < stepOf(49.5); s++) m.tempC[s] = 22; //   hyperthermal after the clathrate
    });
    const sB = stepOf(30);
    const bio = fakeBio((b) => { for (let s = sB; s < sB + 2; s++) b.deaths[s] = 300; });
    const cat = buildCatalog(plan, earth, bio, [lip, clath, bol]);
    const t = (type: string) => cat.filter((e) => e.type === type);
    expect(t('lip')[0].ageMa).toEqual([80, 79]);
    expect(t('clathrate')[0].magnitude).toBe(4000);
    expect(cat.map((e) => e.id)).toEqual(cat.map((_, i) => i));
    for (let i = 1; i < cat.length; i++) expect(cat[i].ageMa[0]).toBeLessThanOrEqual(cat[i - 1].ageMa[0]);

    expect(t('oae')[0].parents).toContain(t('lip')[0].id);
    expect(t('oae')[0].cause).toBe('lip');
    expect(t('hyperthermal')[0].parents).toContain(t('clathrate')[0].id);
    expect(t('hyperthermal')[0].cause).toBe('clathrate');
    expect(t('extinction')[0].parents).toContain(t('bolide')[0].id);
    expect(t('extinction')[0].cause).toBe('bolide');
  });

  it('effects never precede their causes', () => {
    const earth = fakeEarth((m) => { for (let s = stepOf(90); s < stepOf(89.5); s++) m.anoxic[s] = 0.8; });
    const cat = buildCatalog(plan, earth, fakeBio(() => undefined), [lip]);
    const oae = cat.find((e) => e.type === 'oae')!;
    expect(oae.parents).toEqual([]); // OAE at 90 Ma is older than the LIP at 80 Ma
    expect(oae.cause).toBe('unknown_natural');
  });
});
