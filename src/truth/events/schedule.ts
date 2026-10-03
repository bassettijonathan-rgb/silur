/**
 * Draw the scheduled events of a world: Poisson processes (rates per Myr × `eventDensity`) for each forced
 * event type, plus background ash eruptions. Also collects the TimePlan refinement windows they need.
 */
import { Rng } from '../../shared/rng';
import { TimeWindow } from '../../shared/timeplan';
import { makeAsh, ashWindows } from './ash';
import { bolideWindows, drawDiameter, makeBolide } from './bolide';
import { clathrateWindows, makeClathrate } from './clathrate';
import { lipWindows, makeLip } from './lip';
import { makeSupernova, supernovaWindows } from './supernova';
import { AshEvent, ForcedEvent } from './types';

export interface EventRates {
  lip: number;
  bolideGlobal: number;
  bolideRegional: number;
  clathrate: number;
  supernova: number;
  ash: number;
  /** Extra explosive eruptions per Myr during a LIP. */
  ashPerLipMyr: number;
}

export const DEFAULT_RATES: EventRates = {
  lip: 0.012, bolideGlobal: 0.012, bolideRegional: 0.03, clathrate: 0.012, supernova: 0.004, ash: 0.4, ashPerLipMyr: 2,
};

export interface Schedule {
  forced: ForcedEvent[];
  ashes: AshEvent[];
  windows: TimeWindow[];
}

export function scheduleEvents(
  rng: Rng, durationMyr: number, eventDensity: number, mapHalfKm: number, rates: Partial<EventRates> = {},
): Schedule {
  const R = { ...DEFAULT_RATES, ...rates };
  const r = rng.fork('events');
  const forced: ForcedEvent[] = [];
  const ashes: AshEvent[] = [];
  const count = (rate: number, k: string) => r.fork('n:' + k).poisson(rate * durationMyr * eventDensity);
  /** Onset age such that the event's whole footprint (`span` Myr after onset) fits in the record. */
  const onset = (rr: Rng, spanMyr: number) => rr.range(spanMyr + 1.5, durationMyr - 3);

  const rl = r.fork('lip');
  for (let i = 0; i < count(R.lip, 'lip'); i++) { const e = makeLip(onset(rl, 3), rl); forced.push(e); }
  const rb = r.fork('bolide');
  for (let i = 0; i < count(R.bolideGlobal, 'bg'); i++) forced.push(makeBolide(onset(rb, 0.1), drawDiameter(rb, 4, 20), rb, mapHalfKm));
  for (let i = 0; i < count(R.bolideRegional, 'br'); i++) forced.push(makeBolide(onset(rb, 0.1), drawDiameter(rb, 1, 4), rb, mapHalfKm));
  const rc = r.fork('clathrate');
  for (let i = 0; i < count(R.clathrate, 'cl'); i++) forced.push(makeClathrate(onset(rc, 1.3), rc));
  const rs = r.fork('supernova');
  for (let i = 0; i < count(R.supernova, 'sn'); i++) forced.push(makeSupernova(onset(rs, 0.1), rs));

  const ra = r.fork('ash');
  for (let i = 0; i < count(R.ash, 'ash'); i++) ashes.push(makeAsh(ra.range(0.5, durationMyr - 0.5), ra, mapHalfKm));
  for (const e of forced) {
    if (e.kind !== 'lip') continue;
    const n = ra.poisson(R.ashPerLipMyr * e.durationMyr);
    for (let i = 0; i < n; i++) {
      const a = makeAsh(e.ageMa - ra.next() * e.durationMyr, ra, mapHalfKm);
      a.volumeKm3 *= 3; // flood-volcanism-associated eruptions are large
      ashes.push(a);
    }
  }

  return makeSchedule(forced, ashes);
}

/** Build a Schedule (with its TimePlan refinement windows) from explicit events — used by tests and by scenario worlds. */
export function makeSchedule(forced: ForcedEvent[], ashes: AshEvent[] = []): Schedule {
  const windows: TimeWindow[] = [];
  for (const e of forced) {
    if (e.kind === 'lip') windows.push(...lipWindows(e));
    else if (e.kind === 'bolide') windows.push(...bolideWindows(e));
    else if (e.kind === 'clathrate') windows.push(...clathrateWindows(e));
    else windows.push(...supernovaWindows(e));
  }
  for (const a of ashes) windows.push(...ashWindows(a));
  return { forced, ashes, windows };
}
