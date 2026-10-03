/**
 * Correlation between cores (pure, Layer 3). A tie says "this depth in core A is the same moment as that depth in
 * core B". The player draws ties from marker beds (ash), matching isotope excursions, shared fossils, or a hunch.
 * Ages flow along ties from cores that have radiometric dates to cores that have none, with the tie's own
 * uncertainty added in quadrature. Nothing here knows whether a tie is *right*; that is the player's problem.
 */
import { AgeModel, AgePoint, fitAgeModel } from './agemodel';

export type TieKind = 'ash' | 'excursion' | 'fossil' | 'manual';

/** How well each kind of correlation pins down simultaneity, in Myr (1σ). Ash is a true isochron. */
export const TIE_SIGMA_MA: Record<TieKind, number> = { ash: 0, excursion: 0.05, fossil: 0.3, manual: 0.2 };

export interface TieEnd { coreId: string; depthM: number }
export interface Tie {
  id: string;
  kind: TieKind;
  a: TieEnd;
  b: TieEnd;
  /** Extra age uncertainty contributed by this correlation, Myr. */
  sigmaMa: number;
  note?: string;
}

export function makeTie(id: string, kind: TieKind, a: TieEnd, b: TieEnd, sigmaMa?: number, note?: string): Tie {
  return { id, kind, a, b, sigmaMa: sigmaMa ?? TIE_SIGMA_MA[kind], note };
}

export interface CoreAges {
  models: Map<string, AgeModel>;
  /** Number of tie hops from the nearest directly dated core (0 = has its own dates). */
  generation: Map<string, number>;
}

/**
 * Age models for every core that has dates or is tied (transitively) to one.
 * `dates` are the direct radiometric points per core. Derived points only travel from a core of lower
 * generation to one of higher generation, so a loop of ties cannot count the same date twice.
 */
export function propagateAges(coreIds: string[], dates: Map<string, AgePoint[]>, ties: Tie[]): CoreAges {
  const generation = new Map<string, number>();
  const points = new Map<string, AgePoint[]>();
  const models = new Map<string, AgeModel>();
  const refit = (id: string) => models.set(id, fitAgeModel(points.get(id) ?? []));

  for (const id of coreIds) {
    const d = dates.get(id) ?? [];
    points.set(id, d.filter((p) => p.origin === 'date'));
    if (d.length) { generation.set(id, 0); refit(id); }
  }
  for (let gen = 0; gen < coreIds.length; gen++) {
    const sources = coreIds.filter((id) => generation.get(id) === gen);
    if (!sources.length) break;
    const targets = new Set<string>();
    for (const t of ties) {
      for (const [from, to] of [[t.a, t.b], [t.b, t.a]] as [TieEnd, TieEnd][]) {
        if (!sources.includes(from.coreId)) continue;
        const tg = generation.get(to.coreId);
        if (tg !== undefined && tg <= gen) continue;
        const age = models.get(from.coreId)?.at(from.depthM);
        if (!age) continue;
        points.get(to.coreId)?.push({ depthM: to.depthM, ageMa: age.ageMa, sigmaMa: Math.hypot(age.sigmaMa, t.sigmaMa), origin: 'tie', via: t.id });
        targets.add(to.coreId);
      }
    }
    for (const id of targets) { generation.set(id, gen + 1); refit(id); }
  }
  return { models, generation };
}

/** Do two ties cross (A's order disagrees with B's)? That is geologically impossible without a fault. */
export function crossingTies(ties: Tie[]): [Tie, Tie][] {
  const out: [Tie, Tie][] = [];
  for (let i = 0; i < ties.length; i++) {
    for (let j = i + 1; j < ties.length; j++) {
      const s = ties[i], t = ties[j];
      const same = s.a.coreId === t.a.coreId && s.b.coreId === t.b.coreId;
      const flipped = s.a.coreId === t.b.coreId && s.b.coreId === t.a.coreId;
      if (!same && !flipped) continue;
      const tb = same ? t : { ...t, a: t.b, b: t.a };
      if ((s.a.depthM - tb.a.depthM) * (s.b.depthM - tb.b.depthM) < 0) out.push([s, t]);
    }
  }
  return out;
}
