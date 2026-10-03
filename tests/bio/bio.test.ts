import { describe, expect, it } from 'vitest';
import { hash32 } from '../../src/shared/rng';
import { stepAtAge } from '../../src/shared/timeplan';
import { ALIVE, BEFORE_RECORD } from '../../src/truth/bio/species';
import { runBiosphere, victimsAt } from '../../src/truth/bio/diversify';
import { drawAssemblage, preservation } from '../../src/truth/bio/taphonomy';
import { communityAt, EnvContext } from '../../src/truth/bio/community';
import { HARD, MINERAL, REALM, TROPHIC } from '../../src/truth/bio/traits';
import { F } from '../../src/truth/strat/facies';
import { Rng } from '../../src/shared/rng';
import { makeBio, pulse } from './helpers';

const odds = (a: number, b: number, c: number, d: number) => ((a + 0.5) / (b + 0.5)) / ((c + 0.5) / (d + 0.5));

/** Odds ratio of dying for species in `group` vs not, among species alive just before step s. */
function oddsRatio(bio: ReturnType<typeof makeBio>['bio'], s: number, group: (i: number) => boolean): { or: number; killed: number; alive: number } {
  const { alive, died } = victimsAt(bio, s);
  const dead = new Set(died);
  let gd = 0, gs = 0, od = 0, os = 0;
  for (const i of alive) {
    if (group(i)) { if (dead.has(i)) gd++; else gs++; }
    else { if (dead.has(i)) od++; else os++; }
  }
  return { or: odds(gd, gs, od, os), killed: died.length, alive: alive.length };
}

describe('integrity of the tree of life', () => {
  const { bio } = makeBio({ seed: 'tree', durationMyr: 100 });
  const sp = bio.species;

  it('parents exist, predate their children, and belong to the same clade', () => {
    let roots = 0;
    for (let i = 0; i < sp.n; i++) {
      const p = sp.parent[i];
      if (p < 0) { roots++; continue; }
      expect(p).toBeLessThan(i);
      expect(sp.birth[p]).toBeLessThanOrEqual(sp.birth[i]);
      expect(sp.death[p] >= sp.birth[i] || sp.death[p] === ALIVE).toBe(true); // parent alive when child born
      expect(sp.clade[p]).toBe(sp.clade[i]);
    }
    expect(roots).toBeGreaterThan(100); // standing biosphere + late clades
  });

  it('terrestrial clades appear only after their origin', () => {
    for (let i = 0; i < sp.n; i++) {
      const cl = bio.clades[sp.clade[i]];
      if (cl.originFrac === 0) continue;
      const earliest = Math.floor(cl.originFrac * bio.plan.n * 0.999) - 2;
      expect(sp.birth[i]).toBeGreaterThanOrEqual(Math.max(0, earliest - 5));
      expect(sp.birth[i]).not.toBe(BEFORE_RECORD);
    }
  });

  it('has every kind of life: calcifiers of each mineralogy, soft-bodied, burrowers, large land animals, island endemics', () => {
    const has = (f: (i: number) => boolean) => { for (let i = 0; i < sp.n; i++) if (f(i)) return true; return false; };
    expect(has((i) => sp.mineral[i] === MINERAL.aragonite)).toBe(true);
    expect(has((i) => sp.mineral[i] === MINERAL.lmc)).toBe(true);
    expect(has((i) => sp.hard[i] === HARD.soft)).toBe(true);
    expect(has((i) => sp.burrower[i] === 1)).toBe(true);
    expect(has((i) => sp.realm[i] === REALM.terrestrial && sp.logMass[i] > 4)).toBe(true);
    expect(has((i) => sp.insular[i] === 1)).toBe(true);
  });

  it('is deterministic for a seed, and independent of the other subsystems\' random draws', () => {
    const h = (b: typeof bio) => hash32(b.species.n, b.living[10], b.living[b.plan.n - 1], b.deaths[20], b.species.logMass[50]);
    const a = makeBio({ seed: 'det-bio', durationMyr: 40 }).bio;
    const b = makeBio({ seed: 'det-bio', durationMyr: 40 }).bio;
    const c = makeBio({ seed: 'det-bio-2', durationMyr: 40 }).bio;
    expect(h(a)).toBe(h(b));
    expect(h(a)).not.toBe(h(c));
  });
});

