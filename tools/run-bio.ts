/**
 * Earth system + biosphere: diversity curve, biggest extinction events and who died.
 *   npx tsx tools/run-bio.ts [seed] [preset: dev|standard|large]
 */
import { makeConfig, PresetName } from '../src/shared/config';
import { Rng } from '../src/shared/rng';
import { buildTimePlan } from '../src/shared/timeplan';
import { generateSlowDrivers } from '../src/truth/earth/drivers';
import { samplePlanet } from '../src/truth/earth/planet';
import { runEarthSystem } from '../src/truth/earth/run';
import { runBiosphere, victimsAt } from '../src/truth/bio/diversify';
import { HARD, REALM } from '../src/truth/bio/traits';

const seed = process.argv[2] ?? 'alpha';
const preset = (process.argv[3] ?? 'dev') as PresetName;
const config = makeConfig(seed, preset);
const rng = new Rng(seed);
const planet = samplePlanet(rng);
const plan = buildTimePlan({ durationMyr: config.durationMyr, baseDtYr: config.baseDtYr, maxSteps: config.maxSteps });
const earth = runEarthSystem({ planet, plan, drivers: generateSlowDrivers(plan, planet, rng) });
const t0 = performance.now();
const bio = runBiosphere({ plan, earth, rng });
const ms = performance.now() - t0;
const sp = bio.species;

const BARS = '▁▂▃▄▅▆▇█';
const spark = (a: ArrayLike<number>, w = 70) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); }
  let s = '';
  for (let k = 0; k < w; k++) { const i = Math.floor((k / w) * a.length); s += BARS[hi === lo ? 0 : Math.min(7, Math.floor(((a[i] - lo) / (hi - lo)) * 7.999))]; }
  return `${lo.toFixed(0)}..${hi.toFixed(0)} ${s}`;
};

console.log(`seed=${seed} ${config.durationMyr} Myr, ${plan.n} steps, biosphere ${ms.toFixed(0)} ms, ${sp.n.toLocaleString()} species ever, ${bio.clades.length} clades`);
console.log('living species  ', spark(bio.living));
console.log('deaths per step ', spark(bio.deaths));
console.log('burrower index  ', spark(bio.burrowIndex));

// biggest extinction pulses by fraction of living species lost in one step
const worst = Array.from({ length: plan.n }, (_, s) => ({ s, frac: bio.deaths[s] / Math.max(1, bio.living[s] + bio.deaths[s]) }))
  .sort((a, b) => b.frac - a.frac).slice(0, 5);
console.log('largest single-step losses:');
for (const w of worst) {
  const { alive, died } = victimsAt(bio, w.s);
  const rate = (f: (i: number) => boolean) => {
    const a = alive.filter(f).length;
    return a ? `${((100 * died.filter(f).length) / a).toFixed(0)}%` : '–';
  };
  console.log(
    `  ${plan.ageBaseMa[w.s].toFixed(1)} Ma  lost ${(100 * w.frac).toFixed(0)}% | marine ${rate((i) => sp.realm[i] === REALM.marine)}  land ${rate((i) => sp.realm[i] === REALM.terrestrial)}` +
      `  calcifiers ${rate((i) => sp.hard[i] === HARD.carbonate)}  big land ${rate((i) => sp.realm[i] === REALM.terrestrial && sp.logMass[i] > 4)}  burrowers ${rate((i) => sp.burrower[i] === 1)}`,
  );
}
