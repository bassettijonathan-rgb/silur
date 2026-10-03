/** Nearby supernova: ⁶⁰Fe fallout (half-life 2.6 Myr — only young events keep a signal) and a few kyr of ozone loss. */
import { Rng } from '../../shared/rng';
import { Forcing, zeroForcing } from '../../shared/forcing';
import { TimeWindow } from '../../shared/timeplan';
import { SupernovaEvent, avgOverStep } from './types';

export const FE60_HALF_LIFE_MYR = 2.6;

export function makeSupernova(ageMa: number, r: Rng): SupernovaEvent {
  return { kind: 'supernova', ageMa, ozoneLoss: r.range(0.2, 0.5), durationKyr: r.range(1, 5), fe60: r.logUniform(5e9, 5e10) };
}

export function supernovaWindows(e: SupernovaEvent): TimeWindow[] {
  const d = e.durationKyr / 1000;
  return [
    { ageStartMa: e.ageMa, ageEndMa: e.ageMa - d, dtYr: 500, tag: 41 },
    { ageStartMa: e.ageMa - d, ageEndMa: e.ageMa - d - 0.05, dtYr: 5_000, tag: 42 },
  ];
}

export function supernovaForcing(e: SupernovaEvent, a0: number, a1: number): Forcing {
  const f = zeroForcing();
  f.ozoneLoss = avgOverStep(e.ozoneLoss, e.ageMa, e.durationKyr * 1000, a0, a1);
  return f;
}
