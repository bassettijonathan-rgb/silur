import { describe, expect, it } from 'vitest';
import { FLAG } from '../../src/truth/strat/column';
import { F } from '../../src/truth/strat/facies';
import { decodeO2, decodeSedRate, ENV } from '../../src/truth/strat/envcode';
import { makeWorld } from '../strat/helpers';

describe('biosphere ↔ strata hooks', () => {
  // an anoxic ocean for the middle third of the run
  const anoxic = (n: number) => (m: { anoxic: Float64Array; O2deep: Float64Array; euxinia: Float64Array }) => {
    for (let i = Math.floor(n / 3); i < Math.floor((2 * n) / 3); i++) { m.anoxic[i] = 0.95; m.O2deep[i] = 2; m.euxinia[i] = 0.8; }
  };

  it('Lagerstätten are rare, marine, anoxic and rapidly buried', () => {
    const { world } = makeWorld({ seed: 'lager', nx: 16, durationMyr: 60, template: 'passive-margin', tweakEarth: (e) => anoxic(e.plan.n)(e.mean) });
    let layers = 0, lager = 0;
    for (const c of world.columns) for (let i = 0; i < c.n; i++) {
      layers++;
      if (!(c.flags[i] & FLAG.LAGERSTATTE)) continue;
      lager++;
      expect(c.facies[i]).toBeGreaterThanOrEqual(F.deltaic);
      expect(decodeO2(c.env[i * 4 + ENV.O2])).toBeLessThan(14);
      expect(decodeSedRate(c.env[i * 4 + ENV.SEDRATE])).toBeGreaterThan(25);
    }
    expect(lager).toBeGreaterThan(0);
    expect(lager / layers).toBeLessThan(0.05);
  });

  it('no Lagerstätten in a well-oxygenated ocean', () => {
    const { world } = makeWorld({ seed: 'lager', nx: 16, durationMyr: 60, template: 'foreland', tweakEarth: (e) => { e.mean.O2deep.fill(150); e.mean.anoxic.fill(0); } });
    let lager = 0;
    for (const c of world.columns) for (let i = 0; i < c.n; i++) if (c.flags[i] & FLAG.LAGERSTATTE) lager++;
    expect(lager).toBe(0);
  });

  it('fewer burrowers ⇒ shallower bioturbation ⇒ less time-averaging in the rock', () => {
    const meanSigma = (idx: number) => {
      const { world } = makeWorld({ seed: 'burrow', nx: 12, durationMyr: 40, bioturbationIndex: (n) => new Float64Array(n).fill(idx) });
      let s = 0, w = 0;
      for (const c of world.columns) for (let i = 0; i < c.n; i++) if (c.facies[i] >= F.shelfSiliciclastic) { s += c.ageSigma[i] * c.solid[i]; w += c.solid[i]; }
      return s / w;
    };
    expect(meanSigma(1)).toBeGreaterThan(meanSigma(0) * 1.02);
  });
});
