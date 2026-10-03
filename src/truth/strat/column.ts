/**
 * ColumnStore — the stratigraphic column of ONE map cell, plus its bioturbated surface layer.
 *
 *   top of rock  ───────────────  newest
 *     mixed layer   (not yet rock: well-mixed by burrowers, thickness ≤ L)
 *     layer n-1
 *     ...
 *     layer 0       ───────────────  oldest, sits on basement
 *
 * Bioturbation (Berger & Heath 1968): the top L of sediment is continuously stirred. Each time new
 * sediment arrives it is mixed into that layer, and an equal thickness drops out of the bottom of it into
 * the permanent record carrying the mixed composition. A short signal therefore gets spread over roughly
 * L of rock (and weakened by the same factor) — exactly what real strata do to a brief event.
 *
 * All stored quantities are extensive (see tracers.ts), so mixing, merging, partial erosion and
 * dilution are just additions and scalings. Ages are carried as a mass-weighted mean and spread.
 */

import { N_LITH, addLithology, compactedThickness, meanLitho } from './compaction';
import { NT, solidOf } from './tracers';

/** Bit flags attached to layers. */
export const FLAG = {
  HIATUS: 1, //       a break in deposition (non-deposition or erosion) lies directly BELOW this layer
  FINE: 2, //         formed during a refined (event) time step
  DROWN: 4, //        facies jump too large for the time step: condensed / drowning surface below
  EVENT: 8, //        contains a distinct event deposit (impact ejecta, tsunami, ...)
  ASH: 16,
  LAGERSTATTE: 32, // exceptional preservation conditions
  ANOXIC: 64,
  TSUNAMI: 128,
  EJECTA: 256,
  KEEP: 512, //       never merge (beds in and just after refined event windows)
} as const;

export const ENV_FIELDS = 4; // [waterDepthCode, bottomO2Code, sedRateCode, paleolatCode]

export interface DepositInput {
  /** Extensive tracers deposited this step (length NT). */
  tr: Float64Array;
  facies: number;
  flags: number;
  env: Uint8Array;
  /** Mixing-layer thickness in solid-rock metres (0 = no bioturbation, laminated). */
  lmix: number;
  ageMa: number;
}

export interface ErodeInfo {
  removedSolid: number;
  /** Oldest / youngest mean age among the removed material, Ma (NaN if nothing removed). */
  ageOldMa: number;
  ageYoungMa: number;
}

export class ColumnStore {
  // ---- permanent stack (struct of arrays, capacity doubling)
  n = 0;
  private cap: number;
  formed: Uint16Array;
  ageMean: Float32Array;
  ageSigma: Float32Array;
  facies: Uint8Array;
  flags: Uint16Array;
  gap: Uint16Array; //  steps of non-deposition immediately below the layer (saturating)
  solid: Float32Array;
  env: Uint8Array; //   n × ENV_FIELDS
  tr: Float32Array; //  n × NT

  // ---- bioturbated surface layer
  mixSolid = 0;
  readonly mixTr = new Float64Array(NT);
  private mixA1 = 0; // Σ w·age
  private mixA2 = 0; // Σ w·age²
  private mixFacies = 0;
  private mixFlags = 0;
  private mixGap = 0;
  private readonly mixEnv = new Uint8Array(ENV_FIELDS);

  // ---- bookkeeping
  /** Running solid thickness by lithology (stack + mixed), for compaction and surface elevation. */
  readonly litho = new Float64Array(N_LITH);
  lastDepositStep = -1;
  private flushPending = false;
  private pendingHiatus = false;
  /** Merge adjacent same-facies background layers while the combined bed stays thinner than this (m). */
  mergeBedM = 2;

  constructor(initialCap = 8) {
    this.cap = initialCap;
    this.formed = new Uint16Array(initialCap);
    this.ageMean = new Float32Array(initialCap);
    this.ageSigma = new Float32Array(initialCap);
    this.facies = new Uint8Array(initialCap);
    this.flags = new Uint16Array(initialCap);
    this.gap = new Uint16Array(initialCap);
    this.solid = new Float32Array(initialCap);
    this.env = new Uint8Array(initialCap * ENV_FIELDS);
    this.tr = new Float32Array(initialCap * NT);
  }

  private grow(): void {
    const c = this.cap * 2;
    const g = <A extends Float32Array | Uint8Array | Uint16Array>(a: A, k: number): A => {
      const b = new (a.constructor as new (n: number) => A)(c * k);
      b.set(a);
      return b;
    };
    this.formed = g(this.formed, 1);
    this.ageMean = g(this.ageMean, 1);
    this.ageSigma = g(this.ageSigma, 1);
    this.facies = g(this.facies, 1);
    this.flags = g(this.flags, 1);
    this.gap = g(this.gap, 1);
    this.solid = g(this.solid, 1);
    this.env = g(this.env, ENV_FIELDS);
    this.tr = g(this.tr, NT);
    this.cap = c;
  }

