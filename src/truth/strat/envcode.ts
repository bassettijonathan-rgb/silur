/** Compact 1-byte encodings of the environment stored with each layer (see ENV_FIELDS in column.ts). */

export const ENV = { DEPTH: 0, O2: 1, SEDRATE: 2, LAT: 3 } as const;

/** Signed square-root code for water depth (m; negative = above sea level). Range ±~8000 m. */
export function encodeDepth(d: number): number {
  const v = Math.round(Math.sign(d) * Math.sqrt(Math.abs(d)) * 1.5);
  return Math.max(0, Math.min(255, v + 128));
}
export function decodeDepth(c: number): number {
  const v = (c - 128) / 1.5;
  return Math.sign(v) * v * v;
}
/** Bottom-water O2, µmol/kg (0–510). */
export const encodeO2 = (o2: number): number => Math.max(0, Math.min(255, Math.round(o2 / 2)));
export const decodeO2 = (c: number): number => c * 2;
/** Sedimentation rate, m/Myr, log scale (0–~100 km/Myr). */
export const encodeSedRate = (mPerMyr: number): number => Math.max(0, Math.min(255, Math.round(40 * Math.log10(1 + mPerMyr))));
export const decodeSedRate = (c: number): number => 10 ** (c / 40) - 1;
/** Absolute palaeolatitude, degrees (0–90). */
export const encodeLat = (deg: number): number => Math.max(0, Math.min(255, Math.round(deg * 2.8)));
export const decodeLat = (c: number): number => c / 2.8;
