import { makeConfig } from '../../src/shared/config';
import { AshEvent, ForcedEvent } from '../../src/truth/events/types';
import { makeSchedule } from '../../src/truth/events/schedule';
import { generateWorld, World } from '../../src/truth/world';

/** A small world containing exactly the given events (no random ones), generous budget. */
export function scenario(
  forced: ForcedEvent[], ashes: AshEvent[] = [],
  o: { seed?: string; nx?: number; durationMyr?: number; baseDtYr?: number; budget?: number; noiseScale?: number; exhumeMyr?: number; latitudeDeg?: number; civilization?: boolean | import('../../src/truth/agents/civilization').CivilizationParams } = {},
): World {
  const config = makeConfig(o.seed ?? 'scenario', 'dev', { budget: o.budget ?? 1e6, noiseScale: o.noiseScale ?? 1 });
  const nx = o.nx ?? 16;
  config.grid = { nx, ny: nx, cellKm: 8 };
  config.durationMyr = o.durationMyr ?? 50;
  config.baseDtYr = o.baseDtYr ?? 250_000;
  return generateWorld(config, undefined, { schedule: makeSchedule(forced, ashes), civilization: o.civilization ?? false, template: 'passive-margin', exhumeMyr: o.exhumeMyr ?? 0, latitudeDeg: o.latitudeDeg ?? 12 });
}