describe('diversity dynamics', () => {
  const { bio } = makeBio({ seed: 'dyn', durationMyr: 120 });
  const kTotal = bio.params.kRealm.reduce((a, b) => a + b, 0);
  const eq = 1 - bio.params.h0 / bio.params.lambda0; // equilibrium fraction of K

  it('stays within a band set by carrying capacity (diversity-dependent speciation)', () => {
    const last = bio.living[bio.plan.n - 1];
    expect(last).toBeGreaterThan(0.45 * eq * kTotal);
    expect(last).toBeLessThan(1.05 * kTotal);
    for (let s = 0; s < bio.plan.n; s++) expect(bio.living[s]).toBeGreaterThan(100);
  });

  it('turns over: background extinction roughly h0 per species per Myr', () => {
    const mid = Math.floor(bio.plan.n / 2);
    let d = 0, l = 0, dtMyr = 0;
    for (let s = mid; s < bio.plan.n; s++) { d += bio.deaths[s]; l += bio.living[s]; dtMyr += bio.plan.dtYr[s] / 1e6; }
    const rate = d / (l / (bio.plan.n - mid)) / dtMyr;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.4);
  });

  it('recovers slowly from a mass extinction (> 2 Myr) and then refills', () => {
    const big = makeBio({
      seed: 'recover', durationMyr: 120,
      tweak: (e) => pulse(e, 200, { lightReduction: (0.9 / e.plan.dtYr[200]) * 1.2 }), // ~1 yr of near-darkness
    });
    const b = big.bio, s0 = 200;
    const before = b.living[s0 - 1];
    const after = b.living[s0];
    expect(after).toBeLessThan(0.6 * before);
    // time to get back to 90 % of the pre-event diversity
    let t = 0, back = -1;
    for (let s = s0 + 1; s < b.plan.n; s++) { t += b.plan.dtYr[s] / 1e6; if (b.living[s] >= 0.9 * before) { back = t; break; } }
    expect(back).toBeGreaterThan(2);
    expect(back).toBeLessThan(60);
  });
});

describe('selective extinction (design §10: odds ratio > 3)', () => {
  const S0 = 250;

  it('ocean acidification kills calcifiers, aragonite-builders worst', () => {
    // a sharp drop in aragonite saturation, held for ~100 kyr
    const { bio } = makeBio({
      seed: 'acid', durationMyr: 100,
      tweak: (e) => { for (let s = S0; s < S0 + 3; s++) e.mean.omegaArag[s] *= 0.45; },
    });
    const calc = oddsRatio(bio, S0, (i) => bio.species.hard[i] === HARD.carbonate && bio.species.realm[i] === REALM.marine);
    expect(calc.killed).toBeGreaterThan(30);
    expect(calc.or).toBeGreaterThan(3);
    const arag = oddsRatio(bio, S0, (i) => bio.species.mineral[i] === MINERAL.aragonite);
    const lmc = oddsRatio(bio, S0, (i) => bio.species.mineral[i] === MINERAL.lmc);
    expect(arag.or).toBeGreaterThan(lmc.or);
    // land life is untouched
    expect(oddsRatio(bio, S0, (i) => bio.species.realm[i] === REALM.terrestrial).or).toBeLessThan(1);
  });

  it('an impact winter kills big endotherms and photosynthesisers; burrowers and detritivores survive', () => {
    const { bio } = makeBio({
      seed: 'winter', durationMyr: 100,
      tweak: (e) => pulse(e, S0, { lightReduction: 0.9 / e.plan.dtYr[S0] * 2 }), // 2 yr of 90 % darkness, averaged over the step
    });
    const bigLand = oddsRatio(bio, S0, (i) => bio.species.realm[i] === REALM.terrestrial && bio.species.endo[i] === 1 && bio.species.logMass[i] > 3);
    const burrow = oddsRatio(bio, S0, (i) => bio.species.burrower[i] === 1 || bio.species.trophic[i] === TROPHIC.detritivore);
    const auto = oddsRatio(bio, S0, (i) => bio.species.trophic[i] === TROPHIC.autotroph);
    expect(bigLand.killed).toBeGreaterThan(30);
    expect(bigLand.or).toBeGreaterThan(3);
    expect(auto.or).toBeGreaterThan(3);
    expect(burrow.or).toBeLessThan(0.5);
  });

  it('a hunting + land-conversion episode kills large land animals and island endemics (the civilization signature)', () => {
    const dt = 1000;
    const { bio } = makeBio({
      seed: 'hunters', durationMyr: 100,
      tweak: (e) => {
        // Make the step a 1-kyr civilization-style step. Doses: 1.5 kyr of 0.6 harvest, 0.5 conversion.
        for (let k = 0; k < 1; k++) pulse(e, 300, { harvestPressure: 0.6 * 1500 / e.plan.dtYr[300], habitatConversion: 0.5 * 1500 / e.plan.dtYr[300] });
        void dt;
      },
    });
    const big = oddsRatio(bio, 300, (i) => bio.species.realm[i] === REALM.terrestrial && bio.species.logMass[i] > 4);
    const island = oddsRatio(bio, 300, (i) => bio.species.insular[i] === 1);
    const marine = oddsRatio(bio, 300, (i) => bio.species.realm[i] === REALM.marine);
    expect(big.alive).toBeGreaterThan(20);
    expect(big.or).toBeGreaterThan(3);
    expect(island.or).toBeGreaterThan(3);
    expect(marine.or).toBeLessThan(1);
  });

  it('anoxia kills benthic and deep-shelf marine life, not plankton', () => {
    const { bio } = makeBio({ seed: 'anox', durationMyr: 100, tweak: (e) => { for (let s = 250; s < 253; s++) e.mean.anoxic[s] = 0.9; } });
    const benthic = oddsRatio(bio, 250, (i) => bio.species.realm[i] === REALM.marine && !bio.species.pelagic[i] && bio.species.depthPref[i] > 100);
    const plankton = oddsRatio(bio, 250, (i) => bio.species.realm[i] === REALM.marine && bio.species.pelagic[i] === 1);
    expect(benthic.or).toBeGreaterThan(3);
    expect(benthic.or).toBeGreaterThan(plankton.or * 2);
  });

  it('fast warming hits narrow thermal specialists harder than generalists', () => {
    const { bio } = makeBio({ seed: 'hot', durationMyr: 100, tweak: (e) => { for (let s = 250; s < 254; s++) e.mean.tempC[s] += 8; } });
    const narrow = oddsRatio(bio, 250, (i) => bio.species.breadth[i] < 0.35);
    expect(narrow.or).toBeGreaterThan(2);
  });
});

