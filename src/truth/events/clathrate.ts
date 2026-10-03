/** Methane-clathrate release: a few thousand Pg of very light carbon (δ13C ≈ −60 ‰) injected over 1–20 kyr (PETM-like). */
import { Rng } from '../../shared/rng';
import { Forcing, zeroForcing } from '../../shared/forcing';
import { TimeWindow } from '../../shared/timeplan';
import { ClathrateEvent, avgOverStep } from './types';

export function makeClathrate(ageMa: number, r: Rng): ClathrateEvent {
  return { kind: 'clathrate', ageMa, massPg: r.range(2000, 5000), onsetKyr: r.logUniform(2, 20) };
}

export function clathrateWindows(e: ClathrateEvent): TimeWindow[] {
  const on = e.onsetKyr / 1000;
  return [
    { ageStartMa: e.ageMa, ageEndMa: e.ageMa - on, dtYr: 500, tag: 21 },
    { ageStartMa: e.ageMa - on, ageEndMa: e.ageMa - on - 0.2, dtYr: 2_000, tag: 22 },
    { ageStartMa: e.ageMa - on - 0.2, ageEndMa: e.ageMa - on - 1.0, dtYr: 10_000, tag: 23 },
  ];
}

export function clathrateForcing(e: ClathrateEvent, a0: number, a1: number): Forcing {
  const f = zeroForcing();
  const durYr = e.onsetKyr * 1000;
  f.carbonEmission = avgOverStep(e.massPg / durYr, e.ageMa, durYr, a0, a1);
  f.d13CofEmission = -60;
  return f;
}
