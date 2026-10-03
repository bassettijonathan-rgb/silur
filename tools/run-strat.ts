/**
 * Run Earth system + stratigraphy and print a profile.
 *   npx tsx tools/run-strat.ts [seed] [preset: dev|standard|large] [template] ['{"param":value}']
 */
import { makeConfig, PresetName } from '../src/shared/config';
import { Rng } from '../src/shared/rng';
import { buildTimePlan } from '../src/shared/timeplan';
import { generateSlowDrivers } from '../src/truth/earth/drivers';
import { samplePlanet } from '../src/truth/earth/planet';
import { runEarthSystem } from '../src/truth/earth/run';
import { memoryStats, simulateStrata, totalTracers } from '../src/truth/strat/simulate';
import { FACIES } from '../src/truth/strat/facies';
import type { TemplateName } from '../src/truth/geo/tectonics';
import { T } from '../src/truth/strat/tracers';

const seed = process.argv[2] ?? 'alpha';
const preset = (process.argv[3] ?? 'dev') as PresetName;
const template = process.argv[4] as TemplateName | undefined;
const params = process.argv[5] ? JSON.parse(process.argv[5]) : undefined;
const config = makeConfig(seed, preset);
const rng = new Rng(seed);
const planet = samplePlanet(rng);
const plan = buildTimePlan({ durationMyr: config.durationMyr, baseDtYr: config.baseDtYr, maxSteps: config.maxSteps });
const drivers = generateSlowDrivers(plan, planet, rng);

let t0 = performance.now();
const earth = runEarthSystem({ planet, plan, drivers });
const tEarth = performance.now() - t0;
t0 = performance.now();
const w = simulateStrata({ config, plan, earth, rng, template, params });
const tStrat = performance.now() - t0;
const mem = memoryStats(w);

console.log(`seed=${seed} preset=${preset} grid=${w.nx}x${w.ny} ${config.durationMyr} Myr, ${plan.n} steps, template=${w.template}`);
console.log(`earth ${tEarth.toFixed(0)} ms | strata ${(tStrat / 1000).toFixed(1)} s | layers ${mem.layers.toLocaleString()} | ≈${mem.mbytes.toFixed(0)} MB (incl. env history)`);
console.log(`erosion episodes logged: ${w.erased.n.toLocaleString()}`);

const tot = totalTracers(w);
console.log(`stack totals: clastic ${tot[T.clastic].toExponential(2)} m·cells  carbonate ${tot[T.caco3].toExponential(2)}  evap ${tot[T.evap].toExponential(2)}  orgC ${tot[T.orgC].toExponential(2)} kg`);

// thickness distribution
const th = w.columns.map((c) => c.compactedThickness()).sort((a, b) => a - b);
const q = (p: number) => th[Math.floor(p * (th.length - 1))];
console.log(`column thickness (compacted, m): min ${q(0).toFixed(0)}  q25 ${q(0.25).toFixed(0)}  median ${q(0.5).toFixed(0)}  q75 ${q(0.75).toFixed(0)}  max ${q(1).toFixed(0)}`);

// facies mix by volume
const vol = new Float64Array(FACIES.length);
for (const c of w.columns) for (let i = 0; i < c.n; i++) vol[c.facies[i]] += c.solid[i];
const vt = vol.reduce((a, b) => a + b, 0);
console.log('facies by solid volume: ' + FACIES.map((n, i) => `${n} ${(100 * vol[i] / vt).toFixed(1)}%`).join('  '));

// map of surface elevation and of the facies at the top of each column
const SL = w.seaLevelNow;
let ascii = '';
for (let y = 0; y < w.ny; y++) {
  for (let x = 0; x < w.nx; x++) {
    const d = SL - w.surface[y * w.nx + x];
    ascii += d > 2000 ? ' ' : d > 200 ? '.' : d > 0 ? '~' : d > -300 ? '-' : d > -800 ? '=' : '#';
  }
  ascii += '\n';
}
console.log('present-day surface (  deep sea  . sea  ~ shelf  - lowland  = upland  # mountain):');
console.log(ascii);
