/**
 * Run the Earth system over a TimePlan.
 *
 * For every plan step we hold the slow drivers and the forcing fixed, integrate the ODEs across the step
 * with the adaptive stiff solver, and record the *time-averaged* diagnostics over the step (that is what
 * a layer deposited during the step would record) plus the end-of-step state.
 */

import { Forcing, ForcingProvider, noForcing } from '../../shared/forcing';
import { TimePlan } from '../../shared/timeplan';
import { Calibrated, calibrate } from './calibrate';
import { SlowDrivers } from './drivers';
import { ATOL, DIAG, DIAG_NAMES, DiagName, EarthModel, N_STATE, StepContext } from './model';
import { Rosenbrock2 } from './ode';
import { PlanetParams } from './planet';

export interface EarthRunInput {
  planet: PlanetParams;
  plan: TimePlan;
  drivers: SlowDrivers;
  forcing?: ForcingProvider;
  /** Pass a previously computed calibration to skip re-calibrating. */
  calibrated?: Calibrated;
  rtol?: number;
}

export interface EarthHistory {
  plan: TimePlan;
  /** Step-averaged diagnostics, one array of length plan.n per name. */
  mean: { [K in DiagName]: Float64Array };
  /** Forcing applied during each step (kept so downstream layers see the same channels). */
  forcing: Forcing[];
  /** State at the end of each step, n × N_STATE row-major. */
  endState: Float64Array;
  calibrated: Calibrated;
  stats: { accepted: number; rejected: number; rhsEvals: number };
}

export function runEarthSystem(input: EarthRunInput): EarthHistory {
  const { planet, plan, drivers } = input;
  const provider = input.forcing ?? noForcing;
  const calibrated = input.calibrated ?? calibrate(planet);
  const model = new EarthModel(planet, calibrated.base);
  const y = calibrated.y0.slice();
  const ode = new Rosenbrock2(N_STATE, model.rhs);
  const rtol = input.rtol ?? 1e-4;

  const n = plan.n;
  const mean = {} as { [K in DiagName]: Float64Array };
  for (const name of DIAG_NAMES) mean[name] = new Float64Array(n);
  const endState = new Float64Array(n * N_STATE);
  const forcings: Forcing[] = new Array(n);

  const nd = DIAG_NAMES.length;
  const dPrev = new Float64Array(nd);
  const dNew = new Float64Array(nd);
  const acc = new Float64Array(nd);

  const ctx: StepContext = model.ctx;
  for (let i = 0; i < n; i++) {
    ctx.volcanic = drivers.volcanic[i];
    ctx.uplift = drivers.uplift[i];
    ctx.polarLand = drivers.polarLand[i];
    ctx.tectonicSeaLevel = drivers.tectonicSeaLevel[i];
    ctx.solarForcing = drivers.solarForcing[i];
    ctx.forcing = provider(plan.ageBaseMa[i], plan.ageTopMa[i]);
    forcings[i] = ctx.forcing;

    const dt = plan.dtYr[i];
    model.diagnose(y, dPrev);
    acc.fill(0);
    ode.integrate(y, dt, { rtol, atol: ATOL, hMax: dt }, (h, ynew) => {
      model.diagnose(ynew, dNew);
      for (let k = 0; k < nd; k++) {
        acc[k] += 0.5 * (dPrev[k] + dNew[k]) * h;
        dPrev[k] = dNew[k];
      }
    });
    for (const name of DIAG_NAMES) mean[name][i] = acc[DIAG[name]] / dt;
    endState.set(y, i * N_STATE);
  }

  return { plan, mean, forcing: forcings, endState, calibrated, stats: { ...ode.stats } };
}
