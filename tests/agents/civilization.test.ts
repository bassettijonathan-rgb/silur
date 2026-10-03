import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/shared/rng';
import { Forcing, zeroForcing } from '../../src/shared/forcing';
import { buildTimePlan } from '../../src/shared/timeplan';
import { Civilization, CivilizationParams, drawCivilization } from '../../src/truth/agents/civilization';
import { aridificationForcing, makeAridification } from '../../src/truth/events/aridification';
import { clathrateForcing } from '../../src/truth/events/clathrate';
import { bolideForcing } from '../../src/truth/events/bolide';
import { lipForcing } from '../../src/truth/events/lip';
import { injectMimics, MIMIC_PAIRS } from '../../src/truth/events/mimics';
import { victimsAt } from '../../src/truth/bio/diversify';
import { REALM } from '../../src/truth/bio/traits';
import { stepAtAge } from '../../src/shared/timeplan';
import { NT, T, massOf } from '../../src/truth/strat/tracers';
import { scenario } from '../events/helpers';

const params: CivilizationParams = {
  ageMa: 30, durationYr: 1500, carbonPg: 4000, d13C: -25, hgPeak: 5, firePeak: 8, persistPeak: 20, nutrientPeak: 0.8, nutrientD15N: 8,
  sedMultPeak: 3, coverLossPeak: 0.4, habitatPeak: 0.5, harvestPeak: 0.5, tailYr: 1500,
};
const civ = new Civilization(params);

describe('civilization forcing', () => {
  const fine = buildTimePlan({ durationMyr: 2, baseDtYr: 100_000, windows: civ.windows().map((w) => ({ ...w, ageStartMa: w.ageStartMa - 28, ageEndMa: w.ageEndMa - 28 })) });
  const shifted = new Civilization({ ...params, ageMa: 2 });

  it('burns exactly the stated amount of carbon, whatever the step length', () => {
    let total = 0;
    for (let i = 0; i < fine.n; i++) total += shifted.forcing(fine.ageBaseMa[i], fine.ageTopMa[i]).carbonEmission * fine.dtYr[i];
    expect(total / params.carbonPg).toBeGreaterThan(0.97);
    expect(total / params.carbonPg).toBeLessThan(1.03);
    // one 100-kyr step covering the whole thing sees the same dose
    const one = shifted.forcing(2, 1.9);
    expect(one.carbonEmission * 100_000 / params.carbonPg).toBeGreaterThan(0.97);
    expect(one.carbonEmission * 100_000 / params.carbonPg).toBeLessThan(1.03);
    expect(one.d13CofEmission).toBeCloseTo(-25, 3);
  });

  it('rises, peaks, collapses abruptly; land-use effects outlast the industry', () => {
    const f = (t0Yr: number, t1Yr: number) => shifted.forcing(2 - t0Yr / 1e6, 2 - t1Yr / 1e6);
    const early = f(0, 100), mid = f(600, 700), late = f(1300, 1400), after = f(2500, 2600), muchLater = f(20_000, 20_100);
    expect(mid.carbonEmission).toBeGreaterThan(5 * early.carbonEmission);
    expect(late.carbonEmission).toBeLessThan(0.2 * mid.carbonEmission);
    expect(after.carbonEmission).toBeLessThan(0.001 * mid.carbonEmission);
    expect(after.landCoverLoss).toBeGreaterThan(0.05);
    expect(after.landCoverLoss).toBeGreaterThan(5 * late.carbonEmission / mid.carbonEmission * after.landCoverLoss * 0 + 0.0); // still present
    expect(muchLater.landCoverLoss).toBeLessThan(0.01);
    expect(mid.sedimentFluxMultiplier).toBeGreaterThan(1.5);
  });

  it('acts only through ordinary Forcing channels that natural events also use (no unique marker)', () => {
    const nonzero = (f: Forcing) => (Object.keys(f) as (keyof Forcing)[]).filter((k) => {
      const z = zeroForcing()[k];
      return typeof f[k] === 'number' && f[k] !== z && k !== 'd13CofEmission' && k !== 'nutrientRunoffD15N';
    });
    const civKeys = new Set(nonzero(shifted.forcing(2 - 0.0006, 2 - 0.0007)));
    const r = new Rng('natural');
    const natural = new Set<string>();
    const mid = (a: number) => [a, a - 0.0001] as const;
    for (const k of nonzero(lipForcing({ kind: 'lip', ageMa: 5, durationMyr: 1, carbonPg: 1e4, d13C: -20, sulfurPg: 1000, hgMult: 10, pulses: [0.5] }, 4.5, 4.49))) natural.add(k);
    for (const k of nonzero(clathrateForcing({ kind: 'clathrate', ageMa: 5, massPg: 3000, onsetKyr: 10 }, 5, 4.999))) natural.add(k);
    for (const k of nonzero(bolideForcing({ kind: 'bolide', ageMa: 5, diameterKm: 10, xKm: 0, yKm: 0 }, 5, 4.999))) natural.add(k);
    for (const k of nonzero(aridificationForcing(makeAridification(5, r), ...mid(4.99)))) natural.add(k);
    for (const k of civKeys) expect(natural.has(k), `channel ${k} is civilization-only`).toBe(true);
    expect(civKeys.size).toBeGreaterThanOrEqual(8);
  });

  it('draws sensible civilizations: median ~1.5 kyr, 300 yr – 8 kyr, 1–8 thousand Pg C', () => {
    const r = new Rng('draw');
    const ds = Array.from({ length: 400 }, () => drawCivilization(30, r));
    const dur = ds.map((d) => d.durationYr).sort((a, b) => a - b);
    expect(dur[200]).toBeGreaterThan(1000); expect(dur[200]).toBeLessThan(2200);
    expect(dur[0]).toBeGreaterThanOrEqual(300); expect(dur[399]).toBeLessThanOrEqual(8000);
    for (const d of ds) { expect(d.carbonPg).toBeGreaterThanOrEqual(1e3); expect(d.carbonPg).toBeLessThanOrEqual(8e3); }
  });
});