  /** Total solid thickness of the column, stack + mixed layer, m. */
  get totalSolid(): number {
    return this.litho[0] + this.litho[1] + this.litho[2] + this.litho[3] + this.litho[4];
  }

  /** Present-day compacted thickness of the whole column, m. */
  compactedThickness(): number {
    const m = { phi0: 0, lambda: 0, s: 0 };
    meanLitho(this.litho, m);
    return compactedThickness(m.s, m.phi0, m.lambda);
  }

  /** Mean (φ0, λ) of the column for external use. */
  meanLitho(out: { phi0: number; lambda: number; s: number }): void {
    meanLitho(this.litho, out);
  }

  // ------------------------------------------------------------------------------------------
  // Deposition
  // ------------------------------------------------------------------------------------------

  deposit(step: number, d: DepositInput): void {
    const h = solidOf(d.tr);
    if (h <= 0) return;

    // A break since the last deposit (skipped steps or erosion): the exposed surface lithifies, so the
    // old mixed layer is frozen into the record and a fresh one starts.
    const skipped = this.lastDepositStep < 0 ? 0 : step - this.lastDepositStep - 1;
    if (this.mixSolid > 0 && (skipped > 0 || this.flushPending)) this.flushMixed();
    if (this.lastDepositStep >= 0 && (skipped > 0 || this.flushPending)) {
      this.mixGap = Math.min(65535, skipped);
      this.pendingHiatus = true;
    }
    this.flushPending = false;

    // mix the new sediment in
    for (let k = 0; k < NT; k++) this.mixTr[k] += d.tr[k];
    this.mixSolid += h;
    this.mixA1 += h * d.ageMa;
    this.mixA2 += h * d.ageMa * d.ageMa;
    this.mixFacies = d.facies;
    this.mixFlags |= d.flags;
    this.mixEnv.set(d.env);
    addLithology(this.litho, d.tr, 0, 1);
    this.lastDepositStep = step;

    // let the excess fall out of the bottom of the mixed layer
    const total = this.mixSolid;
    const keep = Math.min(d.lmix, total);
    const expel = total - keep;
    if (expel > 1e-12) this.expel(step, expel / total);
  }

  /** Move `frac` of the mixed layer into the permanent stack. */
  private expel(step: number, frac: number): void {
    const w = this.mixSolid * frac;
    const mean = this.mixA1 / this.mixSolid;
    const varr = Math.max(this.mixA2 / this.mixSolid - mean * mean, 0);
    const sigma = Math.sqrt(varr);
    let flags = this.mixFlags;
    if (this.pendingHiatus) flags |= FLAG.HIATUS;
    this.pushLayer(step, w, mean, sigma, this.mixFacies, flags, this.mixGap, this.mixEnv, this.mixTr, frac);
    // what is left stays in the mixed layer with the same composition
    const rest = 1 - frac;
    for (let k = 0; k < NT; k++) this.mixTr[k] *= rest;
    this.mixSolid *= rest;
    this.mixA1 *= rest;
    this.mixA2 *= rest;
    this.pendingHiatus = false;
    this.mixGap = 0;
    this.mixFlags = 0; // flags describe what was deposited; the next deposit brings its own
    if (this.mixSolid < 1e-12) this.clearMixed();
  }

  private clearMixed(): void {
    this.mixTr.fill(0);
    this.mixSolid = 0;
    this.mixA1 = 0;
    this.mixA2 = 0;
    this.mixFlags = 0;
  }

  /** Freeze the whole mixed layer into the record (surface exposed, or end of simulation). */
  flushMixed(): void {
    if (this.mixSolid > 1e-12) this.expel(Math.max(this.lastDepositStep, 0), 1);
    else this.clearMixed();
  }

  private pushLayer(
    step: number, solid: number, mean: number, sigma: number, facies: number, flags: number, gap: number,
    env: Uint8Array, src: Float64Array, frac: number,
  ): void {
    // try to merge into the layer below: same facies, ordinary background beds, combined bed still thin
    const top = this.n - 1;
    const mergeable =
      top >= 0 &&
      this.facies[top] === facies &&
      ((flags | this.flags[top]) & (FLAG.HIATUS | FLAG.DROWN | FLAG.EVENT | FLAG.FINE | FLAG.KEEP | FLAG.ASH | FLAG.TSUNAMI | FLAG.EJECTA)) === 0 &&
      this.solid[top] + solid <= this.mergeBedM;
    if (mergeable) {
      const s0 = this.solid[top];
      const w = s0 + solid;
      const m0 = this.ageMean[top], sg0 = this.ageSigma[top];
      const mean2 = (s0 * m0 + solid * mean) / w;
      const second = (s0 * (sg0 * sg0 + m0 * m0) + solid * (sigma * sigma + mean * mean)) / w;
      this.ageMean[top] = mean2;
      this.ageSigma[top] = Math.sqrt(Math.max(second - mean2 * mean2, 0));
      this.solid[top] = w;
      this.formed[top] = step;
      this.flags[top] |= flags;
      this.env.set(env, top * ENV_FIELDS);
      const o = top * NT;
      for (let k = 0; k < NT; k++) this.tr[o + k] += src[k] * frac;
      return;
    }
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.formed[i] = step;
    this.ageMean[i] = mean;
    this.ageSigma[i] = sigma;
    this.facies[i] = facies;
    this.flags[i] = flags;
    this.gap[i] = gap;
    this.solid[i] = solid;
    this.env.set(env, i * ENV_FIELDS);
    const o = i * NT;
    for (let k = 0; k < NT; k++) this.tr[o + k] = src[k] * frac;
  }

