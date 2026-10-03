/**
 * Hidden agents (design §4.9). An agent acts on the planet ONLY through `Forcing` — the same physical channels
 * volcanoes and impacts use — plus the time-plan windows it needs for resolution. There is no agent-specific marker.
 */
import { Forcing } from '../../shared/forcing';
import { TimeWindow } from '../../shared/timeplan';
import { TruthEvent } from '../events/types';

export interface Agent {
  kind: 'civilization' | 'terraform' | 'probe';
  /** Onset, Ma before present. */
  ageMa: number;
  windows(): TimeWindow[];
  /** Average forcing over the step [a1, a0] (a0 older). */
  forcing(a0: number, a1: number): Forcing;
  /** Catalog entry for the truth record. */
  truth(): Omit<TruthEvent, 'id' | 'parents'>;
}
