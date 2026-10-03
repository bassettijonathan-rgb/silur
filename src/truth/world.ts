/**
 * The whole hidden history of one world. `generateWorld` runs every Layer-1 stage in order:
 *   planet → event schedule → time plan → Earth system (with event forcing) → biosphere → strata (with event
 *   deposits, burrowing activity) → segmenter / truth catalog.
 * Everything is reproducible from `config` (seed, size, difficulty).
 */
import { WorldConfig } from '../shared/config';
import type { Stage } from '../shared/protocol';
import { Rng, hash32 } from '../shared/rng';
import { TimePlan, buildTimePlan } from '../shared/timeplan';
import { runBiosphere, BioWorld } from './bio/diversify';
import { generateSlowDrivers } from './earth/drivers';
import { PlanetParams, samplePlanet } from './earth/planet';
import { EarthHistory, runEarthSystem } from './earth/run';
import { buildCatalog } from './events/catalog';
import { eventForcing } from './events/forcing';
import { Schedule, scheduleEvents } from './events/schedule';
import { EventSource } from './events/source';
import { AshEvent, ForcedEvent, TruthEvent } from './events/types';
import { StratWorld, simulateStrata } from './strat/simulate';
import type { TemplateName } from './geo/tectonics';

export interface World {
  config: WorldConfig;
  planet: PlanetParams;
  plan: TimePlan;
  earth: EarthHistory;
  bio: BioWorld;
  strat: StratWorld;
  forced: ForcedEvent[];
  ashes: AshEvent[];
  catalog: TruthEvent[];
}

export type Progress = (stage: Stage, frac: number) => void;

export interface GenerateOptions {
  /** Use these events instead of drawing them (scenario worlds, tests). */
  schedule?: Schedule;
  /** Fix the tectonic template / exhumation phase / palaeolatitude (scenario worlds, tests). */
  template?: TemplateName;
  exhumeMyr?: number;
  latitudeDeg?: number;
}

export function generateWorld(config: WorldConfig, onProgress: Progress = () => undefined, options: GenerateOptions = {}): World {
  const rng = new Rng(config.seed);
  const mapHalfKm = (Math.max(config.grid.nx, config.grid.ny) * config.grid.cellKm) / 2;

  onProgress('planet', 0);
  const planet = samplePlanet(rng);
  const drawn = scheduleEvents(rng, config.durationMyr, config.difficulty.eventDensity, mapHalfKm);
  const schedule = options.schedule ?? drawn;
  const plan = buildTimePlan({ durationMyr: config.durationMyr, baseDtYr: config.baseDtYr, windows: schedule.windows, maxSteps: config.maxSteps });
  const drivers = generateSlowDrivers(plan, planet, rng);

  onProgress('earth', 0);
  const earth = runEarthSystem({ planet, plan, drivers, forcing: eventForcing(schedule.forced) });

  onProgress('biosphere', 0);
  const bio = runBiosphere({ plan, earth, rng });

  onProgress('strata', 0);
  const strat = simulateStrata({
    config, plan, earth, rng,
    template: options.template, exhumeMyr: options.exhumeMyr,
    latitude: options.latitudeDeg === undefined ? undefined : new Float64Array(plan.n).fill(options.latitudeDeg),
    sources: [new EventSource(schedule.forced, schedule.ashes, plan)],
    bioturbationIndex: bio.burrowIndex,
    onProgress: (f) => onProgress('strata', f),
  });

  onProgress('catalog', 0);
  const catalog = buildCatalog(plan, earth, bio, schedule.forced);
  onProgress('catalog', 1);
  return { config, planet, plan, earth, bio, strat, forced: schedule.forced, ashes: schedule.ashes, catalog };
}

/** A fingerprint of a world for determinism tests and save/load version checks. */
export function worldHash(w: World): number {
  let h = hash32(w.plan.n, w.bio.species.n, w.catalog.length);
  const E = w.earth.mean;
  for (let s = 0; s < w.plan.n; s += 7) h = hash32(h, E.pCO2[s], E.d13C_carb[s], w.bio.living[s]);
  for (let i = 0; i < w.strat.columns.length; i += 11) {
    const c = w.strat.columns[i];
    h = hash32(h, c.n, c.totalSolid);
  }
  for (const e of w.catalog) h = hash32(h, e.ageMa[0], e.magnitude);
  return h;
}
