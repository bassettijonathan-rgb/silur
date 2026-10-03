/** Smooth 2-D value noise on the map grid, values in [0, 1]. `scale` = feature size in cells. */
import { Rng } from '../../shared/rng';

export function smoothField(nx: number, ny: number, scale: number, rng: Rng): Float32Array {
  const gx = Math.ceil(nx / scale) + 2;
  const gy = Math.ceil(ny / scale) + 2;
  const g = new Float32Array(gx * gy);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const out = new Float32Array(nx * ny);
  const s = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < ny; y++) {
    const fy = y / scale, iy = Math.floor(fy), ty = s(fy - iy);
    for (let x = 0; x < nx; x++) {
      const fx = x / scale, ix = Math.floor(fx), tx = s(fx - ix);
      const a = g[iy * gx + ix], b = g[iy * gx + ix + 1], c = g[(iy + 1) * gx + ix], d = g[(iy + 1) * gx + ix + 1];
      out[y * nx + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

/** Sum of two octaves, re-normalised to [0, 1]. */
export function fractalField(nx: number, ny: number, scale: number, rng: Rng): Float32Array {
  const a = smoothField(nx, ny, scale, rng.fork('o1'));
  const b = smoothField(nx, ny, scale / 2.5, rng.fork('o2'));
  const out = new Float32Array(nx * ny);
  for (let i = 0; i < out.length; i++) out[i] = (a[i] * 0.65 + b[i] * 0.35);
  return out;
}
