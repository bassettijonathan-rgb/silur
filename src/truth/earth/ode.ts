/**
 * Adaptive linearly-implicit (Rosenbrock) integrator for stiff systems.
 *
 * The Earth system has fast modes (atmosphere <-> surface ocean, ~10 yr; surface energy balance,
 * ~5 yr) next to slow ones (silicate weathering, ~10^5 yr; crustal reservoirs, ~10^8 yr). An explicit
 * method would be forced to take ~10-yr steps across 100 000-yr plan steps. A Rosenbrock method is
 * stable at any step for the fast modes while error control follows the slow ones.
 *
 * Scheme: ROS2 (Verwer, Spee, Blom & Hundsdorfer 1999), L-stable, second order, gamma = 1 + 1/sqrt(2):
 *     (I - γ h J) k1 = f(y)
 *     (I - γ h J) k2 = f(y + h k1) - 2 k1
 *     y+ = y + 3/2 h k1 + 1/2 h k2
 * The embedded first-order solution y + h k1 gives the error estimate (h/2)(k1 + k2).
 *
 * The Jacobian is formed by forward differences (n+1 evaluations of f per step); n is ~15 here so a
 * dense LU is cheap. Linear invariants of f (e.g. total carbon in a closed system) are preserved.
 */

export type Rhs = (y: Float64Array, dydt: Float64Array) => void;

export interface OdeOptions {
  rtol: number;
  /** Absolute tolerance per component (also sets the finite-difference scale). */
  atol: Float64Array;
  hInit?: number;
  hMax?: number;
  hMin?: number;
  maxSubsteps?: number;
}

export interface OdeStats {
  accepted: number;
  rejected: number;
  rhsEvals: number;
}

const GAMMA = 1 + 1 / Math.SQRT2;

export class Rosenbrock2 {
  private readonly n: number;
  private readonly f0: Float64Array;
  private readonly f1: Float64Array;
  private readonly fp: Float64Array;
  private readonly J: Float64Array;
  private readonly W: Float64Array;
  private readonly piv: Int32Array;
  private readonly k1: Float64Array;
  private readonly k2: Float64Array;
  private readonly yt: Float64Array;
  private readonly yn: Float64Array;
  private readonly rhsv: Float64Array;
  private readonly rhs: Rhs;
  /** Step size carried between calls so each plan step doesn't restart from a tiny h. */
  hCarry = 0;
  readonly stats: OdeStats = { accepted: 0, rejected: 0, rhsEvals: 0 };
  /** Debug hook: called with the index of the worst error component on every rejected step. */
  onReject?: (worst: number, errScaled: number, h: number) => void;

  constructor(n: number, rhs: Rhs) {
    this.n = n;
    this.rhs = rhs;
    this.f0 = new Float64Array(n);
    this.f1 = new Float64Array(n);
    this.fp = new Float64Array(n);
    this.J = new Float64Array(n * n);
    this.W = new Float64Array(n * n);
    this.piv = new Int32Array(n);
    this.k1 = new Float64Array(n);
    this.k2 = new Float64Array(n);
    this.yt = new Float64Array(n);
    this.yn = new Float64Array(n);
    this.rhsv = new Float64Array(n);
  }

  private eval(y: Float64Array, out: Float64Array): void {
    this.stats.rhsEvals++;
    this.rhs(y, out);
  }

  /** Forward-difference Jacobian at y given f(y) = this.f0. */
  private jacobian(y: Float64Array, atol: Float64Array): void {
    const { n, J, fp, yt } = this;
    yt.set(y);
    for (let j = 0; j < n; j++) {
      const scale = Math.max(Math.abs(y[j]), 10 * atol[j]);
      const d = 1.4901161193847656e-8 * scale; // sqrt(machine eps)
      yt[j] = y[j] + d;
      this.eval(yt, fp);
      yt[j] = y[j];
      const inv = 1 / d;
      for (let i = 0; i < n; i++) J[i * n + j] = (fp[i] - this.f0[i]) * inv;
    }
  }

