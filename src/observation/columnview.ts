/**
 * Present-day geometry of a column, as a drill would meet it: compacted thickness of every layer and the
 * burial depth of its top, counted from the surface downwards. (Layers are stored bottom → top as decompacted
 * solid thickness; compaction depends on how deep each layer is buried — Sclater & Christie.)
 */
import { layerThickness } from '../truth/strat/compaction';
import { ColumnStore } from '../truth/strat/column';

export interface ColumnView {
  col: ColumnStore;
  /** Compacted thickness per layer, m. */
  thick: Float32Array;
  /** Depth of the top of each layer below the surface, m. */
  top: Float32Array;
  total: number;
}

export function buildColumnView(col: ColumnStore): ColumnView {
  const n = col.n;
  const thick = new Float32Array(n);
  const top = new Float32Array(n);
  const m = { phi0: 0, lambda: 0, s: 0 };
  col.meanLitho(m);
  let z = 0;
  for (let i = n - 1; i >= 0; i--) {
    top[i] = z;
    thick[i] = layerThickness(col.solid[i], z, m.phi0, m.lambda);
    z += thick[i];
  }
  return { col, thick, top, total: z };
}

/** Call `cb(layerIndex, overlapMetres)` for every layer that overlaps the depth window [z0, z1]. */
export function forEachOverlap(v: ColumnView, z0: number, z1: number, cb: (i: number, overlap: number) => void): void {
  const n = v.col.n;
  if (n === 0) return;
  // base[i] = top[i] + thick[i] decreases with i; find the topmost layer whose base lies below z0
  let lo = 0, hi = n - 1;
  if (v.top[0] + v.thick[0] <= z0) return; // window is below the bottom of the column
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (v.top[mid] + v.thick[mid] > z0) lo = mid; else hi = mid - 1;
  }
  for (let i = lo; i >= 0 && v.top[i] < z1; i--) {
    const overlap = Math.min(v.top[i] + v.thick[i], z1) - Math.max(v.top[i], z0);
    if (overlap > 0) cb(i, overlap);
  }
}
