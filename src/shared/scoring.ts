/**
 * Scoring rules (pure; design D6). Everything is in "bits" relative to a naive baseline, so 0 means "no better than
 * knowing nothing" and positive means skill:
 *   - probabilities (headline, event exists): floored log score vs. 50 %          — strictly proper
 *   - cause of an episode:                    floored log score vs. uniform       — strictly proper
 *   - age:                                    3·(1 − IS/IS_ref), floored at −3    — IS is the proper interval score for an 80 % interval
 *   - missed events:                          −MISS_BITS × weight, where weight = significance × detectability-in-principle
 * Brier is reported next to the log score for the probability statements.
 *
 * Two forgiving rules keep the score about science rather than bookkeeping:
 *   - an episode claim ("hyperthermal", "extinction pulse"…) may be matched to the forced event that causes it (clathrate, LIP, impact…), at a small
 *     distance penalty, because a geologist sees the effect before she names the cause;
 *   - misses are charged per CLUSTER (a forced event and everything it caused): finding any member of the cluster clears the whole cluster, and an
 *     unfound cluster costs its heaviest member once.
 */
import { CAUSES, CauseId, SubmissionType, Submission, SubmittedEvent, isEpisode } from './submission';

export const P_FLOOR = 0.01;
export const ALPHA = 0.2; //          80 % central interval
export const AGE_REF_MYR = 2; //     an interval score this large earns 0 age bits
export const AGE_MAX_BITS = 3;
export const AGE_MIN_BITS = -3;
export const MISS_BITS = 2;
/** The headline question is the main puzzle: the event list (existence, cause, age, misses) counts a quarter as much per bit in the total. Per-item bits shown in the reveal are unweighted. */
export const EVENT_WEIGHT = 0.25;
export const MATCH_TOL_MYR = 0.1;

const log2 = (x: number): number => Math.log(x) / Math.LN2;
const floorP = (p: number): number => Math.min(1 - P_FLOOR, Math.max(P_FLOOR, p));

/** Log score in bits of a yes/no probability against a 50 % baseline. */
export function binaryBits(p: number, outcome: boolean): number { return log2((outcome ? floorP(p) : 1 - floorP(p)) / 0.5); }
export function brier(p: number, outcome: boolean): number { return (p - (outcome ? 1 : 0)) ** 2; }
/** Log score in bits of the probability given to the truth among `k` equiprobable alternatives. */
export function categoricalBits(pTruth: number, k = CAUSES.length): number { return log2(Math.max(P_FLOOR, pTruth) * k); }

/** Gneiting–Raftery interval score for the central (1−α) interval [l, u] and the outcome x. Lower is better. */
export function intervalScore(l: number, u: number, x: number, alpha = ALPHA): number {
  return (u - l) + (2 / alpha) * Math.max(0, l - x) + (2 / alpha) * Math.max(0, x - u);
}
export function ageBitsRaw(is: number): number { return AGE_MAX_BITS * (1 - is / AGE_REF_MYR); }
export function ageBits(is: number): number { return Math.max(AGE_MIN_BITS, ageBitsRaw(is)); }

/** What the truth offers for matching: one per catalog entry. */
export interface ScoreTarget {
  id: number;
  type: SubmissionType | 'other';
  /** [older, younger], Ma. */
  ageMa: [number, number];
  cause: CauseId;
  /** significance × detectability, 0..1. Zero = nobody could be blamed for missing it. */
  weight: number;
  /** Events linked by cause (a LIP and the OAEs and extinctions it triggered) share a cluster id. */
  cluster: number;
}

export interface MatchReport {
  submittedId: string; truthId: number; type: SubmissionType;
  truthAgeMa: [number, number]; truthMidMa: number; ageErrorMa: number; covered: boolean;
  intervalScore: number; ageBits: number;
  existsBits: number;
  trueCause: CauseId; pTrueCause: number | null; causeBits: number | null;
}
export interface FalsePositiveReport { submittedId: string; type: SubmissionType; exists: number; bits: number }
export interface MissReport { truthId: number; type: SubmissionType | 'other'; ageMa: [number, number]; weight: number; bits: number }

export interface ScoreReport {
  headline: { p: number; truth: boolean; bits: number; brier: number };
  matches: MatchReport[];
  falsePositives: FalsePositiveReport[];
  misses: MissReport[];
  /** Probability statements with their outcomes, for the reliability diagram. */
  calibration: { kind: 'headline' | 'event' | 'cause'; p: number; outcome: boolean }[];
  totals: { headline: number; existence: number; cause: number; age: number; miss: number; total: number };
  /** What an empty submission (no events, 50 % headline) would have scored here: the cost of every detectable event going unfound. */
  doNothing: number;
  /** Mean Brier over all probability statements. */
  brier: number;
}

/** Minimum-total-distance assignment (Hungarian algorithm, Jonker–Volgenant style potentials). cost[i][j], rows ≤ cols. Returns col per row. */
export function assign(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  if (n > m) {
    const t = Array.from({ length: m }, (_, j) => cost.map((r) => r[j]));
    const colOfRow = assign(t); // rows of t are original columns
    const out = new Array<number>(n).fill(-1);
    colOfRow.forEach((i, j) => { if (i >= 0) out[i] = j; });
    return out;
  }
  const INF = 1e18;
  const u = new Array<number>(n + 1).fill(0), v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0), way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF), used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
  return out;
}

