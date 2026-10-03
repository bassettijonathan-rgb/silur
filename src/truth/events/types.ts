/**
 * Event types, the truth catalog entry, and the small time helpers every event module shares.
 *
 * Two channels (design D4/§4.8): *rates* go through `Forcing` and must be given as the AVERAGE over the plan
 * step (so intensity × step length = dose, which the biosphere's hazard model relies on); *instantaneous
 * deposits* (ejecta clay, ash beds, fallout) go through the `EventSource`.
 */

export type EventType =
  | 'lip' | 'bolide' | 'clathrate' | 'supernova' //          forced natural events
  | 'glaciation' | 'oae' | 'hyperthermal' | 'extinction' //   emergent episodes found by the segmenter
  | 'aridification' //                                        forced climate/tectonic pulse (natural mimic of land-use change)
  | 'civilization' | 'terraform' | 'probe'; //                hidden agents

export type Cause = 'lip' | 'bolide' | 'clathrate' | 'supernova' | 'civilization' | 'terraform' | 'probe' | 'tectonic' | 'unknown_natural';

export interface TruthEvent {
  id: number;
  type: EventType;
  cls: 'forced' | 'emergent';
  /** [older, younger] edge, Ma before present. */
  ageMa: [number, number];
  /** Type-specific size: bolide diameter km, LIP Pg C, clathrate Pg C, OAE peak anoxic fraction, glaciation peak ice, hyperthermal K, extinction fraction lost. */
  magnitude: number;
  cause: Cause;
  /** Ids of events that caused this one. */
  parents: number[];
  /** Free-form physical parameters, for the reveal. */
  params: Record<string, number>;
}

// ---- scheduled (forced) events -------------------------------------------------------------

export interface LipEvent { kind: 'lip'; ageMa: number; durationMyr: number; carbonPg: number; d13C: number; sulfurPg: number; hgMult: number; pulses: number[] }
export interface BolideEvent { kind: 'bolide'; ageMa: number; diameterKm: number; xKm: number; yKm: number }
export interface ClathrateEvent { kind: 'clathrate'; ageMa: number; massPg: number; onsetKyr: number }
export interface SupernovaEvent { kind: 'supernova'; ageMa: number; ozoneLoss: number; durationKyr: number; fe60: number }
export interface AshEvent { kind: 'ash'; ageMa: number; volumeKm3: number; xKm: number; yKm: number; windDeg: number }
/** A natural pulse of erosion and vegetation loss (uplift, monsoon failure): imitates the land-use signature of a civilization. */
export interface AridificationEvent { kind: 'aridification'; ageMa: number; durationKyr: number; sedMult: number; coverLoss: number; habitat: number; predation: number }
export type ForcedEvent = LipEvent | BolideEvent | ClathrateEvent | SupernovaEvent | AridificationEvent;

/** Fraction of the time interval [a1, a0] (Ma, a0 older) during which a pulse that starts at `startMa` and lasts `durYr` is on. */
export function pulseFractionInStep(startMa: number, durYr: number, a0: number, a1: number): number {
  const endMa = startMa - durYr / 1e6;
  const overlapMyr = Math.min(a0, startMa) - Math.max(a1, endMa);
  if (overlapMyr <= 0) return 0;
  return overlapMyr / (a0 - a1);
}

/** Step-average of a rectangular pulse: peak × (time on) / (step length). */
export function avgOverStep(peak: number, startMa: number, durYr: number, a0: number, a1: number): number {
  return peak * pulseFractionInStep(startMa, durYr, a0, a1);
}

/** Does an instantaneous event at `ageMa` fall in the step whose midpoint is `ageMid` and length is `dtYr`? */
export function inStep(ageMa: number, ageMid: number, dtYr: number): boolean {
  const half = dtYr / 2e6;
  return ageMa > ageMid - half - 1e-9 && ageMa <= ageMid + half + 1e-9;
}