describe('the fossil record is a biased sample', () => {
  const { bio } = makeBio({ seed: 'taph', durationMyr: 60 });
  const base: EnvContext = { facies: F.shelfCarbonate, waterDepthM: 30, bottomO2: 200, latDeg: 20, sedRateMPerMyr: 300, burialDepthM: 500, ageMa: 30, lagerstatte: false };
  // find a representative species of each kind
  const find = (f: (i: number) => boolean) => { for (let i = 0; i < bio.species.n; i++) if (f(i)) return i; throw new Error('no such species'); };
  const sp = bio.species;
  const marineShell = find((i) => sp.realm[i] === REALM.marine && sp.hard[i] === HARD.carbonate && sp.mineral[i] === MINERAL.lmc);
  const marineBone = find((i) => sp.realm[i] === REALM.marine && sp.hard[i] === HARD.phosphate);
  const marineChitin = find((i) => sp.realm[i] === REALM.marine && sp.hard[i] === HARD.chitin);
  const marineSoft = find((i) => sp.realm[i] === REALM.marine && sp.hard[i] === HARD.soft);
  const landBone = find((i) => sp.realm[i] === REALM.terrestrial && sp.hard[i] === HARD.phosphate);
  const landSoft = find((i) => sp.realm[i] === REALM.terrestrial && sp.hard[i] === HARD.soft);

  it('hard-bodied marine ≫ chitinous ≫ soft-bodied; land animals are rarely preserved', () => {
    const p = (i: number, ctx = base, land = false) => preservation(bio, i, land ? { ...ctx, facies: F.terrestrial, waterDepthM: -5 } : ctx);
    expect(p(marineShell)).toBeGreaterThan(5 * p(marineChitin));
    expect(p(marineChitin)).toBeGreaterThan(20 * p(marineSoft));
    expect(p(marineShell)).toBeGreaterThan(10 * p(landBone, base, true));
    expect(p(landBone, base, true)).toBeGreaterThan(p(landSoft, base, true));
    expect(p(marineBone)).toBeGreaterThan(p(marineChitin));
  });

  it('rank correlation with the a-priori ordering of preservability is ≥ 0.9', () => {
    const cases: [number, EnvContext][] = [
      [marineShell, { ...base, sedRateMPerMyr: 800 }], // 1
      [marineShell, base], //                              2
      [marineBone, base], //                               3
      [marineChitin, base], //                             4
      [landBone, { ...base, facies: F.terrestrial, waterDepthM: -5 }], // 5
      [marineSoft, base], //                               6
      [landSoft, { ...base, facies: F.terrestrial, waterDepthM: -5 }], // 7
    ];
    const probs = cases.map(([i, c]) => preservation(bio, i, c));
    const rank = (a: number[]) => a.map((v) => a.filter((w) => w > v).length + 1);
    const rp = rank(probs), ra = [1, 2, 3, 4, 5, 6, 7];
    const n = ra.length;
    const d2 = rp.reduce((s, r, k) => s + (r - ra[k]) ** 2, 0);
    const spearman = 1 - (6 * d2) / (n * (n * n - 1));
    expect(spearman).toBeGreaterThanOrEqual(0.9);
  });

  it('fast burial helps; aragonite dissolves with burial depth and age', () => {
    // (a world may by chance have lost its aragonitic clades, so make one of the calcite shell-builders aragonitic for this test)
    const arag = find((i) => i !== marineShell && sp.hard[i] === HARD.carbonate && sp.realm[i] === REALM.marine);
    const was = sp.mineral[arag];
    sp.mineral[arag] = MINERAL.aragonite;
    expect(preservation(bio, marineShell, { ...base, sedRateMPerMyr: 1000 })).toBeGreaterThan(2 * preservation(bio, marineShell, { ...base, sedRateMPerMyr: 3 }));
    expect(preservation(bio, arag, { ...base, burialDepthM: 100, ageMa: 5 })).toBeGreaterThan(5 * preservation(bio, arag, { ...base, burialDepthM: 3000, ageMa: 200 }));
    sp.mineral[arag] = was;
  });

  it('Lagerstätten preserve soft-bodied animals', () => {
    expect(preservation(bio, marineSoft, { ...base, lagerstatte: true })).toBeGreaterThan(100 * preservation(bio, marineSoft, base));
  });

  it('assemblages are deterministic per key, differ across keys, and are biased toward hard parts', () => {
    const s = 30;
    const a = drawAssemblage(bio, s, s, base, 4000, 'core-1/sample-7');
    const b = drawAssemblage(bio, s, s, base, 4000, 'core-1/sample-7');
    const c = drawAssemblage(bio, s, s, base, 4000, 'core-1/sample-8');
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBeGreaterThan(5);
    // fossils are a skewed subset of the living community
    const comm = communityAt(bio, s, s, base);
    const found = new Set(a.map((x) => x.species));
    const softLiving = comm.ids.filter((i) => sp.hard[i] === HARD.soft).length;
    const softFound = [...found].filter((i) => sp.hard[i] === HARD.soft).length;
    expect(found.size).toBeLessThan(comm.ids.length);
    expect(softFound / Math.max(found.size, 1)).toBeLessThan(softLiving / comm.ids.length);
  });

  it('Signor–Lipps: a sudden extinction appears gradual, with last occurrences before the real extinction', () => {
    const { bio: b } = makeBio({ seed: 'signor', durationMyr: 100, tweak: (e) => pulse(e, 300, { lightReduction: 0.95 / e.plan.dtYr[300] * 4, ozoneLoss: 0.9 / e.plan.dtYr[300] * 60 }) });
    const { died } = victimsAt(b, 300);
    const ctx: EnvContext = { ...base, waterDepthM: 40 };
    // marine victims that are reasonably common in the sampled community
    const comm = communityAt(b, 295, 299, ctx);
    const wanted = died.filter((i) => comm.ids.includes(i));
    expect(wanted.length).toBeGreaterThan(8);
    // sample every step for 80 steps before the event, find the last step in which each victim is seen
    const lastSeen = new Map<number, number>();
    for (let s = 299; s > 219; s--) {
      const found = drawAssemblage(b, s, s, ctx, 400, `signor/${s}`);
      for (const f of found) if (wanted.includes(f.species) && !lastSeen.has(f.species)) lastSeen.set(f.species, s);
    }
    const gaps = [...lastSeen.values()].map((s) => 300 - s);
    expect(gaps.length).toBeGreaterThan(3);
    const mean = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    expect(mean).toBeGreaterThan(0.5); // last occurrences are earlier than the true extinction...
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps)); // ...with a spread, so the drop looks gradual
    // and some victims are never seen at all
    expect(lastSeen.size).toBeLessThan(wanted.length);
  });
});

describe('time lookups', () => {
  it('stepAtAge finds the containing step', () => {
    const { bio } = makeBio({ seed: 'steps', durationMyr: 30 });
    for (const s of [0, 17, 60, bio.plan.n - 1]) expect(stepAtAge(bio.plan, 0.5 * (bio.plan.ageBaseMa[s] + bio.plan.ageTopMa[s]))).toBe(s);
  });
});

describe('performance', () => {
  it('runs 250 Myr / 2500 steps in a couple of seconds', () => {
    const { bio, earth } = makeBio({ seed: 'perf', durationMyr: 250, baseDtYr: 100_000 });
    const t0 = performance.now();
    runBiosphere({ plan: bio.plan, earth, rng: new Rng('perf') });
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
