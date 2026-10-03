/**
 * Palaeogeography: where on the planet the map region sits, and the local climate that follows.
 *
 * The region drifts in latitude (plate motion, ~0.1–0.5° per Myr). Latitude sets the temperature offset
 * from the global mean, the humid/arid belts (Hadley-cell-like: wet at the equator and at ~55–60°, dry at
 * ~25–30° and at the poles), the carbonate belt, and whether ice sheets can reach the region.
 */

import { Rng } from '../../shared/rng';
import { TimePlan } from '../../shared/timeplan';

/** Absolute latitude in degrees (0 equator … 90 pole) at the middle of each plan step. */
export function generateLatitude(plan: TimePlan, rng: Rng): Float64Array {
  const r = rng.fork('latitude');
  const out = new Float64Array(plan.n);
  let lat = r.range(5, 55);
  let vel = r.gauss(0, 0.2); // deg / Myr
  for (let i = 0; i < plan.n; i++) {
    const dtMyr = plan.dtYr[i] / 1e6;
    // OU on velocity (correlation ~20 Myr), reflect at the equator and the pole
    const a = Math.exp(-dtMyr / 20);
    vel = vel * a + 0.2 * Math.sqrt(1 - a * a) * r.normal();
    lat += vel * dtMyr;
    if (lat < 0) { lat = -lat; vel = -vel; }
    if (lat > 85) { lat = 170 - lat; vel = -vel; }
    out[i] = lat;
  }
  return out;
}

/** Local mean-annual temperature, °C: global mean plus the equator–pole gradient (flatter in hothouses). */
export function localTemperature(tGlobalC: number, latDeg: number): number {
  const gradient = Math.min(45, Math.max(15, 52 - tGlobalC)); // K, equator minus pole
  const c = Math.cos((latDeg * Math.PI) / 180);
  return tGlobalC + gradient * (c * c - 1 / 3);
}

/** Zonal humidity 0 (desert) … 1 (rainforest), before local continentality. Slightly wetter when warm. */
export function zonalHumidity(latDeg: number, tGlobalC: number): number {
  const h = 0.5 + 0.5 * Math.cos((2 * Math.PI * latDeg) / 60);
  return Math.min(1, Math.max(0, h + 0.012 * (tGlobalC - 15)));
}
