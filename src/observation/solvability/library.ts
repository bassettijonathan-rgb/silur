/**
 * The signature library and the classifier on top of it (design D5/D16).
 *
 * The library is a set of feature vectors measured on thousands of single-event mini-worlds, per cause class.
 * The ideal observer is a Gaussian naive-Bayes model fitted to them: for a new anomaly it returns the posterior over
 * causes given whichever features could be measured. Features are strongly correlated, so the log-likelihood is
 * tempered (default 0.5) to avoid over-confident posteriors.
 */
import { CLASSES, Cls } from './miniworld';
import { FEATURES, Features } from './features';

export interface Library {
  modelVersion: string;
  features: readonly string[];
  /** samples[class] = list of feature vectors in `features` order; null = not measurable. */
  samples: Record<Cls, (number | null)[][]>;
}

export interface Model {
  mean: Record<Cls, number[]>;
  sd: Record<Cls, number[]>;
  n: Record<Cls, number[]>;
}

const MIN_N = 8; //  features with fewer valid samples in a class are ignored for that class

export function fitModel(lib: Library): Model {
  const model: Model = { mean: {} as Model['mean'], sd: {} as Model['sd'], n: {} as Model['n'] };
  const pool = FEATURES.map((_, j) => {
    const v: number[] = [];
    for (const c of CLASSES) for (const row of lib.samples[c]) if (row[j] !== null && !Number.isNaN(row[j])) v.push(row[j] as number);
    const m = v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1);
    return { sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(v.length, 1)) || 1 };
  });
  for (const c of CLASSES) {
    model.mean[c] = []; model.sd[c] = []; model.n[c] = [];
    FEATURES.forEach((_, j) => {
      const v = lib.samples[c].map((r) => r[j]).filter((x): x is number => x !== null && !Number.isNaN(x));
      const m = v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1);
      const var0 = v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(v.length, 1);
      const k = 3; // shrink toward the pooled spread
      const sd = Math.sqrt((v.length * var0 + k * pool[j].sd ** 2) / (v.length + k));
      model.mean[c].push(m); model.sd[c].push(Math.max(sd, 0.05 * pool[j].sd)); model.n[c].push(v.length);
    });
  }
  return model;
}

export type Posterior = Record<Cls, number>;
export const UNIFORM: Posterior = Object.fromEntries(CLASSES.map((c) => [c, 1 / CLASSES.length])) as Posterior;

/** Log-likelihood of the features under each class (tempered), plus how many features were usable. */
export function logLikelihoods(model: Model, f: Features, temperature = 0.5): { ll: Record<Cls, number>; used: number } {
  const ll = {} as Record<Cls, number>;
  let used = 0;
  for (const name of FEATURES) if (!Number.isNaN(f[name])) used++;
  for (const c of CLASSES) {
    let s = 0;
    FEATURES.forEach((name, j) => {
      const x = f[name];
      if (Number.isNaN(x) || model.n[c][j] < MIN_N) return;
      const z = (x - model.mean[c][j]) / model.sd[c][j];
      s += -0.5 * z * z - Math.log(model.sd[c][j]);
    });
    ll[c] = temperature * s;
  }
  return { ll, used };
}

export function posterior(model: Model, f: Features, prior: Posterior = UNIFORM, temperature = 0.5): { post: Posterior; used: number } {
  const { ll, used } = logLikelihoods(model, f, temperature);
  let mx = -Infinity;
  for (const c of CLASSES) mx = Math.max(mx, ll[c] + Math.log(prior[c]));
  let z = 0;
  const post = {} as Posterior;
  for (const c of CLASSES) { post[c] = Math.exp(ll[c] + Math.log(prior[c]) - mx); z += post[c]; }
  for (const c of CLASSES) post[c] /= z;
  return { post, used };
}

/** Rank-based AUC: probability that a random positive scores above a random negative. */
export function auc(pos: number[], neg: number[]): number {
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}
