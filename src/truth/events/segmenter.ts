/**
 * Segmenter: find the EMERGENT episodes in the finished Earth/biosphere history (design D4). OAEs, glaciations
 * and hyperthermals are outcomes of the box model, not scripted; extinction pulses are outcomes of the
 * biosphere. They are labelled after the fact so the game has a ground truth to score against.
 */
import { TimePlan } from '../../shared/timeplan';
import { BioWorld } from '../bio/diversify';
import { EarthHistory } from '../earth/run';

export interface Episode {
  type: 'oae' | 'glaciation' | 'hyperthermal' | 'extinction';
  /** [older, younger] edge, Ma. */
  ageMa: [number, number];
  magnitude: number;
  params: Record<string, number>;
}

/** Contiguous runs where `x > threshold`, merging gaps shorter than `mergeMyr`; drops runs shorter than `minMyr`. */
export function findRuns(plan: TimePlan, x: ArrayLike<number>, threshold: number, minMyr: number, mergeMyr: number): { s0: number; s1: number; peak: number }[] {
  const runs: { s0: number; s1: number; peak: number }[] = [];
  let cur: { s0: number; s1: number; peak: number } | null = null;
  for (let s = 0; s < plan.n; s++) {
    if (x[s] > threshold) {
      if (cur && plan.ageTopMa[cur.s1] - plan.ageBaseMa[s] <= mergeMyr) { cur.s1 = s; cur.peak = Math.max(cur.peak, x[s]); }
      else { if (cur) runs.push(cur); cur = { s0: s, s1: s, peak: x[s] }; }
    }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => plan.ageBaseMa[r.s0] - plan.ageTopMa[r.s1] >= minMyr);
}

export function findEpisodes(plan: TimePlan, earth: EarthHistory, bio: BioWorld): Episode[] {
  const E = earth.mean;
  const out: Episode[] = [];
  const span = (r: { s0: number; s1: number }): [number, number] => [plan.ageBaseMa[r.s0], plan.ageTopMa[r.s1]];

  for (const r of findRuns(plan, E.anoxic, 0.25, 0.04, 0.2))
    out.push({ type: 'oae', ageMa: span(r), magnitude: r.peak, params: { peakAnoxicFraction: r.peak } });

  for (const r of findRuns(plan, E.ice, 0.3, 0.3, 0.3)) {
    let low = 0;
    for (let s = r.s0; s <= r.s1; s++) low = Math.min(low, E.seaLevel[s]);
    out.push({ type: 'glaciation', ageMa: span(r), magnitude: r.peak, params: { peakIce: r.peak, minSeaLevelM: low } });
  }

  // hyperthermals: warming of > 2.5 K above a 3-Myr running mean
  const anomaly = new Float64Array(plan.n);
  let run = E.tempC[0];
  for (let s = 0; s < plan.n; s++) {
    run += (1 - Math.exp(-plan.dtYr[s] / 3e6)) * (E.tempC[s] - run);
    anomaly[s] = E.tempC[s] - run;
  }
  for (const r of findRuns(plan, anomaly, 2.5, 0.02, 0.1))
    out.push({ type: 'hyperthermal', ageMa: span(r), magnitude: r.peak, params: { peakWarmingK: r.peak } });

  // extinction pulses: per-species loss rate well above the typical background
  const rate = new Float64Array(plan.n);
  for (let s = 0; s < plan.n; s++) rate[s] = bio.deaths[s] / Math.max(1, s > 0 ? bio.living[s - 1] : bio.living[s]) / (plan.dtYr[s] / 1e6);
  const sorted = Array.from(rate).sort((a, b) => a - b);
  const bg = Math.max(sorted[Math.floor(sorted.length / 2)], 0.05);
  for (const r of findRuns(plan, rate, 3 * bg, 0, 0.3)) {
    // significance: observed deaths in the cluster must clearly exceed the background expectation
    let deaths = 0, expected = 0;
    for (let s = r.s0; s <= r.s1; s++) { deaths += bio.deaths[s]; expected += bg * (plan.dtYr[s] / 1e6) * s0Living(bio, s); }
    const frac = (deaths - expected) / Math.max(1, s0Living(bio, r.s0));
    if (deaths > expected + 4 * Math.sqrt(expected + 1) && frac >= 0.06)
      out.push({ type: 'extinction', ageMa: span(r), magnitude: Math.min(1, frac), params: { fractionLost: Math.min(1, frac), backgroundRatePerMyr: bg } });
  }
  return out;
}

const s0Living = (bio: BioWorld, s: number): number => (s > 0 ? bio.living[s - 1] : bio.living[s]);
