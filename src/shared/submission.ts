/**
 * What the player hands in (M7): a headline probability that a civilization existed, plus a list of events, each with an
 * 80 % age interval, a probability that it really happened, and (for episodes whose cause is not obvious) a probability
 * for each candidate cause. Plain data; validated and sanitised here before it is ever scored.
 */

/** Things a player can claim happened. The first four are "episodes" seen in the rocks (their cause is the question). */
export const EPISODE_TYPES = ['glaciation', 'oae', 'hyperthermal', 'extinction'] as const;
/** Things that are themselves a cause. */
export const CAUSE_TYPES = ['lip', 'bolide', 'clathrate', 'supernova', 'aridification', 'civilization'] as const;
export const SUBMISSION_TYPES = [...EPISODE_TYPES, ...CAUSE_TYPES] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

/** Candidate causes for an episode. Aridification (uplift, monsoon failure) is filed under "tectonic". */
export const CAUSES = ['lip', 'bolide', 'clathrate', 'supernova', 'civilization', 'tectonic', 'unknown_natural'] as const;
export type CauseId = (typeof CAUSES)[number];

export const isEpisode = (t: SubmissionType): boolean => (EPISODE_TYPES as readonly string[]).includes(t);

export const TYPE_LABEL: Record<SubmissionType, string> = {
  glaciation: 'glaciation', oae: 'ocean anoxic event', hyperthermal: 'hyperthermal (warming spike)', extinction: 'extinction pulse',
  lip: 'large igneous province', bolide: 'impact', clathrate: 'methane-hydrate release', supernova: 'supernova', aridification: 'aridification / uplift pulse',
  civilization: 'civilization',
};

export interface SubmittedEvent {
  id: string;
  type: SubmissionType;
  /** 80 % interval, Ma before present (min = younger edge). */
  ageMinMa: number;
  ageMaxMa: number;
  /** Probability that an event of this type really occurred in this interval. */
  exists: number;
  /** Probability per candidate cause (only used for episodes). Need not sum to one; normalised on entry. */
  causes: Partial<Record<CauseId, number>>;
  note?: string;
}

export interface Submission {
  /** Probability that a civilization existed at any time. */
  pCivilization: number;
  events: SubmittedEvent[];
  summary?: string;
}

export const MAX_SUBMITTED_EVENTS = 60;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Returns a cleaned copy or throws an Error with a message fit for the player. */
export function sanitizeSubmission(raw: unknown): Submission {
  const s = raw as Partial<Submission> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.events)) throw new Error('a submission needs pCivilization and an events list');
  if (typeof s.pCivilization !== 'number' || !Number.isFinite(s.pCivilization)) throw new Error('pCivilization must be a number between 0 and 1');
  if (s.events.length > MAX_SUBMITTED_EVENTS) throw new Error(`at most ${MAX_SUBMITTED_EVENTS} events`);
  const seen = new Set<string>();
  const events = s.events.map((e, i): SubmittedEvent => {
    if (!e || !(SUBMISSION_TYPES as readonly string[]).includes(e.type)) throw new Error(`event ${i + 1}: unknown type`);
    const lo = Number(e.ageMinMa), hi = Number(e.ageMaxMa);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`event ${i + 1}: ages must be numbers`);
    const id = String(e.id ?? `e${i + 1}`);
    if (seen.has(id)) throw new Error(`event ${i + 1}: duplicate id`);
    seen.add(id);
    let total = 0;
    const raw: Partial<Record<CauseId, number>> = {};
    for (const c of CAUSES) { const v = Math.max(0, Number(e.causes?.[c] ?? 0)); if (Number.isFinite(v) && v > 0) { raw[c] = v; total += v; } }
    const causes: Partial<Record<CauseId, number>> = {};
    if (total > 0) for (const c of CAUSES) if (raw[c]) causes[c] = raw[c]! / total;
    return { id, type: e.type, ageMinMa: Math.min(lo, hi), ageMaxMa: Math.max(lo, hi), exists: clamp01(Number(e.exists)), causes, note: e.note };
  });
  return { pCivilization: clamp01(s.pCivilization), events, summary: s.summary };
}
