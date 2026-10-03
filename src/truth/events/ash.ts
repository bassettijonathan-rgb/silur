/**
 * Explosive eruptions from arc volcanoes outside the map. Each lays an ash bed whose thickness falls with distance
 * from the vent and with angle from the wind direction. Zircons in the ash carry the eruption's exact age (the
 * `ashAge` tracer), which is what radiometric dating will measure (M6).
 */
import { Rng } from '../../shared/rng';
import { TimeWindow } from '../../shared/timeplan';
import { AshEvent } from './types';

export function makeAsh(ageMa: number, r: Rng, mapHalfKm: number): AshEvent {
  const dist = mapHalfKm + r.logUniform(40, 700);
  const bearing = r.range(0, 2 * Math.PI);
  return {
    kind: 'ash', ageMa,
    volumeKm3: r.logUniform(5, 3000),
    xKm: dist * Math.cos(bearing), yKm: dist * Math.sin(bearing),
    windDeg: r.range(0, 360),
  };
}

/** Bed thickness (m of solid ash) at distance r km in direction `bearingDeg` from the vent. */
export function ashThickness(e: AshEvent, rKm: number, bearingDeg: number): number {
  const t100 = 0.2 * (e.volumeKm3 / 100) ** 0.6;
  let dTheta = Math.abs(((bearingDeg - e.windDeg + 540) % 360) - 180);
  dTheta = Math.min(dTheta, 180);
  const wind = 0.25 + 0.75 * Math.exp(-((dTheta / 45) ** 2));
  return t100 * (100 / Math.max(rKm, 30)) ** 2 * wind;
}

/** Big eruptions get a short refined window so their beds stay distinct instead of dissolving into 100 kyr of mud. */
export function ashWindows(e: AshEvent): TimeWindow[] {
  if (e.volumeKm3 < 100) return [];
  return [{ ageStartMa: e.ageMa, ageEndMa: e.ageMa - 0.001, dtYr: 500, tag: 51 }];
}
