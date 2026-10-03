/**
 * Landscape plumbing: steepest-descent (D8) flow routing and drainage area on the map grid.
 *
 * Deliberately simple and readable: no pit filling. Internal depressions are sinks that fill with
 * sediment and then spill over time, which is what real closed basins do.
 */

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
const DIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

/**
 * Keep `order` sorted by descending z. Insertion sort: the order barely changes from step to step, so
 * this is O(N) in practice.
 */
export function resortDescending(order: Uint32Array, z: Float32Array): void {
  for (let i = 1; i < order.length; i++) {
    const v = order[i];
    const zv = z[v];
    let j = i - 1;
    while (j >= 0 && z[order[j]] < zv) { order[j + 1] = order[j]; j--; }
    order[j + 1] = v;
  }
}

/**
 * For each cell: index of the steepest strictly-lower neighbour (−1 for a sink) and the slope to it.
 * `cellM` is the cell size in metres.
 */
export function flowReceivers(
  z: Float32Array, nx: number, ny: number, cellM: number, rec: Int32Array, slope: Float32Array,
): void {
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      let best = -1;
      let bestS = 0;
      const zi = z[i];
      for (let k = 0; k < 8; k++) {
        const xx = x + DX[k], yy = y + DY[k];
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const j = yy * nx + xx;
        const s = (zi - z[j]) / (DIST[k] * cellM);
        if (s > bestS) { bestS = s; best = j; }
      }
      rec[i] = best;
      slope[i] = bestS;
    }
  }
}

/** Drainage area (m² of upstream cells incl. own) given receivers and the descending order. */
export function drainageArea(order: Uint32Array, rec: Int32Array, cellM: number, area: Float32Array): void {
  area.fill(cellM * cellM);
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const r = rec[i];
    if (r >= 0) area[r] += area[i];
  }
}

/** Standard deviation of elevation among a cell and its 8 neighbours — a local-relief measure, m. */
export function localRelief(z: Float32Array, nx: number, ny: number): Float32Array {
  const out = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let s = 0, s2 = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const v = z[yy * nx + xx];
        s += v; s2 += v * v; n++;
      }
      const m = s / n;
      out[y * nx + x] = Math.sqrt(Math.max(s2 / n - m * m, 0));
    }
  }
  return out;
}
