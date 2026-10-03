/**
 * Large igneous province: 0.5–2 Myr of pulsed flood volcanism releasing CO₂ (δ13C from mantle −5 ‰ down to −30 ‰
 * when sills cook coal and organic-rich sediment), SO₂ (aerosol cooling, acid), and mercury.
 */
import { Rng } from '../../shared/rng';
import { Forcing, zeroForcing } from '../../shared/forcing';
import { TimeWindow } from '../../shared/timeplan';
import { LipEvent } from './types';

export function makeLip(ageMa: number, r: Rng): LipEvent {
  const nP = 3 + r.int(4);
  const pulses: number[] = [];
  for (let i = 0; i < nP; i++) pulses.push(r.range(0.05, 0.95)); // positions within the window
  return {
    kind: 'lip', ageMa,
    durationMyr: r.range(0.5, 2),
    carbonPg: r.logUniform(1.5e4, 1.2e5),
    d13C: r.range(-30, -6),
    sulfurPg: r.logUniform(500, 3000),
    hgMult: r.logUniform(3, 50),
    pulses,
  };
}

/** Normalised pulse envelope (mean 1 over the window): a few Gaussian bursts on a low background. */
export function lipEnvelope(e: LipEvent, fracThrough: number): number {
  if (fracThrough < 0 || fracThrough > 1) return 0;
  let w = 0.25;
  for (const p of e.pulses) w += Math.exp(-0.5 * ((fracThrough - p) / 0.025) ** 2) * 1.6;
  const norm = 0.25 + (e.pulses.length * 1.6 * 0.025 * Math.sqrt(2 * Math.PI));
  return w / norm;
}

export function lipWindows(e: LipEvent): TimeWindow[] {
  return [
    { ageStartMa: e.ageMa, ageEndMa: e.ageMa - e.durationMyr, dtYr: 10_000, tag: 11 },
    { ageStartMa: e.ageMa - e.durationMyr, ageEndMa: e.ageMa - e.durationMyr - 0.5, dtYr: 25_000, tag: 12 },
  ];
}

export function lipForcing(e: LipEvent, a0: number, a1: number): Forcing {
  const f = zeroForcing();
  const endMa = e.ageMa - e.durationMyr;
  if (a1 >= e.ageMa || a0 <= endMa) return f;
  const mid = 0.5 * (a0 + a1);
  const env = lipEnvelope(e, (e.ageMa - mid) / e.durationMyr);
  const durYr = e.durationMyr * 1e6;
  f.carbonEmission = (e.carbonPg / durYr) * env;
  f.d13CofEmission = e.d13C;
  f.sulfurEmission = (e.sulfurPg / durYr) * env;
  f.aerosolOpticalDepth = 0.03 * env; //            decades-long aerosol veils, averaged
  f.mercuryEmission = e.hgMult * env; //            Hg flux multiple of background
  f.nutrientRunoff = 0.8 * env; //                 fresh basalt weathers fast: a phosphorus pulse that can tip the ocean into anoxia
  f.persistentOrgFlux = 1.5 * env; //               combustion of coal and organics by sills
  return f;
}
