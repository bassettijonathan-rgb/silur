/**
 * The truth catalog: every forced event and every emergent episode, with causal links. This is the ground
 * truth the player's submission is scored against (M7) and what the reveal shows.
 */
import { TimePlan } from '../../shared/timeplan';
import { BioWorld } from '../bio/diversify';
import { EarthHistory } from '../earth/run';
import { Episode, findEpisodes } from './segmenter';
import { Cause, ForcedEvent, TruthEvent } from './types';

function forcedToTruth(e: ForcedEvent): Omit<TruthEvent, 'id' | 'parents'> {
  switch (e.kind) {
    case 'lip':
      return { type: 'lip', cls: 'forced', ageMa: [e.ageMa, e.ageMa - e.durationMyr], magnitude: e.carbonPg, cause: 'lip',
        params: { carbonPg: e.carbonPg, d13C: e.d13C, sulfurPg: e.sulfurPg, hgMult: e.hgMult, durationMyr: e.durationMyr } };
    case 'bolide':
      return { type: 'bolide', cls: 'forced', ageMa: [e.ageMa, e.ageMa], magnitude: e.diameterKm, cause: 'bolide',
        params: { diameterKm: e.diameterKm, xKm: e.xKm, yKm: e.yKm } };
    case 'clathrate':
      return { type: 'clathrate', cls: 'forced', ageMa: [e.ageMa, e.ageMa - e.onsetKyr / 1000], magnitude: e.massPg, cause: 'clathrate',
        params: { massPg: e.massPg, onsetKyr: e.onsetKyr } };
    case 'aridification':
      return { type: 'aridification', cls: 'forced', ageMa: [e.ageMa, e.ageMa - e.durationKyr / 1000], magnitude: e.sedMult, cause: 'tectonic',
        params: { durationKyr: e.durationKyr, sedMult: e.sedMult, coverLoss: e.coverLoss, habitat: e.habitat, predation: e.predation } };
    case 'supernova':
      return { type: 'supernova', cls: 'forced', ageMa: [e.ageMa, e.ageMa - e.durationKyr / 1000], magnitude: e.ozoneLoss, cause: 'supernova',
        params: { ozoneLoss: e.ozoneLoss, durationKyr: e.durationKyr, fe60: e.fe60 } };
  }
}

/** Does an effect starting at `startMa` plausibly follow cause `c` (which began at c.ageMa[0] and ended at c.ageMa[1])? */
function follows(c: TruthEvent, startMa: number, lagMyr: number, endMa: number): boolean {
  // the effect must begin after the cause began, and not more than `lagMyr` after the cause ended
  const afterStart = startMa <= c.ageMa[0] + 0.05;
  const notTooLate = startMa >= c.ageMa[1] - lagMyr;
  // ...and (for effects that end before the cause started) must overlap it at all
  return afterStart && notTooLate && endMa <= c.ageMa[0] + 0.05;
}

export function buildCatalog(plan: TimePlan, earth: EarthHistory, bio: BioWorld, forced: ForcedEvent[], extra: TruthEvent[] = []): TruthEvent[] {
  const raw: Omit<TruthEvent, 'id' | 'parents'>[] = [
    ...forced.map(forcedToTruth),
    ...extra.map((e) => ({ type: e.type, cls: e.cls, ageMa: e.ageMa, magnitude: e.magnitude, cause: e.cause, params: e.params })),
    ...findEpisodes(plan, earth, bio).map((ep: Episode) => ({ type: ep.type, cls: 'emergent' as const, ageMa: ep.ageMa, magnitude: ep.magnitude, cause: 'unknown_natural' as Cause, params: ep.params })),
  ];
  raw.sort((a, b) => b.ageMa[0] - a.ageMa[0]);
  const events: TruthEvent[] = raw.map((e, i) => ({ ...e, id: i, parents: [] }));

  // causal links: emergent episodes follow forced events (or each other, for extinctions)
  const rank = (t: string) => (t === 'extinction' ? 3 : t === 'oae' || t === 'hyperthermal' || t === 'glaciation' ? 2 : 1);
  for (const e of events) {
    if (e.cls !== 'emergent') continue;
    const lag = e.type === 'extinction' ? 0.5 : 1.5;
    const cands = events.filter((c) => c.id !== e.id && rank(c.type) < rank(e.type) && follows(c, e.ageMa[0], lag, e.ageMa[1]));
    // nearest in time first, forced causes before emergent ones
    cands.sort((a, b) => (a.cls === b.cls ? Math.abs(a.ageMa[1] - e.ageMa[0]) - Math.abs(b.ageMa[1] - e.ageMa[0]) : a.cls === 'forced' ? -1 : 1));
    e.parents = cands.slice(0, 2).map((c) => c.id);
    if (cands.length) e.cause = cands[0].cause;
    else e.cause = e.type === 'glaciation' ? 'tectonic' : 'unknown_natural';
  }
  return events;
}