  // ------------------------------------------------------------------------------------------
  // Erosion
  // ------------------------------------------------------------------------------------------

  private readonly delta = new Float64Array(NT);

  /**
   * Remove up to `amount` metres of solid rock from the top (mixed layer first). The removed tracers are
   * ADDED to `removed` (length NT) so callers can route them; `info` reports how much came off and how old it was.
   */
  erode(amount: number, removed: Float64Array, info: ErodeInfo): void {
    const delta = this.delta;
    delta.fill(0);
    let remaining = amount;
    let old = -Infinity;
    let young = Infinity;

    if (this.mixSolid > 0 && remaining > 0) {
      const take = Math.min(remaining, this.mixSolid);
      const f = take / this.mixSolid;
      const mean = this.mixA1 / this.mixSolid;
      old = Math.max(old, mean);
      young = Math.min(young, mean);
      for (let k = 0; k < NT; k++) {
        const v = this.mixTr[k] * f;
        delta[k] += v;
        this.mixTr[k] -= v;
      }
      this.mixSolid -= take;
      this.mixA1 *= 1 - f;
      this.mixA2 *= 1 - f;
      remaining -= take;
      if (this.mixSolid < 1e-12) this.clearMixed();
    }

    while (remaining > 1e-12 && this.n > 0) {
      const top = this.n - 1;
      const s = this.solid[top];
      const o = top * NT;
      const mean = this.ageMean[top];
      old = Math.max(old, mean);
      young = Math.min(young, mean);
      if (s <= remaining) {
        for (let k = 0; k < NT; k++) delta[k] += this.tr[o + k];
        remaining -= s;
        this.n--;
      } else {
        const f = remaining / s;
        for (let k = 0; k < NT; k++) {
          const v = this.tr[o + k] * f;
          delta[k] += v;
          this.tr[o + k] -= v;
        }
        this.solid[top] = s - remaining;
        remaining = 0;
      }
    }

    for (let k = 0; k < NT; k++) removed[k] += delta[k];
    addLithology(this.litho, delta, 0, -1);
    for (let i = 0; i < N_LITH; i++) if (this.litho[i] < 0) this.litho[i] = 0; // float dust
    info.removedSolid = amount - remaining;
    info.ageOldMa = old === -Infinity ? NaN : old;
    info.ageYoungMa = young === Infinity ? NaN : young;
    if (info.removedSolid > 0) this.flushPending = true;
  }

  // ------------------------------------------------------------------------------------------
  // Finishing / inspection
  // ------------------------------------------------------------------------------------------

  /** End of the simulation: freeze the mixed layer into the record. */
  finalize(): void {
    this.flushMixed();
    this.trim();
  }

  /** Release spare capacity (the finished record is read-only). */
  trim(): void {
    const n = Math.max(this.n, 1);
    if (this.cap <= n) return;
    const t = <A extends Float32Array | Uint8Array | Uint16Array>(a: A, k: number): A => a.slice(0, n * k) as A;
    this.formed = t(this.formed, 1);
    this.ageMean = t(this.ageMean, 1);
    this.ageSigma = t(this.ageSigma, 1);
    this.facies = t(this.facies, 1);
    this.flags = t(this.flags, 1);
    this.gap = t(this.gap, 1);
    this.solid = t(this.solid, 1);
    this.env = t(this.env, ENV_FIELDS);
    this.tr = t(this.tr, NT);
    this.cap = n;
  }

  /** Σ of every tracer over stack + mixed layer (for mass-balance checks). */
  sumTracers(out: Float64Array): void {
    for (let i = 0; i < this.n; i++) {
      const o = i * NT;
      for (let k = 0; k < NT; k++) out[k] += this.tr[o + k];
    }
    for (let k = 0; k < NT; k++) out[k] += this.mixTr[k];
  }

  /** Tracer value of layer i. */
  tracer(i: number, k: number): number {
    return this.tr[i * NT + k];
  }

  /** Does this column have any record at all? */
  get isEmpty(): boolean {
    return this.n === 0 && this.mixSolid <= 0;
  }

  /** Approximate memory in bytes. */
  get bytes(): number {
    return this.cap * (2 + 4 + 4 + 1 + 2 + 2 + 4 + ENV_FIELDS + NT * 4);
  }
}
