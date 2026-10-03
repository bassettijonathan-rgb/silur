/**
 * Scoring targets, the preservation audit and the reveal (M7). Lives with the truth: it is only ever called by the
 * worker after a submission has been accepted, and it is the one door through which the hidden history leaves.
 */
import { MODEL_VERSION } from '../shared/config';
import { EventAudit, IdealReport, RevealEvent, RevealPayload, RevealSeries } from '../shared/reveal';
import { ScoreReport, ScoreTarget, binaryBits, scoreSubmission } from '../shared/scoring';
import { CauseId, Submission, SubmissionType } from '../shared/submission';
import { stepAtAge } from '../shared/timeplan';
import { Cause, TruthEvent } from '../truth/events/types';
import { NO_DEPOSIT } from '../truth/strat/facies';
import { World, worldHash } from '../truth/world';
import { Solvability } from './solvability/gate';

/** A comfortable record: an event is "fully detectable" when its rock survives in this share of the map. */
export const DETECTABLE_CELL_SHARE = 0.04;

const SUBMISSION_OF: Partial<Record<TruthEvent['type'], SubmissionType>> = {
  lip: 'lip', bolide: 'bolide', clathrate: 'clathrate', supernova: 'supernova', aridification: 'aridification', civilization: 'civilization',
  glaciation: 'glaciation', oae: 'oae', hyperthermal: 'hyperthermal', extinction: 'extinction',
};
const CAUSE_OF: Record<Cause, CauseId> = {
  lip: 'lip', bolide: 'bolide', clathrate: 'clathrate', supernova: 'supernova', civilization: 'civilization', tectonic: 'tectonic',
  unknown_natural: 'unknown_natural', terraform: 'civilization', probe: 'civilization',
};

/** How much a field geologist should be blamed for missing this event if its rocks are there, 0..1. */
export function significance(e: TruthEvent): number {
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  switch (e.type) {
    case 'bolide': return clamp((e.magnitude - 2) / 3); //          diameter, km: small ones leave a mm of clay
    case 'supernova': return 0.3; //                                a trace of 60Fe
    case 'aridification': return 0.7;
    case 'oae': return e.magnitude > 0.35 ? 0.8 : 0.4;
    case 'extinction': return clamp(e.magnitude / 0.2); //          fraction of species lost
    case 'hyperthermal': return 0.8;
    default: return 1; //                                           lip, clathrate, glaciation, civilization
  }
}

/** Where was the event deposited, is it still there, and how much of it was destroyed? */
export function auditEvents(world: World): EventAudit[] {
  const { strat, plan, catalog } = world;
  const N = strat.nx * strat.ny;
  const preserved = new Array<number>(catalog.length).fill(0);
  const deposited = new Array<number>(catalog.length).fill(0);
  const erased = new Array<number>(catalog.length).fill(0);
  const sigma = 0.02; // Myr of slack for layer-age uncertainty on top of each layer's own spread

  for (const col of strat.columns) {
    for (let k = 0; k < catalog.length; k++) {
      const [t0, t1] = catalog[k].ageMa;
      for (let l = 0; l < col.n; l++) {
        const a = col.ageMean[l], s = col.ageSigma[l] + sigma;
        if (a + s >= t1 && a - s <= t0) { preserved[k]++; break; }
      }
    }
  }
  if (strat.envHistory) {
    for (let k = 0; k < catalog.length; k++) {
      const [t0, t1] = catalog[k].ageMa;
      const s0 = stepAtAge(plan, t0), s1 = stepAtAge(plan, t1);
      for (let c = 0; c < N; c++) {
        for (let s = s0; s <= s1; s++) if (strat.envHistory[s * N + c] !== NO_DEPOSIT) { deposited[k]++; break; }
      }
    }
  }
  // Erosion episodes span a range of rock ages; credit each event with its share of the thickness removed.
  const log = strat.erased;
  const pad = 0.02;
  for (let i = 0; i < log.n; i++) {
    const old = log.ageOldMa[i], young = log.ageYoungMa[i], span = Math.max(old - young, 1e-6);
    for (let k = 0; k < catalog.length; k++) {
      const [t0, t1] = catalog[k].ageMa;
      const overlap = Math.min(old, t0 + pad) - Math.max(young, t1 - pad);
      if (overlap > 0) erased[k] += log.thickness[i] * Math.min(1, overlap / span);
    }
  }
  return catalog.map((e, k) => {
    const det = Math.min(1, preserved[k] / (DETECTABLE_CELL_SHARE * N));
    const sig = significance(e);
    return { depositedCells: deposited[k], preservedCells: preserved[k], erasedThicknessM: erased[k], detectability: det, significance: sig, weight: sig * det, matchedBy: null };
  });
}

export function scoreTargets(world: World, audits: EventAudit[]): ScoreTarget[] {
  return world.catalog.map((e, k) => ({
    id: e.id, type: SUBMISSION_OF[e.type] ?? 'other', ageMa: e.ageMa, cause: CAUSE_OF[e.cause], weight: audits[k].weight,
  }));
}

