/** Build a quick library from mini worlds and measure civilization-vs-mimic separability. npx tsx tools/probe-auc.ts [nLib] [nTest] */
import { CLASSES, Cls, MIMIC_CLASSES, makeMini } from '../src/observation/solvability/miniworld';
import { FEATURES, Features, extractFeatures } from '../src/observation/solvability/features';
import { Library, auc, fitModel, posterior } from '../src/observation/solvability/library';

const nLib = Number(process.argv[2] ?? 60), nTest = Number(process.argv[3] ?? 40);
const t0 = performance.now();
const samples = {} as Library['samples'];
for (const c of CLASSES) {
  samples[c] = [];
  for (let k = 0; k < nLib; k++) { const m = makeMini(c, `lib${k}`); const f = extractFeatures(m.world, m.t0, m.t1); samples[c].push(FEATURES.map((x) => (Number.isNaN(f[x]) ? null : f[x]))); }
}
const model = fitModel({ modelVersion: 'x', features: FEATURES, samples });
const pos: Features[] = [], neg: Features[] = [];
for (let k = 0; k < nTest; k++) {
  const c = makeMini('civilization', `test${k}`, { mimicsOnly: true });
  pos.push(extractFeatures(c.world, c.t0, c.t1));
  const cls = MIMIC_CLASSES[k % MIMIC_CLASSES.length] as Cls;
  const m = makeMini(cls, `test${k}`, { mimicsOnly: true });
  neg.push(extractFeatures(m.world, m.t0, m.t1));
}
const score = (f: Features) => { const p = posterior(model, f).post.civilization; return Math.log(p / (1 - p + 1e-12) + 1e-12); };
console.log(`built in ${((performance.now() - t0) / 1000).toFixed(0)} s;  joint AUC civ vs mimic = ${auc(pos.map(score), neg.map(score)).toFixed(3)}`);
for (const name of FEATURES) {
  const a = pos.map((f) => f[name]).filter((x) => !Number.isNaN(x)), b = neg.map((f) => f[name]).filter((x) => !Number.isNaN(x));
  if (a.length < 5 || b.length < 5) { console.log(name.padEnd(8), 'n/a', a.length, b.length); continue; }
  const u = auc(a, b);
  console.log(name.padEnd(8), `AUC ${u.toFixed(2)} (|·-0.5|*2+0.5 = ${(0.5 + Math.abs(u - 0.5)).toFixed(2)})  n=${a.length}/${b.length}`);
}
// per-class confusion
for (const c of MIMIC_CLASSES) {
  const idx = neg.map((_, k) => k).filter((k) => MIMIC_CLASSES[k % MIMIC_CLASSES.length] === c);
  const sc = idx.map((k) => score(neg[k]));
  console.log(c.padEnd(15), 'mean log-odds(civ)', (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(2), ' AUC vs civ', auc(pos.map(score), sc).toFixed(2));
}
