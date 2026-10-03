/**
 * Small single-event worlds: the unit of simulation for the signature library and for the solvability tests.
 * A 10×10 map, 16 Myr, one event of a chosen cause (plus ordinary background ash), generated with the real pipeline.
 */
import { makeConfig } from '../../shared/config';
import { Rng } from '../../shared/rng';
import { CivilizationParams, drawCivilization } from '../../truth/agents/civilization';
import { makeAridification } from '../../truth/events/aridification';
import { drawDiameter, makeBolide } from '../../truth/events/bolide';
import { makeClathrate } from '../../truth/events/clathrate';
import { makeLip } from '../../truth/events/lip';
import { makeLipBurst } from '../../truth/events/mimics';
import { makeSchedule, scheduleEvents } from '../../truth/events/schedule';
import { makeSupernova } from '../../truth/events/supernova';
import { ForcedEvent } from '../../truth/events/types';
import { World, generateWorld } from '../../truth/world';

export const CLASSES = ['civilization', 'clathrate', 'lip', 'bolide', 'supernova', 'aridification'] as const;
export type Cls = (typeof CLASSES)[number];

/** Natural events that imitate a civilization (the mimic classes of events/mimics.ts). */
export const MIMIC_CLASSES = ['clathrate', 'lip', 'bolide', 'aridification'] as const;

export interface Mini { world: World; cls: Cls; t0: number; t1: number }

/** Draw an event of the given class (ranges as in the scheduler, including mimic variants). */
export function drawEvent(cls: Cls, age: number, r: Rng, mimicsOnly = false): { event?: ForcedEvent; civ?: CivilizationParams; t1: number } {
  switch (cls) {
    case 'civilization': { const civ = drawCivilization(age, r); return { civ, t1: age - civ.durationYr / 1e6 }; }
    case 'clathrate': {
      const e = makeClathrate(age, r);
      if (mimicsOnly || r.chance(0.3)) { e.massPg = r.range(1500, 3000); e.onsetKyr = r.logUniform(1, 5); }
      return { event: e, t1: age - e.onsetKyr / 1000 };
    }
    case 'lip': {
      const e = mimicsOnly || r.chance(0.35) ? makeLipBurst(age, r) : makeLip(age, r);
      if (e.kind !== 'lip') throw new Error('unreachable');
      return { event: e, t1: age - e.durationMyr };
    }
    case 'bolide': {
      const e = makeBolide(age, mimicsOnly ? drawDiameter(r, 3, 9) : drawDiameter(r, 1, 20), r, 40);
      return { event: e, t1: age };
    }
    case 'supernova': { const e = makeSupernova(age, r); return { event: e, t1: age - e.durationKyr / 1000 }; }
    case 'aridification': { const e = makeAridification(age, r); return { event: e, t1: age - e.durationKyr / 1000 }; }
  }
}

export function makeMini(cls: Cls, seed: string, opts: { mimicsOnly?: boolean } = {}): Mini {
  const r = new Rng(`mini|${cls}|${seed}`);
  const age = r.range(6.5, 10);
  const { event, civ, t1 } = drawEvent(cls, age, r.fork('event'), opts.mimicsOnly);
  const config = makeConfig(`mini-${cls}-${seed}`, 'dev', { budget: 1e9, civBaseRate: 0, eventDensity: 0, mimicFrequency: 0 });
  config.grid = { nx: 10, ny: 10, cellKm: 8 };
  config.durationMyr = 16;
  config.baseDtYr = 100_000;
  // ordinary background volcanism: ash only
  const ash = scheduleEvents(r.fork('bg'), 16, 1, 40, { lip: 0, bolideGlobal: 0, bolideRegional: 0, clathrate: 0, supernova: 0, aridification: 0, ashPerLipMyr: 0 }).ashes;
  const world = generateWorld(config, undefined, { schedule: makeSchedule(event ? [event] : [], ash), civilization: civ ?? false });
  return { world, cls, t0: age, t1 };
}
