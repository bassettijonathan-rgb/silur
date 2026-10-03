/**
 * Age–depth models (pure, Layer 3). Ages must increase downcore, so noisy dates are combined by weighted
 * isotonic regression (pool-adjacent-violators): neighbouring dates that disagree about the order are pooled
 * to their weighted mean. Between knots we interpolate linearly, which is the usual constant-sedimentation-rate
 * assumption — and where the fitted ages are pooled the model reports a flat segment (a hiatus or a bad date).
 */

export interface AgePoint {
  depthM: number;
  ageMa: number;
  sigmaMa: number;
  /** 'date' = measured here, 'tie' = carried over a correlation line from another core. */
  origin: 'date' | 'tie';
  /** Tie id when origin === 'tie'. */
  via?: string;
}

export interface Knot { depthM: number; ageMa: number; sigmaMa: number }

export interface AgeSegment {
  topM: number; baseM: number; topAgeMa: number; baseAgeMa: number;
  /** m per Myr; 0 when the fitted ages were pooled (no net time resolved). */
  rateMPerMyr: number;
  /** Fitted age change is zero although the depth interval is not: bad dates or a gap in the record. */
  flat: boolean;
}

export interface AgeModel {
  points: AgePoint[];
  knots: Knot[];
  segments: AgeSegment[];
  /** Points more than 3 σ from the pooled fit: candidates for inherited zircons, Pb loss or a mistaken tie. */
  suspect: AgePoint[];
  /** Age and 1σ at a depth, or null outside the dated interval (plus `extrapolateM`). */
  at(depthM: number, extrapolateM?: number): { ageMa: number; sigmaMa: number } | null;
}

const SIGMA_FLOOR = 0.005;

interface Block { w: number; mean: number; lo: number; hi: number }

export function fitAgeModel(input: AgePoint[]): AgeModel {
  const points = [...input].sort((a, b) => a.depthM - b.depthM || a.sigmaMa - b.sigmaMa);
  // Pool-adjacent-violators on age (increasing with depth).
  const blocks: Block[] = [];
  for (const p of points) {
    const w = 1 / Math.max(p.sigmaMa, SIGMA_FLOOR) ** 2;
    blocks.push({ w, mean: p.ageMa, lo: p.depthM, hi: p.depthM });
    while (blocks.length > 1 && blocks[blocks.length - 2].mean > blocks[blocks.length - 1].mean) {
      const b = blocks.pop()!, a = blocks.pop()!;
      const w2 = a.w + b.w;
      blocks.push({ w: w2, mean: (a.mean * a.w + b.mean * b.w) / w2, lo: a.lo, hi: b.hi });
    }
  }
  const knots: Knot[] = [];
  const flatRanges: [number, number][] = [];
  for (const b of blocks) {
    const sigma = 1 / Math.sqrt(b.w);
    if (b.hi > b.lo) {
      // A pooled block is a stretch of "the same age": a knot at each end keeps the step visible.
      knots.push({ depthM: b.lo, ageMa: b.mean, sigmaMa: sigma }, { depthM: b.hi, ageMa: b.mean, sigmaMa: sigma });
      flatRanges.push([b.lo, b.hi]);
    } else knots.push({ depthM: b.lo, ageMa: b.mean, sigmaMa: sigma });
  }
  // Merge knots at identical depth (several dates on one spot).
  const merged: Knot[] = [];
  for (const k of knots) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.depthM - k.depthM) < 1e-9) {
      const w1 = 1 / last.sigmaMa ** 2, w2 = 1 / k.sigmaMa ** 2;
      last.ageMa = (last.ageMa * w1 + k.ageMa * w2) / (w1 + w2);
      last.sigmaMa = 1 / Math.sqrt(w1 + w2);
    } else merged.push({ ...k });
  }

  const segments: AgeSegment[] = [];
  for (let i = 1; i < merged.length; i++) {
    const a = merged[i - 1], b = merged[i];
    const dz = b.depthM - a.depthM, dt = b.ageMa - a.ageMa;
    if (dz <= 0) continue;
    segments.push({
      topM: a.depthM, baseM: b.depthM, topAgeMa: a.ageMa, baseAgeMa: b.ageMa,
      rateMPerMyr: dt > 1e-9 ? dz / dt : 0, flat: dt <= 1e-9 && dz > 0,
    });
  }

  const model: AgeModel = {
    points, knots: merged, segments, suspect: [],
    at(depthM, extrapolateM = 0) {
      if (!merged.length) return null;
      const first = merged[0], last = merged[merged.length - 1];
      if (depthM < first.depthM - extrapolateM || depthM > last.depthM + extrapolateM) return null;
      if (merged.length === 1) return { ageMa: first.ageMa, sigmaMa: first.sigmaMa };
      let i = 1;
      while (i < merged.length - 1 && merged[i].depthM < depthM) i++;
      const a = merged[i - 1], b = merged[i];
      const f = (depthM - a.depthM) / (b.depthM - a.depthM); // may fall outside 0..1 when extrapolating
      const ageMa = a.ageMa + f * (b.ageMa - a.ageMa);
      // Uncertainty: interpolate between knots, plus a mid-interval bulge for the unknown rate history.
      const fc = Math.min(1, Math.max(0, f));
      const sBase = a.sigmaMa * (1 - fc) + b.sigmaMa * fc;
      const bulge = 0.05 * Math.abs(b.ageMa - a.ageMa) * 4 * fc * (1 - fc);
      const out = f < 0 ? -f : f > 1 ? f - 1 : 0;
      return { ageMa, sigmaMa: Math.hypot(sBase, bulge, out * Math.abs(b.ageMa - a.ageMa)) };
    },
  };
  model.suspect = points.filter((p) => {
    const m = model.at(p.depthM);
    return m !== null && Math.abs(p.ageMa - m.ageMa) > 3 * Math.max(p.sigmaMa, SIGMA_FLOOR);
  });
  return model;
}

/** Inverse lookup: depth(s) at which the model reaches an age, if it is inside the dated interval. */
export function depthAtAge(model: AgeModel, ageMa: number): number | null {
  const k = model.knots;
  for (let i = 1; i < k.length; i++) {
    if (ageMa >= k[i - 1].ageMa && ageMa <= k[i].ageMa && k[i].ageMa > k[i - 1].ageMa) {
      const f = (ageMa - k[i - 1].ageMa) / (k[i].ageMa - k[i - 1].ageMa);
      return k[i - 1].depthM + f * (k[i].depthM - k[i - 1].depthM);
    }
  }
  return null;
}
