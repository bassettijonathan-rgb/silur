/** Editing helpers for the submission draft (pure). The draft is what the player is writing; `Submission` is what gets sent. */
import { CAUSES, CauseId, Submission, SubmissionType, SubmittedEvent, isEpisode } from '../shared/submission';

export function emptyDraft(): Submission { return { pCivilization: 0.4, events: [] }; }

export function nextEventId(draft: Submission): string {
  let n = draft.events.length + 1;
  while (draft.events.some((e) => e.id === `e${n}`)) n++;
  return `e${n}`;
}

/** A new event row at an age window (default: the whole record, i.e. "somewhere"). */
export function newEvent(draft: Submission, type: SubmissionType, ageMinMa: number, ageMaxMa: number): SubmittedEvent {
  const e: SubmittedEvent = { id: nextEventId(draft), type, ageMinMa: Math.min(ageMinMa, ageMaxMa), ageMaxMa: Math.max(ageMinMa, ageMaxMa), exists: 0.7, causes: isEpisode(type) ? uniformCauses() : {} };
  draft.events.push(e);
  return e;
}

export function uniformCauses(): Partial<Record<CauseId, number>> {
  return Object.fromEntries(CAUSES.map((c) => [c, 1 / CAUSES.length])) as Partial<Record<CauseId, number>>;
}

/** Set one cause to a probability and rescale the others so the total stays 1. */
export function setCause(e: SubmittedEvent, cause: CauseId, p: number): void {
  const q = Math.min(1, Math.max(0, p));
  const others = CAUSES.filter((c) => c !== cause);
  const rest = others.reduce((a, c) => a + (e.causes[c] ?? 0), 0);
  const next: Partial<Record<CauseId, number>> = { [cause]: q };
  for (const c of others) next[c] = rest > 1e-12 ? ((e.causes[c] ?? 0) / rest) * (1 - q) : (1 - q) / others.length;
  e.causes = next;
}

export function removeEvent(draft: Submission, id: string): void { draft.events = draft.events.filter((e) => e.id !== id); }
