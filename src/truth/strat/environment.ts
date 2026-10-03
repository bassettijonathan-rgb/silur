/**
 * Decide the depositional facies of a cell for one time step from its physical setting.
 * Pure function — unit-testable and easy to tweak.
 */

import { F } from './facies';

export interface EnvInput {
  /** Water depth, m (> 0 offshore, ≤ 0 on land). */
  waterDepth: number;
  /** Clastic deposition rate this step, m/yr of solid rock. */
  clasticRate: number;
  /** Fraction of the clastic deposit that is sand. */
  sandFrac: number;
  /** Solid thickness deposited this step by process (m). */
  carb: number;
  clastic: number;
  evap: number;
  /** Drainage area, km², and slope to the receiver (m/m). */
  areaKm2: number;
  /** A sink (no downhill neighbour). */
  isSink: boolean;
  /** Local humidity 0..1 and static restriction field 0..1. */
  humidity: number;
  /** Ice sheet is covering this cell. */
  glaciated: boolean;
  /** Thresholds. */
  shelfDepthMax: number;
  riverAreaKm2: number;
}

const DELTA_RATE = 3e-5; // m/yr of clastic input that makes a shallow marine cell deltaic
const DELTA_DEPTH = 40; // m

export function classifyFacies(e: EnvInput): number {
  if (e.waterDepth <= 0) {
    if (e.glaciated) return F.glacial;
    if (e.evap > e.clastic * 0.3 && e.evap > 0) return F.evaporite;
    if (e.isSink && e.humidity < 0.25) return F.evaporite; // playa
    if (e.areaKm2 >= e.riverAreaKm2 && e.sandFrac > 0.15) return F.fluvial;
    return F.terrestrial;
  }
  if (e.evap > e.clastic + e.carb) return F.evaporite;
  if (e.glaciated && e.waterDepth < 400) return F.glacial; // glaciomarine
  if (e.waterDepth < DELTA_DEPTH && e.clasticRate > DELTA_RATE && e.sandFrac > 0.15) return F.deltaic;
  if (e.waterDepth < e.shelfDepthMax) {
    return e.carb > 0.5 * (e.carb + e.clastic) ? F.shelfCarbonate : F.shelfSiliciclastic;
  }
  return F.deepMarine;
}
