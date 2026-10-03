import { Forcing, zeroForcing } from '../../src/shared/forcing';
import { Rng } from '../../src/shared/rng';
import { buildTimePlan } from '../../src/shared/timeplan';
import { generateSlowDrivers } from '../../src/truth/earth/drivers';
import { samplePlanet } from '../../src/truth/earth/planet';
import { EarthHistory, runEarthSystem } from '../../src/truth/earth/run';
import { runBiosphere, BioWorld } from '../../src/truth/bio/diversify';
import { BioParams } from '../../src/truth/bio/params';
import { calibrated } from '../earth/helpers';

export interface BioTestOpts {
  seed?: string;
  durationMyr?: number;
  baseDtYr?: number;
  /** Edit the Earth history / forcing before the biosphere sees it. */
  tweak?: (e: EarthHistory) => void;
  params?: Partial<BioParams>;
}

export function makeBio(o: BioTestOpts = {}): { bio: BioWorld; earth: EarthHistory } {
  const seed = o.seed ?? 'bio-test';
  const rng = new Rng(seed);
  const planet = samplePlanet(rng);
  const plan = buildTimePlan({ durationMyr: o.durationMyr ?? 80, baseDtYr: o.baseDtYr ?? 250_000 });
  const earth = runEarthSystem({ planet, plan, drivers: generateSlowDrivers(plan, planet, rng), calibrated: calibrated(planet) });
  o.tweak?.(earth);
  return { bio: runBiosphere({ plan, earth, rng, params: o.params }), earth };
}

/** Replace the forcing at step s with a patch (a dose: intensity × step length). */
export function pulse(e: EarthHistory, s: number, patch: Partial<Forcing>): void {
  e.forcing[s] = { ...zeroForcing(), ...patch };
}
