/**
 * Seeded randomness.
 *
 * Two flavours, used for different jobs:
 *
 *  - `Rng`   : a stateful xoshiro128** stream. Used by the world generator. `fork(label)` makes an
 *              independent child stream whose seed depends only on (parent seed, label) and NOT on how
 *              many numbers the parent has already drawn. So adding a random draw to the biosphere never
 *              reshuffles the climate, and so on.
 *
 *  - `hash*` : stateless counter-based hashing. Used by the observation layer so that a measurement's
 *              noise depends only on *what* was measured (seed, kind, cell, depth...) and never on the
 *              order in which the player did things.
 */

/** cyrb128: turns a string into four well-mixed 32-bit words. */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spare: number | null = null;

  /** Identity of this stream; `fork` derives children from it. */
  readonly key: string;

  constructor(key: string) {
    this.key = key;
    const [a, b, c, d] = cyrb128(key);
    this.s0 = a; this.s1 = b; this.s2 = c; this.s3 = d;
    // xoshiro must not start in the all-zero state.
    if ((a | b | c | d) === 0) this.s0 = 1;
    for (let i = 0; i < 8; i++) this.uint32(); // warm-up
  }

  /** Independent child stream; depends only on (this.key, label). */
  fork(label: string): Rng {
    return new Rng(`${this.key}/${label}`);
  }

  /** Raw 32 random bits. */
  uint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.uint32() / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal (Box–Muller, caches the spare deviate). */
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  gauss(mean: number, sd: number): number {
    return mean + sd * this.normal();
  }

  /** Log-normal with the given median and multiplicative sigma (sigma of ln x). */
  logNormal(median: number, sigmaLn: number): number {
    return median * Math.exp(sigmaLn * this.normal());
  }

  /** Log-uniform in [a, b]. */
  logUniform(a: number, b: number): number {
    return Math.exp(this.range(Math.log(a), Math.log(b)));
  }

  /** Poisson draw (Knuth for small lambda, normal approximation for large). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

// ---------------------------------------------------------------------------------------------
// Stateless hashing (observation noise)
// ---------------------------------------------------------------------------------------------

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 32-bit hash of an ordered list of keys. Same keys -> same value, always. */
export function hash32(...keys: (number | string)[]): number {
  let h = 0x9e3779b9;
  for (const k of keys) {
    const v = typeof k === 'string' ? hashString(k) : Math.floor(k) | 0;
    // Mix in fractional part too so 1.5 and 1.25 differ.
    const frac = typeof k === 'number' ? Math.floor((k - Math.floor(k)) * 4294967296) | 0 : 0;
    h = fmix32(h ^ Math.imul(v, 0xcc9e2d51));
    h = fmix32(h ^ Math.imul(frac, 0x1b873593));
  }
  return h >>> 0;
}

/** Stateless uniform in [0, 1). */
export function hashUnit(...keys: (number | string)[]): number {
  return hash32(...keys) / 4294967296;
}

/** Stateless standard normal. */
export function hashNormal(...keys: (number | string)[]): number {
  let u = hashUnit(...keys, 'u');
  if (u === 0) u = 1e-12;
  const v = hashUnit(...keys, 'v');
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
