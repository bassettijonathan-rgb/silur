import { describe, expect, it } from 'vitest';
import { DEFAULT_DIFFICULTY, MODEL_VERSION, makeConfig } from '../../src/shared/config';
import { FEATURES, Features, extractFeatures } from '../../src/observation/solvability/features';
import { assess } from '../../src/observation/solvability/ideal';
import { auc, posterior } from '../../src/observation/solvability/library';
import { CLASSES, Cls, MIMIC_CLASSES, makeMini } from '../../src/observation/solvability/miniworld';
import { generateSolvableWorld, loadLibrary, loadModel } from '../../src/observation/solvability/gate';
import { generateWorld } from '../../src/truth/world';
import { Rng } from '../../src/shared/rng';

const lib = loadLibrary();
const model = loadModel();

describe('signature library', () => {
  it('is current: built from this model version, with enough samples per cause', () => {
    expect(lib.modelVersion).toBe(MODEL_VERSION); // rebuild with `npx tsx tools/build-signatures.ts` if this fails
    expect([...lib.features]).toEqual([...FEATURES]);
    for (const c of CLASSES) expect(lib.samples[c].length).toBeGreaterThanOrEqual(100);
  });
  it('fits sensible class statistics: civilizations are short, clathrates carry the deepest excursions, impacts carry iridium', () => {
    const j = (f: string) => FEATURES.indexOf(f as never);
    expect(model.mean.civilization[j('fwhm')]).toBeLessThan(model.mean.lip[j('fwhm')] || 0);
    expect(model.mean.clathrate[j('cie')]).toBeLessThan(model.mean.bolide[j('cie')]);
    expect(model.mean.bolide[j('ir')]).toBeGreaterThan(model.mean.civilization[j('ir')]);
    expect(model.mean.lip[j('hgToc')]).toBeGreaterThan(model.mean.clathrate[j('hgToc')]);
  });
});

describe('ideal observer: civilization vs. natural mimics (design §10)', () => {
  const N = 60;
  const pos: Features[] = [], neg: Features[] = [];
  const posWorlds: ReturnType<typeof makeMini>[] = [], negWorlds: ReturnType<typeof makeMini>[] = [];
  for (let k = 0; k < N; k++) {
    const c = makeMini('civilization', `test${k}`, { mimicsOnly: true });
    pos.push(extractFeatures(c.world, c.t0, c.t1));
    if (k < 20) posWorlds.push(c);
    const cls = MIMIC_CLASSES[k % MIMIC_CLASSES.length] as Cls;
    const m = makeMini(cls, `test${k}`, { mimicsOnly: true });
    neg.push(extractFeatures(m.world, m.t0, m.t1));
    if (k < 20) negWorlds.push(m);
  }
  const score = (f: Features): number => { const p = posterior(model, f).post.civilization; return Math.log((p + 1e-12) / (1 - p + 1e-12)); };

  it(`separates them above the configured threshold (AUC ≥ ${DEFAULT_DIFFICULTY.solvabilityAUC}) but not trivially (AUC < 0.99)`, () => {
    const joint = auc(pos.map(score), neg.map(score));
    expect(joint).toBeGreaterThanOrEqual(DEFAULT_DIFFICULTY.solvabilityAUC);
    expect(joint).toBeLessThan(0.99);
  });

  it('no single proxy gives the answer away (every feature alone has AUC < 0.9)', () => {
    for (const name of FEATURES) {
      const a = pos.map((f) => f[name]).filter((x) => !Number.isNaN(x)), b = neg.map((f) => f[name]).filter((x) => !Number.isNaN(x));
      if (a.length < 8 || b.length < 8) continue;
      const u = auc(a, b);
      expect(0.5 + Math.abs(u - 0.5), name).toBeLessThan(0.9);
    }
  });

  it('every mimic class overlaps the civilization in at least one proxy (its AUC there is far from 1)', () => {
    for (const cls of MIMIC_CLASSES) {
      const group = neg.filter((_, k) => MIMIC_CLASSES[k % MIMIC_CLASSES.length] === cls);
      const overlapping = FEATURES.filter((name) => {
        const a = pos.map((f) => f[name]).filter((x) => !Number.isNaN(x)), b = group.map((f) => f[name]).filter((x) => !Number.isNaN(x));
        return a.length >= 8 && b.length >= 5 && Math.abs(auc(a, b) - 0.5) < 0.2;
      });
      expect(overlapping.length, cls).toBeGreaterThanOrEqual(3);
    }
  });

  it('whole-world verdicts: the ideal observer is more convinced of a civilization when there is one', () => {
    const p = posWorlds.map((m) => assess(m.world, model, 0.6).pCivilization);
    const q = negWorlds.map((m) => assess(m.world, model, 0.6).pCivilization);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(p)).toBeGreaterThan(mean(q) + 0.2);
  });
});

