/** Print feature means per class from mini worlds (for tuning the mimics). npx tsx tools/probe-features.ts [n] [mimicsOnly] */
import { CLASSES, makeMini } from '../src/observation/solvability/miniworld';
import { FEATURES, extractFeatures } from '../src/observation/solvability/features';

const n = Number(process.argv[2] ?? 12);
const mimicsOnly = process.argv[3] === 'mimics';
const t0 = performance.now();
const rows: Record<string, number[][]> = {};
for (const cls of CLASSES) {
  rows[cls] = [];
  for (let k = 0; k < n; k++) {
    const m = makeMini(cls, `probe${k}`, { mimicsOnly });
    const f = extractFeatures(m.world, m.t0, m.t1);
    rows[cls].push(FEATURES.map((x) => f[x]));
  }
}
console.log(`${((performance.now() - t0) / 1000 / (n * CLASSES.length)).toFixed(2)} s per mini world`);
console.log('class'.padEnd(14) + FEATURES.map((f) => f.padStart(8)).join(''));
for (const cls of CLASSES) {
  const line = FEATURES.map((_, j) => {
    const v = rows[cls].map((r) => r[j]).filter((x) => !Number.isNaN(x));
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2).padStart(8) : '       –';
  }).join('');
  const avail = FEATURES.map((_, j) => String(rows[cls].filter((r) => !Number.isNaN(r[j])).length).padStart(8)).join('');
  console.log(cls.padEnd(14) + line);
  console.log('  (n valid)'.padEnd(14) + avail);
}
