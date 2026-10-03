/**
 * Generate a whole world and print its truth catalog and timings.
 *   npx tsx tools/run-world.ts [seed] [preset: dev|standard|large]
 */
import { PresetName, makeConfig } from '../src/shared/config';
import { generateWorld, worldHash } from '../src/truth/world';

const seed = process.argv[2] ?? 'alpha';
const preset = (process.argv[3] ?? 'dev') as PresetName;
const config = makeConfig(seed, preset);
const t0 = performance.now();
let last = '';
const world = generateWorld(config, (stage, f) => {
  if (stage !== last) { last = stage; process.stderr.write(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${stage}\n`); }
  void f;
});
const secs = (performance.now() - t0) / 1000;
let layers = 0;
for (const c of world.strat.columns) layers += c.n;
console.log(`seed=${seed} ${preset}: ${world.plan.n} steps, ${secs.toFixed(1)} s, ${layers.toLocaleString()} layers, ${world.bio.species.n.toLocaleString()} species, template ${world.strat.template}, hash ${worldHash(world)}`);
console.log(`forced events: ${world.forced.length}  ash eruptions: ${world.ashes.length}  catalog entries: ${world.catalog.length}`);
for (const e of world.catalog) {
  const p = e.parents.length ? ` ← ${e.parents.map((i) => `#${i}`).join(',')}` : '';
  console.log(`  #${String(e.id).padEnd(2)} ${e.type.padEnd(12)} ${e.ageMa[0].toFixed(2).padStart(7)} → ${e.ageMa[1].toFixed(2).padStart(7)} Ma  mag ${e.magnitude.toPrecision(3).padStart(8)}  cause ${e.cause}${p}`);
}
