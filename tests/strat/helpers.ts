import { makeConfig } from '../../src/shared/config';
import { Rng } from '../../src/shared/rng';
import { buildTimePlan, TimeWindow } from '../../src/shared/timeplan';
import { generateSlowDrivers } from '../../src/truth/earth/drivers';
import { EARTH_LIKE, PlanetParams, samplePlanet } from '../../src/truth/earth/planet';
import { EarthHistory, runEarthSystem } from '../../src/truth/earth/run';
import { ForcingProvider } from '../../src/shared/forcing';
import { StratSource, StratWorld, simulateStrata } from '../../src/truth/strat/simulate';
import type { TemplateName } from '../../src/truth/geo/tectonics';
import { calibrated } from '../earth/helpers';

export interface TestWorldOpts {
  seed?: string;
  nx?: number;
  durationMyr?: number;
  baseDtYr?: number;
  template?: TemplateName;
  windows?: TimeWindow[];
  planet?: PlanetParams;
  forcing?: ForcingProvider;
  /** Edit the Earth history before the strata see it (e.g. impose a sea-level curve). */
  tweakEarth?: (e: EarthHistory) => void;
  latitude?: (nSteps: number) => Float64Array;
  sources?: StratSource[];
  preservation?: number;
  /** Final uplift phase, Myr (tests default to none so the record survives to be inspected). */
  exhumeMyr?: number;
  bioturbationIndex?: (nSteps: number) => Float64Array;
  params?: Parameters<typeof simulateStrata>[0]['params'];
}

export function makeWorld(o: TestWorldOpts = {}): { world: StratWorld; earth: EarthHistory } {
  const seed = o.seed ?? 'test';
  const nx = o.nx ?? 14;
  const durationMyr = o.durationMyr ?? 40;
  const rng = new Rng(seed);
  const planet = o.planet ?? samplePlanet(rng);
  const plan = buildTimePlan({ durationMyr, baseDtYr: o.baseDtYr ?? 250_000, windows: o.windows });
  const drivers = generateSlowDrivers(plan, planet, rng);
  const earth = runEarthSystem({ planet, plan, drivers, forcing: o.forcing, calibrated: calibrated(planet) });
  o.tweakEarth?.(earth);
  const config = makeConfig(seed, 'dev', { preservation: o.preservation ?? 0.6 });
  config.grid = { nx, ny: nx, cellKm: 8 };
  config.durationMyr = durationMyr;
  const world = simulateStrata({
    config, plan, earth, rng, template: o.template ?? 'passive-margin', exhumeMyr: o.exhumeMyr ?? 0,
    latitude: o.latitude?.(plan.n), sources: o.sources, params: o.params, bioturbationIndex: o.bioturbationIndex?.(plan.n),
  });
  return { world, earth };
}

export { EARTH_LIKE };