describe('solvability gate', () => {
  const cfg = (seed: string, d: Partial<typeof DEFAULT_DIFFICULTY> = {}) => {
    const c = makeConfig(seed, 'dev', { civBaseRate: 1, ...d });
    c.grid = { nx: 12, ny: 12, cellKm: 8 };
    c.durationMyr = 40;
    return c;
  };

  it('accepts a fair world immediately when the bar is zero, and records the verdict', () => {
    const { world, solvability } = generateSolvableWorld(cfg('gate1', { worldPosteriorMin: 0 }));
    expect(solvability.attempts).toBe(1);
    expect(solvability.murky).toBe(false);
    expect(solvability.assessment.solvable).toBe(true);
    expect(world.catalog.length).toBeGreaterThan(0);
  });

  it('redraws up to maxTries when the bar cannot be met, then returns the best world flagged murky', () => {
    const { solvability } = generateSolvableWorld(cfg('gate2', { worldPosteriorMin: 1.01, maxTries: 3 }));
    expect(solvability.attempts).toBe(3);
    expect(solvability.murky).toBe(true);
  });

  it('can deliberately leave worlds murky', () => {
    const { solvability } = generateSolvableWorld(cfg('gate3', { murkyFraction: 1 }));
    expect(solvability.murky).toBe(true);
    expect(solvability.attempts).toBe(1);
  });

  it('is deterministic: same seed, same accepted world', () => {
    const a = generateSolvableWorld(cfg('gate4', { worldPosteriorMin: 0.5 })), b = generateSolvableWorld(cfg('gate4', { worldPosteriorMin: 0.5 }));
    expect(a.solvability.attempts).toBe(b.solvability.attempts);
    expect(a.world.catalog.map((e) => [e.type, e.ageMa[0]])).toEqual(b.world.catalog.map((e) => [e.type, e.ageMa[0]]));
    expect(a.solvability.assessment.pCivilization).toBeCloseTo(b.solvability.assessment.pCivilization, 12);
  });

  it('worlds without a civilization really have none; with civBaseRate = 1 every world has one', () => {
    const none = generateWorld(cfg('base0', { civBaseRate: 0 })), all = generateWorld(cfg('base1', { civBaseRate: 1 }));
    expect(none.agents.length).toBe(0);
    expect(none.catalog.some((e) => e.type === 'civilization')).toBe(false);
    expect(all.agents.length).toBe(1);
    expect(all.catalog.some((e) => e.type === 'civilization')).toBe(true);
  });

  it('the base rate is respected over many seeds', () => {
    let n = 0;
    for (let k = 0; k < 400; k++) {
      // cheap check on the draw alone (same stream as generateWorld uses)
      const hasCiv = new Rng(`rate${k}`).fork('civilization').next() < 0.4;
      if (hasCiv) n++;
    }
    expect(n / 400).toBeGreaterThan(0.33); expect(n / 400).toBeLessThan(0.47);
  });
});
