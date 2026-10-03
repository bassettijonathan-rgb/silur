import { describe, expect, it } from 'vitest';
import { ObservationService } from '../../src/observation/service';
import { scoreAndReveal } from '../../src/observation/reveal';
import { generateSolvableWorld } from '../../src/observation/solvability/gate';
import { makeConfig } from '../../src/shared/config';
import { Rng } from '../../src/shared/rng';
import { BOTS } from '../../tools/bots';

describe('bot score ladder', () => {
  it('random < do-nothing < informed < ideal, on a small fixed set of worlds', () => {
    const gains: Record<string, number[]> = Object.fromEntries(Object.keys(BOTS).map((k) => [k, []]));
    for (let i = 0; i < 8; i++) {
      const config = makeConfig(`ladder-${i}`, 'dev', { budget: 400, maxTries: 1 });
      config.grid = { nx: 20, ny: 20, cellKm: 8 };
      config.durationMyr = 60;
      const { world, solvability } = generateSolvableWorld(config);
      for (const [name, bot] of Object.entries(BOTS)) {
        const svc = new ObservationService(world);
        const sub = bot({ world, svc, solv: solvability, rng: new Rng(`bot|${name}|${i}`) });
        const { score } = scoreAndReveal(world, solvability, sub);
        expect(svc.budget).toBeGreaterThanOrEqual(0);
        gains[name].push(score.totals.total - score.doNothing);
      }
    }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const m = Object.fromEntries(Object.entries(gains).map(([k, v]) => [k, mean(v)]));
    expect(m.random).toBeLessThan(m['do-nothing']);
    expect(m['do-nothing']).toBeLessThan(m.informed);
    expect(m.informed).toBeLessThan(m.ideal);
    expect(m.greedy).toBeLessThan(m.ideal);
    expect(m.ideal).toBeGreaterThan(5);
  }, 120_000);
});