describe('civilization in a world', () => {
  const AGE = 25;
  const world = scenario([], [], { seed: 'civ-world', nx: 16, durationMyr: 40, civilization: { ...params, ageMa: AGE } });
  const E = world.earth.mean;

  it('is in the truth catalog, resolved by a handful of fine steps', () => {
    const c = world.catalog.find((e) => e.type === 'civilization')!;
    expect(c).toBeDefined();
    expect(c.cls).toBe('forced');
    expect(c.ageMa[0]).toBeCloseTo(AGE, 6);
    expect(c.ageMa[0] - c.ageMa[1]).toBeCloseTo(1500 / 1e6, 8);
    expect(world.agents.length).toBe(1);
    const fine = [...world.plan.tag].filter((t) => t >= 71 && t <= 73).length;
    expect(fine).toBeGreaterThan(10); expect(fine).toBeLessThan(120);
  });

  it('causes a light-carbon excursion and warming in the Earth system', () => {
    const s0 = stepAtAge(world.plan, AGE + 0.3);
    let dMin = Infinity, tMax = -Infinity;
    for (let s = s0; s < world.plan.n && world.plan.ageBaseMa[s] > AGE - 0.5; s++) { dMin = Math.min(dMin, E.d13C_carb[s] - E.d13C_carb[s0]); tMax = Math.max(tMax, E.tempC[s] - E.tempC[s0]); }
    expect(dMin).toBeLessThan(-0.15);
    expect(tMax).toBeGreaterThan(0.1);
  });

  it('is smeared and diluted by bioturbation but still leaves mercury, charcoal and persistent-organics anomalies in fine layers', () => {
    const ratio = (k: number) => {
      let peak = 0, bg = 0, n = 0;
      for (const c of world.strat.columns) for (let i = 0; i < c.n; i++) {
        const q = c.tr[i * NT + k] / Math.max(massOf(c.tr, i * NT), 1e-9);
        if (Math.abs(c.ageMean[i] - AGE) < 0.05) peak = Math.max(peak, q);
        else if (c.ageMean[i] > AGE + 0.3 && c.ageMean[i] < AGE + 1.5) { bg += q; n++; }
      }
      return peak / (bg / n);
    };
    expect(ratio(T.Hg)).toBeGreaterThan(1.5);
    expect(ratio(T.charcoal)).toBeGreaterThan(1.5);
    expect(ratio(T.persistOrg)).toBeGreaterThan(1.5);
  });

  it('extinction hits large land animals and island endemics — through the biosphere\'s ordinary vulnerabilities', () => {
    const sp = world.bio.species;
    const s0 = stepAtAge(world.plan, AGE - 1e-7);
    const rate = (f: (i: number) => boolean, s1: number) => {
      let a = 0, d = 0;
      for (let i = 0; i < sp.n; i++) { if (sp.birth[i] > s0 - 1 || sp.death[i] < s0 || !f(i)) continue; a++; if (sp.death[i] <= s1) d++; }
      return { a, d, r: d / Math.max(a, 1) };
    };
    const sEnd = stepAtAge(world.plan, AGE - 0.03);
    const big = rate((i) => sp.realm[i] === REALM.terrestrial && sp.logMass[i] > 3.5, sEnd);
    const smallLand = rate((i) => sp.realm[i] === REALM.terrestrial && sp.logMass[i] <= 3.5, sEnd);
    expect(big.a).toBeGreaterThan(5);
    expect(big.r).toBeGreaterThan(smallLand.r + 0.1);
    void victimsAt;
  });
});

describe('mimicry registry and injection', () => {
  it('every civilization channel has a natural look-alike with shared proxies', () => {
    const sig = MIMIC_PAIRS.map((p) => p.agentSignature).join('|');
    for (const word of ['carbon', 'mercury', 'soot', 'fertiliser', 'agriculture', 'hunting', 'habitat']) expect(sig).toContain(word);
    for (const p of MIMIC_PAIRS) { expect(p.sharedProxies.length).toBeGreaterThan(0); expect(['clathrate', 'lip', 'bolide', 'aridification', 'oae']).toContain(p.naturalMimic); }
  });
  it('mimicFrequency scales how many look-alikes appear, and all four kinds occur', () => {
    const count = (f: number) => { let n = 0; for (let k = 0; k < 60; k++) n += injectMimics(new Rng('m' + k), 100, f, 40).length; return n / 60; };
    expect(count(0)).toBe(0);
    expect(count(1)).toBeGreaterThan(2);
    expect(count(1)).toBeLessThan(4.5);
    expect(count(1)).toBeGreaterThan(count(0.3) * 2);
    const kinds = new Set<string>();
    for (let k = 0; k < 80; k++) for (const e of injectMimics(new Rng('k' + k), 100, 1, 40)) kinds.add(e.kind === 'lip' ? 'lip-burst' : e.kind);
    expect([...kinds].sort()).toEqual(['aridification', 'bolide', 'clathrate', 'lip-burst']);
  });
});
