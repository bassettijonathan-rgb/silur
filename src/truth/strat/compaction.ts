/**
 * Compaction — Sclater & Christie (1980) porosity–depth curves, φ(z) = φ0 exp(−z/λ).
 *
 * Layers store DECOMPACTED SOLID thickness (the grains don't change when buried). The thickness a layer
 * has today depends on how deep it is buried:  H = s + φ0 λ [exp(−z_top/λ) − exp(−z_base/λ)].
 */

import { T } from './tracers';
import { KG_C_PER_M_ORGANIC } from './tracers';

export interface Litho { phi0: number; lambda: number }

export const LITHO = {
  mud: { phi0: 0.63, lambda: 1 / 0.00051 }, // shale
  sand: { phi0: 0.49, lambda: 1 / 0.00027 }, // sandstone
  carb: { phi0: 0.51, lambda: 1 / 0.00071 }, // limestone
  evap: { phi0: 0.2, lambda: 2500 },
  org: { phi0: 0.7, lambda: 1500 }, // peat / coal precursor
} as const satisfies Record<string, Litho>;

/** Per-column running totals of solid thickness by lithology, m: [mud, sand, carb, evap, organic]. */
export const N_LITH = 5;

/** Add the lithology content of a tracer vector (scaled by `k`) into `tot`. Ash counts as mud. */
export function addLithology(tot: Float64Array, tr: ArrayLike<number>, off: number, k: number): void {
  const clastic = tr[off + T.clastic];
  const sand = tr[off + T.sand];
  tot[0] += k * (clastic - sand + tr[off + T.ash]);
  tot[1] += k * sand;
  tot[2] += k * tr[off + T.caco3];
  tot[3] += k * tr[off + T.evap];
  tot[4] += k * (tr[off + T.orgC] / KG_C_PER_M_ORGANIC);
}

/** Solid-weighted mean (φ0, λ) of a lithology mix. */
export function meanLitho(tot: Float64Array, out: Litho & { s: number }): void {
  const s = tot[0] + tot[1] + tot[2] + tot[3] + tot[4];
  out.s = s;
  if (s <= 0) { out.phi0 = LITHO.mud.phi0; out.lambda = LITHO.mud.lambda; return; }
  out.phi0 = (tot[0] * LITHO.mud.phi0 + tot[1] * LITHO.sand.phi0 + tot[2] * LITHO.carb.phi0 + tot[3] * LITHO.evap.phi0 + tot[4] * LITHO.org.phi0) / s;
  out.lambda = (tot[0] * LITHO.mud.lambda + tot[1] * LITHO.sand.lambda + tot[2] * LITHO.carb.lambda + tot[3] * LITHO.evap.lambda + tot[4] * LITHO.org.lambda) / s;
}

/** Compacted thickness H of a homogeneous column of solid thickness S: solves S = H − φ0 λ (1 − e^{−H/λ}). */
export function compactedThickness(S: number, phi0: number, lambda: number): number {
  if (S <= 0) return 0;
  let H = S;
  for (let i = 0; i < 12; i++) {
    const e = Math.exp(-H / lambda);
    const f = H - phi0 * lambda * (1 - e) - S;
    const fp = 1 - phi0 * e;
    const next = H - f / fp;
    if (Math.abs(next - H) < 1e-9 * (1 + H)) { H = next; break; }
    H = next;
  }
  return H;
}

/** Present thickness of a layer of solid thickness s whose top is buried to depth zTop. */
export function layerThickness(s: number, zTop: number, phi0: number, lambda: number): number {
  if (s <= 0) return 0;
  const e0 = Math.exp(-zTop / lambda);
  // Solve s = h − φ0 λ e0 (1 − e^{−h/λ}) for h (convex, increasing: Newton from the left converges).
  let h = s;
  for (let i = 0; i < 12; i++) {
    const e = Math.exp(-h / lambda);
    const f = h - phi0 * lambda * e0 * (1 - e) - s;
    const fp = 1 - phi0 * e0 * e;
    const next = h - f / fp;
    if (Math.abs(next - h) < 1e-9 * (1 + h)) { h = next; break; }
    h = next;
  }
  return h;
}