const BIG = 1e6;
/** Which forced events an episode claim may stand for (the claim's cause probabilities are then judged against the truth's real cause). */
const ALIAS: Partial<Record<SubmissionType, SubmissionType[]>> = {
  hyperthermal: ['clathrate', 'lip', 'civilization'], oae: ['lip', 'clathrate'], extinction: ['bolide', 'lip', 'aridification', 'civilization'], glaciation: [],
};
const ALIAS_PENALTY_MYR = 0.3;
const mid = (a: [number, number]): number => 0.5 * (a[0] + a[1]);

/** Which submitted event explains which truth entry: same type, intervals overlapping within a tolerance, minimum total age distance. */
export function matchEvents(sub: SubmittedEvent[], targets: ScoreTarget[], tol = MATCH_TOL_MYR): Map<string, ScoreTarget> {
  const cost = sub.map((s) => targets.map((t) => {
    const exact = t.type === s.type;
    if (!exact && !(ALIAS[s.type] as string[] | undefined)?.includes(t.type)) return BIG;
    if (s.ageMinMa - tol > t.ageMa[0] || s.ageMaxMa + tol < t.ageMa[1]) return BIG;
    return Math.abs(mid(t.ageMa) - 0.5 * (s.ageMinMa + s.ageMaxMa)) + (exact ? 0 : ALIAS_PENALTY_MYR);
  }));
  const out = new Map<string, ScoreTarget>();
  if (!sub.length || !targets.length) return out;
  assign(cost).forEach((j, i) => { if (j >= 0 && cost[i][j] < BIG) out.set(sub[i].id, targets[j]); });
  return out;
}

export function scoreSubmission(sub: Submission, targets: ScoreTarget[], civilizationPresent: boolean): ScoreReport {
  const matched = matchEvents(sub.events, targets);
  const calibration: ScoreReport['calibration'] = [];
  const headlineBits = binaryBits(sub.pCivilization, civilizationPresent);
  calibration.push({ kind: 'headline', p: sub.pCivilization, outcome: civilizationPresent });
  const briers = [brier(sub.pCivilization, civilizationPresent)];

  const matches: MatchReport[] = [];
  const falsePositives: FalsePositiveReport[] = [];
  let existence = 0, cause = 0, age = 0;
  const used = new Set<number>();
  for (const s of sub.events) {
    const t = matched.get(s.id);
    if (!t) {
      const bits = binaryBits(s.exists, false);
      falsePositives.push({ submittedId: s.id, type: s.type, exists: s.exists, bits });
      existence += bits; calibration.push({ kind: 'event', p: s.exists, outcome: false }); briers.push(brier(s.exists, false));
      continue;
    }
    used.add(t.id);
    const exBits = binaryBits(s.exists, true);
    existence += exBits; calibration.push({ kind: 'event', p: s.exists, outcome: true }); briers.push(brier(s.exists, true));
    const x = mid(t.ageMa);
    const is = intervalScore(s.ageMinMa, s.ageMaxMa, x);
    const ab = ageBits(is);
    age += ab;
    let pTrue: number | null = null, cb: number | null = null;
    if (isEpisode(s.type)) {
      const given = CAUSES.some((c) => (s.causes[c] ?? 0) > 0);
      pTrue = given ? (s.causes[t.cause] ?? 0) : 1 / CAUSES.length;
      cb = categoricalBits(pTrue);
      cause += cb;
      if (given) {
        const top = CAUSES.reduce((a, c) => ((s.causes[c] ?? 0) > (s.causes[a] ?? 0) ? c : a), CAUSES[0]);
        calibration.push({ kind: 'cause', p: s.causes[top] ?? 0, outcome: top === t.cause });
        briers.push(brier(s.causes[top] ?? 0, top === t.cause));
      }
    }
    matches.push({
      submittedId: s.id, truthId: t.id, type: s.type, truthAgeMa: t.ageMa, truthMidMa: x, ageErrorMa: mid([s.ageMinMa, s.ageMaxMa]) - x,
      covered: x >= s.ageMinMa && x <= s.ageMaxMa, intervalScore: is, ageBits: ab, existsBits: exBits, trueCause: t.cause, pTrueCause: pTrue, causeBits: cb,
    });
  }
  // misses, per cluster: found if any member was matched; otherwise the heaviest member is charged once
  const found = new Set(targets.filter((t) => used.has(t.id)).map((t) => t.cluster));
  const heaviest = new Map<number, ScoreTarget>();
  for (const t of targets) {
    if (found.has(t.cluster) || t.weight <= 0) continue;
    const h = heaviest.get(t.cluster);
    if (!h || t.weight > h.weight) heaviest.set(t.cluster, t);
  }
  const misses: MissReport[] = [];
  let miss = 0;
  for (const t of heaviest.values()) {
    const bits = -MISS_BITS * t.weight;
    miss += bits;
    misses.push({ truthId: t.id, type: t.type, ageMa: t.ageMa, weight: t.weight, bits });
  }
  const W = EVENT_WEIGHT;
  const doNothing = -MISS_BITS * clusterWeights(targets) * W;
  const totals = { headline: headlineBits, existence: existence * W, cause: cause * W, age: age * W, miss: miss * W, total: headlineBits + W * (existence + cause + age + miss) };
  return {
    headline: { p: sub.pCivilization, truth: civilizationPresent, bits: headlineBits, brier: briers[0] },
    matches, falsePositives, misses, calibration, totals, doNothing, brier: briers.reduce((a, b) => a + b, 0) / briers.length,
  };
}

/** Σ over clusters of the heaviest member's weight: the total a player could be charged for finding nothing. */
export function clusterWeights(targets: ScoreTarget[]): number {
  const best = new Map<number, number>();
  for (const t of targets) best.set(t.cluster, Math.max(best.get(t.cluster) ?? 0, t.weight));
  let s = 0;
  for (const w of best.values()) s += w;
  return s;
}
