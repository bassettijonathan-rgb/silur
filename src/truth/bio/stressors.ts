/**
 * Stressors: what in the environment kills what.
 *
 * 1. `computeStressors` turns the Earth-system history and the forcing channels into per-step intensity
 *    series I_s(t). Slow stressors (acidification, shelf loss) are measured against a running baseline, so
 *    only *rapid* change hurts — life adapts to slow drifts.
 * 2. `vulnerabilities` maps a species' traits to how exposed it is to each stressor (v_s).
 *
 * The extinction hazard then follows from dose: hazard = Σ v_s · I_s / τ_s (see diversify.ts), which is
 * correct for a year-long impact winter and a 100-kyr acidification alike.
 */

import { TimePlan } from '../../shared/timeplan';
import { EarthHistory } from '../earth/run';
import { BioParams } from './params';
import { HARD, NS, REALM, S, STRESSORS, TROPHIC, Traits } from './traits';

export interface StressorSeries {
  /** I[s][step], intensity ≥ 0 (dimensionless; ~1 = full strength). */
  I: Float32Array[];
  /** Global-mean surface temperature per step, °C. */
  tempC: Float32Array;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export function computeStressors(plan: TimePlan, earth: EarthHistory, baselineTauMyr: number): StressorSeries {
  const n = plan.n;
  const E = earth.mean;
  const I = STRESSORS.map(() => new Float32Array(n));
  const tempC = new Float32Array(n);
  let omRun = E.omegaArag[0];
  let areaRun = E.shelfArea[0];
  for (let s = 0; s < n; s++) {
    const f = earth.forcing[s];
    const a = 1 - Math.exp(-(plan.dtYr[s] / 1e6) / baselineTauMyr);
    omRun += a * (E.omegaArag[s] - omRun);
    areaRun += a * (E.shelfArea[s] - areaRun);
    tempC[s] = E.tempC[s];
    // acidification: fractional drop in aragonite saturation below its running baseline (25 % drop = full strength)
    I[S.acid][s] = clamp((4 * (omRun - E.omegaArag[s])) / omRun, 0, 1.5) + f.acidPulse * 50;
    I[S.anoxia][s] = clamp((E.anoxic[s] - 0.05) / 0.5, 0, 1);
    // only acute darkness (dust/soot) counts; a thin chronic volcanic aerosol veil dims the planet but is not lethal
    I[S.light][s] = clamp(f.lightReduction, 0, 1);
    I[S.uv][s] = clamp(f.ozoneLoss, 0, 1);
    I[S.fire][s] = clamp(0.02 * f.fireIgnition + 0.01 * f.soot, 0, 1);
    // loss of shelf habitat area relative to the running mean (50 % loss = full strength)
    I[S.shelf][s] = clamp((2 * (areaRun - E.shelfArea[s])) / areaRun, 0, 1.5);
    I[S.harvest][s] = clamp(f.harvestPressure, 0, 1);
    I[S.habitat][s] = clamp(f.habitatConversion, 0, 1);
    areaRun = Math.max(areaRun, 1e-6);
  }
  return { I, tempC };
}

const sigm = (x: number) => 1 / (1 + Math.exp(-x));

/** Fill `out[o .. o+NS)` with the species' vulnerability to each stressor. */
export function vulnerabilities(t: Traits, out: Float32Array, o: number): void {
  const marine = t.realm === REALM.marine;
  const land = t.realm === REALM.terrestrial;
  const fresh = t.realm === REALM.freshwater;
  const big = sigm((t.logMass - 4) / 1.5); // ≳ 50 kg
  const autotroph = t.trophic === TROPHIC.autotroph ? 1 : 0;

  // ocean acidification: calcifiers, aragonite worst; planktonic larvae suffer too
  const mineralW = [0, 0.35, 0.7, 1.0][t.mineral];
  out[o + S.acid] = marine ? mineralW * (t.hard === HARD.carbonate ? 1 : 0.3) + 0.25 * t.pelagic + 0.05 : 0.02;

  // anoxia: benthic, deep-shelf, high-metabolism marine life
  out[o + S.anoxia] = marine
    ? (t.pelagic ? 0.35 : 1) * (0.4 + 0.6 * sigm((t.depthPref - 80) / 60)) * (0.8 + 0.4 * big)
    : 0.02;

  // light loss (impact winter, volcanic winter): photosynthesisers and big endotherms; burrowers and detritivores shelter
  out[o + S.light] = clamp(
    0.1 + 0.9 * autotroph + 0.9 * t.endo * big + 0.4 * (1 - t.range) + 0.2 * (t.trophic === TROPHIC.predator ? 1 : 0) -
      0.5 * t.burrower - 0.4 * (t.trophic === TROPHIC.detritivore ? 1 : 0),
    0.03, 1.5,
  );

  // UV (ozone loss): shallow water, exposed land animals, phytoplankton
  out[o + S.uv] = clamp(
    0.1 + 0.9 * (marine && t.depthPref < 30 ? 1 : 0) + 0.5 * (land && !t.burrower ? 1 : 0) + 0.6 * autotroph - 0.6 * t.burrower,
    0.03, 1.5,
  );

  // fire: low-mobility land life
  out[o + S.fire] = land ? clamp(0.2 + 0.8 * (1 - t.range) * (1 - 0.7 * t.burrower) + 0.3 * autotroph, 0.05, 1.3) : 0;

  // loss of shelf area: shelf specialists
  out[o + S.shelf] = marine ? (t.depthPref < 200 ? 0.3 + 0.7 * (1 - t.breadth) : 0.05) : 0;

  // harvest / hunting: big land animals, island endemics, small ranges
  out[o + S.harvest] = land
    ? 0.05 + 1.0 * big + 0.8 * t.insular + 0.4 * (1 - t.range)
    : fresh ? 0.1 + 0.3 * big : 0.05 + 0.2 * big;

  // habitat conversion: land specialists, islands
  out[o + S.habitat] = land ? clamp(0.2 + 0.8 * (1 - t.breadth) + 0.5 * t.insular - 0.3 * t.burrower, 0.05, 1.5) : fresh ? 0.3 : 0;
}

export function lethalCoefficients(p: BioParams): Float64Array {
  const c = new Float64Array(NS);
  for (const id of STRESSORS) c[S[id]] = 1 / p.lethalYr[id];
  return c;
}