function idealReport(world: World, solv: Solvability | null): IdealReport | null {
  if (!solv) return null;
  const a = solv.assessment;
  const present = world.agents.length > 0;
  return {
    pCivilization: a.pCivilization, headlineBits: binaryBits(a.pCivilization, present), solvable: a.solvable, murky: solv.murky, attempts: solv.attempts,
    events: a.events.map((e) => {
      const entries = Object.entries(e.informed) as [string, number][];
      const top = entries.reduce((x, y) => (y[1] > x[1] ? y : x), entries[0]);
      return { eventId: e.eventId, type: e.type, trueClass: e.trueClass, pTrue: e.informed[e.trueClass], top: top[0], pTop: top[1] };
    }),
  };
}

const CURVE_POINTS = 300;
function curves(world: World): RevealPayload['curves'] {
  const { plan, earth, bio } = world;
  const D = world.config.durationMyr;
  const defs: { id: string; label: string; unit: string; get: (s: number) => number; agg: 'mean' | 'max' }[] = [
    { id: 'd13C', label: 'δ¹³C carbonate', unit: '‰', get: (s) => earth.mean.d13C_carb[s], agg: 'mean' },
    { id: 'temp', label: 'global temperature', unit: '°C', get: (s) => earth.mean.tempC[s], agg: 'mean' },
    { id: 'ice', label: 'ice volume', unit: '0..1', get: (s) => earth.mean.ice[s], agg: 'mean' },
    { id: 'anoxic', label: 'anoxic burial', unit: '0..1', get: (s) => earth.mean.anoxic[s], agg: 'mean' },
    { id: 'o2', label: 'atmospheric O₂', unit: 'frac.', get: (s) => earth.mean.O2atm[s], agg: 'mean' },
    { id: 'extinction', label: 'species lost per step', unit: 'fraction', get: (s) => bio.deaths[s] / Math.max(1, bio.living[s] + bio.deaths[s]), agg: 'max' },
    { id: 'diversity', label: 'living species', unit: 'count', get: (s) => bio.living[s], agg: 'mean' },
  ];
  const ageMa = Array.from({ length: CURVE_POINTS }, (_, i) => ((i + 0.5) / CURVE_POINTS) * D);
  const series: RevealSeries[] = defs.map((d) => {
    const sum = new Float64Array(CURVE_POINTS), w = new Float64Array(CURVE_POINTS), mx = new Float64Array(CURVE_POINTS).fill(-Infinity);
    for (let s = 0; s < plan.n; s++) {
      const mid = 0.5 * (plan.ageBaseMa[s] + plan.ageTopMa[s]);
      const b = Math.min(CURVE_POINTS - 1, Math.floor((mid / D) * CURVE_POINTS));
      const dt = plan.dtYr[s], v = d.get(s);
      sum[b] += v * dt; w[b] += dt; mx[b] = Math.max(mx[b], v);
    }
    const values: number[] = [];
    let last = 0;
    for (let b = 0; b < CURVE_POINTS; b++) {
      if (w[b] > 0) last = d.agg === 'mean' ? sum[b] / w[b] : mx[b];
      values.push(+last.toPrecision(5));
    }
    return { id: d.id, label: d.label, unit: d.unit, values };
  });
  return { ageMa, series };
}

function erasedByAge(world: World): RevealPayload['erasedByAge'] {
  const log = world.strat.erased, D = world.config.durationMyr, bins = 100;
  const thick = new Array<number>(bins).fill(0);
  for (let i = 0; i < log.n; i++) {
    const a = 0.5 * (log.ageOldMa[i] + log.ageYoungMa[i]);
    thick[Math.min(bins - 1, Math.max(0, Math.floor((a / D) * bins)))] += log.thickness[i];
  }
  return { ageMa: thick.map((_, i) => ((i + 0.5) / bins) * D), thicknessM: thick.map((t) => +t.toFixed(2)) };
}

/** Score the submission and open the books. */
export function scoreAndReveal(world: World, solv: Solvability | null, submission: Submission): { score: ScoreReport; reveal: RevealPayload } {
  const audits = auditEvents(world);
  const targets = scoreTargets(world, audits);
  const present = world.agents.length > 0;
  const score = scoreSubmission(submission, targets, present);
  for (const m of score.matches) {
    const k = world.catalog.findIndex((e) => e.id === m.truthId);
    if (k >= 0) audits[k].matchedBy = m.submittedId;
  }
  const events: RevealEvent[] = world.catalog.map((e, k) => ({
    id: e.id, type: e.type, cls: e.cls, ageMa: e.ageMa, magnitude: e.magnitude, cause: e.cause, parents: e.parents, params: e.params, audit: audits[k],
  }));
  const civ = world.catalog.find((e) => e.type === 'civilization');
  return {
    score,
    reveal: {
      seed: world.config.seed, modelVersion: MODEL_VERSION, worldHash: worldHash(world), durationMyr: world.config.durationMyr,
      cells: world.strat.nx * world.strat.ny,
      civilization: { present, params: civ?.params ?? null, ageMa: civ?.ageMa ?? null },
      events, curves: curves(world), erasedByAge: erasedByAge(world), ideal: idealReport(world, solv),
    },
  };
}
