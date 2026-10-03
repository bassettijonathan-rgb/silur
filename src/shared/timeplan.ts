/**
 * TimePlan — the non-uniform time axis shared by the whole simulation (design D3).
 *
 * Steps run from the oldest age to the present (age 0). Background steps are coarse (default 100 kyr);
 * windows around scheduled events are refined. Because the plan is fixed before anything runs, every
 * stratigraphic layer can refer to its time span by step *index*, which keeps ages exact.
 */

export interface TimeWindow {
  /** Older edge of the window, Ma before present. */
  ageStartMa: number;
  /** Younger edge, Ma before present. */
  ageEndMa: number;
  /** Step length inside the window, years. */
  dtYr: number;
  /** Small integer label (event kind) carried onto steps for debugging/plotting. */
  tag?: number;
}

export interface TimePlan {
  n: number;
  /** Age at the START (older edge) of each step, Ma. */
  ageBaseMa: Float64Array;
  /** Age at the END (younger edge) of each step, Ma. */
  ageTopMa: Float64Array;
  /** Step duration, years. */
  dtYr: Float64Array;
  /** 0 = background; otherwise the tag of the refining window. */
  tag: Uint8Array;
}

export interface TimePlanOptions {
  durationMyr: number;
  baseDtYr: number;
  windows?: TimeWindow[];
  /** Hard cap on number of steps; refined windows are coarsened if exceeded. */
  maxSteps?: number;
}

export function buildTimePlan(opts: TimePlanOptions): TimePlan {
  const maxSteps = opts.maxSteps ?? 6000;
  let windows = (opts.windows ?? []).map((w) => ({ ...w }));
  for (let attempt = 0; attempt < 30; attempt++) {
    const plan = tryBuild(opts.durationMyr, opts.baseDtYr, windows);
    if (plan.n <= maxSteps) return plan;
    // Too many steps: coarsen every window by 1.5x (never beyond the base step).
    windows = windows.map((w) => ({ ...w, dtYr: Math.min(opts.baseDtYr, w.dtYr * 1.5) }));
  }
  throw new Error(`TimePlan: cannot satisfy maxSteps=${maxSteps} (base dt too small for duration?)`);
}

function tryBuild(durationMyr: number, baseDtYr: number, windows: TimeWindow[]): TimePlan {
  // Boundaries that steps must not straddle (so refined windows start/stop exactly on a step edge).
  const bounds: number[] = [];
  for (const w of windows) {
    if (w.ageStartMa < durationMyr) bounds.push(Math.max(0, w.ageStartMa));
    if (w.ageEndMa > 0) bounds.push(Math.min(durationMyr, w.ageEndMa));
  }
  bounds.sort((a, b) => b - a); // descending (old -> young)

  const base: number[] = [];
  const top: number[] = [];
  const dts: number[] = [];
  const tags: number[] = [];

  const EPS = 1e-12; // Ma
  let age = durationMyr;
  let guard = 0;
  while (age > EPS) {
    if (++guard > 5_000_000) throw new Error('TimePlan: runaway loop');
    // Smallest dt among windows that contain this age (window is [end, start) in age).
    let dtYr = baseDtYr;
    let tag = 0;
    for (const w of windows) {
      if (age <= w.ageStartMa + EPS && age > w.ageEndMa + EPS && w.dtYr < dtYr) {
        dtYr = w.dtYr;
        tag = w.tag ?? 1;
      }
    }
    let next = age - dtYr / 1e6;
    // Do not step across a boundary.
    for (const b of bounds) {
      if (b < age - EPS && b > next) {
        next = b;
        break; // bounds are sorted descending, first hit is the nearest younger boundary
      }
    }
    if (next < EPS) next = 0;
    // Avoid leaving a sliver (< 5 % of the step) at the very end.
    if (next > 0 && next < 0.05 * dtYr / 1e6) next = 0;
    base.push(age);
    top.push(next);
    dts.push((age - next) * 1e6);
    tags.push(tag);
    age = next;
  }

  const n = base.length;
  return {
    n,
    ageBaseMa: Float64Array.from(base),
    ageTopMa: Float64Array.from(top),
    dtYr: Float64Array.from(dts),
    tag: Uint8Array.from(tags),
  };
}

/** Midpoint age of step i, Ma. */
export function stepMidAge(plan: TimePlan, i: number): number {
  return 0.5 * (plan.ageBaseMa[i] + plan.ageTopMa[i]);
}

/** Index of the step whose interval contains `ageMa` (clamped to the plan). Steps run old → young. */
export function stepAtAge(plan: TimePlan, ageMa: number): number {
  let lo = 0, hi = plan.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (plan.ageTopMa[mid] > ageMa) lo = mid + 1; // step ends (is younger edge) still older than ageMa
    else hi = mid;
  }
  return lo;
}
