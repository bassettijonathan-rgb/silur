/**
 * Aridification / uplift pulse: 20–300 kyr of faster erosion and thinner vegetation (a monsoon failure or a burst
 * of mountain uplift). It raises sediment flux and strips land cover exactly as land use does — a natural mimic of
 * the civilization's footprint on the surface — but with no carbon, no mercury and a slower tempo.
 */
import { Rng } from '../../shared/rng';
import { Forcing, zeroForcing } from '../../shared/forcing';
import { TimeWindow } from '../../shared/timeplan';
import { AridificationEvent, avgOverStep } from './types';

export function makeAridification(ageMa: number, r: Rng): AridificationEvent {
  return { kind: 'aridification', ageMa, durationKyr: r.logUniform(20, 300), sedMult: r.range(1.5, 4), coverLoss: r.range(0.15, 0.5), habitat: r.range(0.1, 0.6), predation: r.range(0.05, 0.3) };
}

export function aridificationWindows(e: AridificationEvent): TimeWindow[] {
  const d = e.durationKyr / 1000;
  return [{ ageStartMa: e.ageMa, ageEndMa: e.ageMa - d - 0.05, dtYr: 5_000, tag: 61 }];
}

export function aridificationForcing(e: AridificationEvent, a0: number, a1: number): Forcing {
  const f = zeroForcing();
  const durYr = e.durationKyr * 1000;
  f.sedimentFluxMultiplier = 1 + avgOverStep(e.sedMult - 1, e.ageMa, durYr, a0, a1);
  f.landCoverLoss = avgOverStep(e.coverLoss, e.ageMa, durYr, a0, a1);
  f.habitatConversion = avgOverStep(e.habitat, e.ageMa, durYr, a0, a1); // vegetation change squeezes land specialists too
  f.harvestPressure = avgOverStep(e.predation, e.ageMa, durYr, a0, a1); // range shifts bring new predators and competitors onto land faunas
  return f;
}