  /** In-place LU with partial pivoting of W; returns false if singular. */
  private factor(): boolean {
    const { n, W, piv } = this;
    for (let k = 0; k < n; k++) {
      let p = k;
      let max = Math.abs(W[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(W[i * n + k]);
        if (v > max) { max = v; p = i; }
      }
      if (max === 0) return false;
      piv[k] = p;
      if (p !== k) {
        for (let j = 0; j < n; j++) {
          const t = W[k * n + j]; W[k * n + j] = W[p * n + j]; W[p * n + j] = t;
        }
      }
      const d = W[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const m = (W[i * n + k] /= d);
        if (m !== 0) for (let j = k + 1; j < n; j++) W[i * n + j] -= m * W[k * n + j];
      }
    }
    return true;
  }

  /** Solve W x = b in place (b overwritten with x). */
  private solve(b: Float64Array): void {
    const { n, W, piv } = this;
    // factor() swaps whole rows (LAPACK style), so apply every row swap to b first, then L, then U.
    for (let k = 0; k < n; k++) {
      const p = piv[k];
      if (p !== k) { const t = b[k]; b[k] = b[p]; b[p] = t; }
    }
    for (let k = 0; k < n; k++) {
      for (let i = k + 1; i < n; i++) b[i] -= W[i * n + k] * b[k];
    }
    for (let k = n - 1; k >= 0; k--) {
      let s = b[k];
      for (let j = k + 1; j < n; j++) s -= W[k * n + j] * b[j];
      b[k] = s / W[k * n + k];
    }
  }

  /**
   * Integrate y (modified in place) over `duration` (same time unit as the rhs). `onAccept` is called
   * after each accepted substep with the substep length and the new state.
   */
  integrate(
    y: Float64Array,
    duration: number,
    opts: OdeOptions,
    onAccept?: (h: number, y: Float64Array) => void,
  ): void {
    const { n, k1, k2, yt, yn, rhsv, f0, f1, J, W } = this;
    const atol = opts.atol;
    const rtol = opts.rtol;
    const hMax = opts.hMax ?? duration;
    const hMin = opts.hMin ?? duration * 1e-12;
    const maxSub = opts.maxSubsteps ?? 200000;

    let t = 0;
    let h = Math.min(opts.hInit ?? (this.hCarry > 0 ? this.hCarry : duration * 1e-3), hMax, duration);
    let count = 0;

    while (t < duration * (1 - 1e-13)) {
      if (++count > maxSub) throw new Error('Rosenbrock2: too many substeps');
      if (t + h > duration) h = duration - t;

      this.eval(y, f0);
      this.jacobian(y, atol);

      // W = I - γ h J
      const gh = GAMMA * h;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) W[i * n + j] = (i === j ? 1 : 0) - gh * J[i * n + j];
      }
      if (!this.factor()) { h *= 0.25; this.stats.rejected++; continue; }

      k1.set(f0);
      this.solve(k1);
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * k1[i];
      this.eval(yt, f1);
      for (let i = 0; i < n; i++) rhsv[i] = f1[i] - 2 * k1[i];
      k2.set(rhsv);
      this.solve(k2);

      let errSq = 0;
      let worst = 0;
      let worstVal = -1;
      let finite = true;
      for (let i = 0; i < n; i++) {
        const ynew = y[i] + 1.5 * h * k1[i] + 0.5 * h * k2[i];
        yn[i] = ynew;
        if (!Number.isFinite(ynew)) finite = false;
        const e = 0.5 * h * (k1[i] + k2[i]);
        const sc = atol[i] + rtol * Math.max(Math.abs(y[i]), Math.abs(ynew));
        errSq += (e / sc) * (e / sc);
        if (Math.abs(e / sc) > worstVal) { worstVal = Math.abs(e / sc); worst = i; }
      }
      const err = finite ? Math.sqrt(errSq / n) : Infinity;

      if (err <= 1 || h <= hMin) {
        if (!finite) throw new Error('Rosenbrock2: non-finite state at minimum step');
        y.set(yn);
        t += h;
        this.stats.accepted++;
        onAccept?.(h, y);
        const fac = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 / Math.sqrt(err)));
        h = Math.min(h * fac, hMax);
        this.hCarry = h;
      } else {
        this.stats.rejected++;
        this.onReject?.(worst, worstVal, h);
        h = Math.max(h * Math.min(0.9, Math.max(0.1, 0.9 / Math.sqrt(err))), hMin);
      }
    }
  }
}
