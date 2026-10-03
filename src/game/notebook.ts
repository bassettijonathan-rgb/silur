/**
 * The detective's notebook (pure, Layer 3): hypotheses with evidence links and a stated confidence.
 * M7 turns the final state of this notebook into a submission; until then it is the player's own record.
 */

export type ClaimType = 'civilization' | 'extinction-cause' | 'event' | 'age' | 'other';
export type HypothesisStatus = 'open' | 'supported' | 'rejected';

export interface EvidenceRef {
  kind: 'core' | 'assay' | 'date' | 'fossil' | 'tie';
  /** Stable id of the thing referred to (core id, tie id, "coreId@depth"). */
  ref: string;
  label: string;
}

export interface Hypothesis {
  id: string;
  title: string;
  text: string;
  claimType: ClaimType;
  evidence: EvidenceRef[];
  /** The player's credence that the hypothesis is true, 0..1. */
  p: number;
  status: HypothesisStatus;
  /** Number of actions taken when it was written: an order, not a clock, so saves replay identically. */
  atAction: number;
}

export class Notebook {
  private items: Hypothesis[] = [];
  private nextId = 1;

  list(): readonly Hypothesis[] { return this.items; }
  get(id: string): Hypothesis | undefined { return this.items.find((h) => h.id === id); }

  add(init: Partial<Hypothesis> & { title: string }, atAction = 0): Hypothesis {
    const h: Hypothesis = {
      id: `h${this.nextId++}`, title: init.title, text: init.text ?? '', claimType: init.claimType ?? 'other',
      evidence: init.evidence ?? [], p: clamp01(init.p ?? 0.5), status: init.status ?? 'open', atAction,
    };
    this.items.push(h);
    return h;
  }

  update(id: string, patch: Partial<Omit<Hypothesis, 'id'>>): Hypothesis {
    const h = this.get(id);
    if (!h) throw new Error(`no hypothesis ${id}`);
    Object.assign(h, patch);
    h.p = clamp01(h.p);
    return h;
  }

  link(id: string, ev: EvidenceRef): void {
    const h = this.get(id);
    if (!h) throw new Error(`no hypothesis ${id}`);
    if (!h.evidence.some((e) => e.kind === ev.kind && e.ref === ev.ref)) h.evidence.push(ev);
  }

  remove(id: string): void { this.items = this.items.filter((h) => h.id !== id); }

  toJSON(): { items: Hypothesis[]; nextId: number } { return { items: this.items.map((h) => ({ ...h, evidence: [...h.evidence] })), nextId: this.nextId }; }
  static fromJSON(d: { items: Hypothesis[]; nextId: number }): Notebook {
    const n = new Notebook();
    n.items = d.items.map((h) => ({ ...h, evidence: [...h.evidence] }));
    n.nextId = d.nextId;
    return n;
  }
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0.5));
