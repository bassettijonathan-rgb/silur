import { EARTH_LIKE, PlanetParams } from '../../src/truth/earth/planet';
import { calibrate, Calibrated } from '../../src/truth/earth/calibrate';
import { EarthModel, N_STATE, IDX, neutralContext } from '../../src/truth/earth/model';
import { Forcing, ForcingProvider, zeroForcing } from '../../src/shared/forcing';
import { buildTimePlan, TimeWindow } from '../../src/shared/timeplan';
import { constantDrivers, SlowDrivers } from '../../src/truth/earth/drivers';
import { EarthHistory, runEarthSystem } from '../../src/truth/earth/run';

export const cal = new Map<string, Calibrated>();
/** Calibrate once per distinct parameter set (calibration costs ~60 ms). */
export function calibrated(planet: PlanetParams): Calibrated {
  const key = JSON.stringify(planet);
  let c = cal.get(key);
  if (!c) { c = calibrate(planet); cal.set(key, c); }
  return c;
}

export function modelAt(planet: PlanetParams = EARTH_LIKE) {
  const c = calibrated(planet);
  const m = new EarthModel(planet, c.base);
  m.ctx = neutralContext();
  return { m, c, y: c.y0.slice() };
}

export { EARTH_LIKE, N_STATE, IDX, zeroForcing };

/** A pulse of carbon injected at `onsetAgeMa` over `durKyr`. */
export function carbonPulse(onsetAgeMa: number, durKyr: number, massPgC: number, d13C: number): ForcingProvider {
  return (a0, a1) => {
    const mid = 0.5 * (a0 + a1);
    const f: Forcing = zeroForcing();
    if (mid <= onsetAgeMa && mid > onsetAgeMa - durKyr / 1000) {
      f.carbonEmission = massPgC / (durKyr * 1000);
      f.d13CofEmission = d13C;
    }
    return f;
  };
}

export function runConstant(opts: {
  planet?: PlanetParams;
  durationMyr: number;
  baseDtYr: number;
  windows?: TimeWindow[];
  drivers?: Partial<Parameters<typeof constantDrivers>[1]>;
  forcing?: ForcingProvider;
  driversOverride?: (d: SlowDrivers) => void;
}): EarthHistory {
  const planet = opts.planet ?? EARTH_LIKE;
  const plan = buildTimePlan({ durationMyr: opts.durationMyr, baseDtYr: opts.baseDtYr, windows: opts.windows });
  const drivers = constantDrivers(plan.n, opts.drivers ?? {});
  opts.driversOverride?.(drivers);
  return runEarthSystem({ planet, plan, drivers, forcing: opts.forcing, calibrated: calibrated(planet) });
}
