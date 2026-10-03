/**
 * Print an Earth-system run as a table with sparklines.
 *   npx tsx tools/run-earth.ts [seed] [durationMyr] [stepKyr]
 */
import { Rng } from '../src/shared/rng';
import { buildTimePlan } from '../src/shared/timeplan';
import { generateSlowDrivers } from '../src/truth/earth/drivers';
import { samplePlanet } from '../src/truth/earth/planet';
import { runEarthSystem } from '../src/truth/earth/run';
import type { DiagName } from '../src/truth/earth/model';

const seed = process.argv[2] ?? 'alpha';
const dur = Number(process.argv[3] ?? 250);
const dtKyr = Number(process.argv[4] ?? 100);

const rng = new Rng(seed);
const planet = samplePlanet(rng);
const plan = buildTimePlan({ durationMyr: dur, baseDtYr: dtKyr * 1000 });
const drivers = generateSlowDrivers(plan, planet, rng);
const t0 = performance.now();
const h = runEarthSystem({ planet, plan, drivers });
const ms = performance.now() - t0;

const BARS = '▁▂▃▄▅▆▇█';
function spark(a: Float64Array, width = 60): string {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  let s = '';
  for (let k = 0; k < width; k++) {
    const i0 = Math.floor((k / width) * a.length), i1 = Math.max(i0 + 1, Math.floor(((k + 1) / width) * a.length));
    let m = 0; for (let i = i0; i < i1; i++) m += a[i]; m /= i1 - i0;
    s += BARS[hi === lo ? 0 : Math.min(7, Math.floor(((m - lo) / (hi - lo)) * 7.999))];
  }
  return s;
}

console.log(`seed=${seed}  ${dur} Myr  ${plan.n} steps  ${ms.toFixed(0)} ms  (oldest → present)`);
console.log(`planet: pCO2ref=${planet.pCO2Ref} ppm  ECS=${planet.ecs.toFixed(2)} K  Ω0=${planet.omegaSurf0.toFixed(1)}  brightening=${(planet.brighteningPer100Myr * 100).toFixed(2)} %/100Myr`);
const rows: DiagName[] = ['pCO2', 'tempC', 'ice', 'seaLevel', 'd13C_carb', 'd18O_carb', 'ccd', 'omegaArag', 'O2deep', 'anoxic', 'O2atm', 'd15N'];
for (const r of rows) {
  const a = h.mean[r];
  console.log(`${r.padEnd(10)} ${Math.min(...a).toFixed(2).padStart(9)} ${Math.max(...a).toFixed(2).padStart(9)}  ${spark(a)}`);
}
