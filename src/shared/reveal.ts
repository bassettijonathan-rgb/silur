/** What the worker sends back after a submission: the score, and the whole truth with the evidence audit (M7). Plain data. */
import { ScoreReport } from './scoring';

export interface EventAudit {
  /** Cells where deposition was going on while the event happened. */
  depositedCells: number;
  /** Cells whose rock record today still contains rock from the event's time. */
  preservedCells: number;
  /** Rock of that age removed by erosion later, m (summed over cells). */
  erasedThicknessM: number;
  /** preserved cells relative to a comfortable 4 % of the map, capped at 1. */
  detectability: number;
  /** How big and distinctive the event is, 0..1 (independent of preservation). */
  significance: number;
  /** significance × detectability: the penalty weight for not finding it. */
  weight: number;
  /** Id of the submitted event that was matched to it, if any. */
  matchedBy: string | null;
}

export interface RevealEvent {
  id: number;
  type: string;
  cls: 'forced' | 'emergent';
  ageMa: [number, number];
  magnitude: number;
  cause: string;
  parents: number[];
  params: Record<string, number>;
  audit: EventAudit;
}

export interface RevealSeries { id: string; label: string; unit: string; values: number[] }

export interface IdealReport {
  pCivilization: number;
  headlineBits: number;
  /** Did the solvability gate accept this world (false = left murky: the honest answer was "I can't tell"). */
  solvable: boolean;
  murky: boolean;
  attempts: number;
  events: { eventId: number; type: string; trueClass: string; pTrue: number; top: string; pTop: number }[];
}

export interface RevealPayload {
  seed: string;
  modelVersion: string;
  worldHash: number;
  durationMyr: number;
  cells: number;
  civilization: { present: boolean; params: Record<string, number> | null; ageMa: [number, number] | null };
  events: RevealEvent[];
  curves: { ageMa: number[]; series: RevealSeries[] };
  /** Thickness of rock destroyed by erosion, binned by the age of the rock (Myr bins). */
  erasedByAge: { ageMa: number[]; thicknessM: number[] };
  ideal: IdealReport | null;
}

export interface RevealMessage { score: ScoreReport; reveal: RevealPayload }
