/**
 * Build the signature library: feature vectors from single-event mini worlds, per cause class (design D16).
 *   npx tsx tools/build-signatures.ts [samplesPerClass=150]
 * Writes src/observation/solvability/signatures.json. Re-run whenever the physics of events, strata or the biosphere changes
 * (tests/solvability checks that the file's modelVersion matches MODEL_VERSION).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_VERSION } from '../src/shared/config';
import { FEATURES, extractFeatures } from '../src/observation/solvability/features';
import { CLASSES, makeMini } from '../src/observation/solvability/miniworld';
import { Library } from '../src/observation/solvability/library';

const n = Number(process.argv[2] ?? 150);
const t0 = performance.now();
const samples = {} as Library['samples'];
for (const c of CLASSES) {
  samples[c] = [];
  for (let k = 0; k < n; k++) {
    const m = makeMini(c, `lib${k}`);
    const f = extractFeatures(m.world, m.t0, m.t1);
    samples[c].push(FEATURES.map((x) => (Number.isNaN(f[x]) ? null : +f[x].toFixed(4))));
  }
  process.stderr.write(`${c}: ${n} samples (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
}
const lib: Library = { modelVersion: MODEL_VERSION, features: FEATURES, samples };
const out = path.resolve(process.cwd(), 'src/observation/solvability/signatures.json');
fs.writeFileSync(out, JSON.stringify(lib));
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
