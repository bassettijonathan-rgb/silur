/**
 * Slow external drivers of the Earth system, sampled once per plan step.
 *
 * These are the "geological" boundary conditions that the carbon-cycle box model does not generate on
 * its own: how fast the solid Earth degasses, how fast mountains are uplifted (weathering supply), how
 * much continent sits at the poles, the volume of the ocean basins, and how bright the star is.
 * Each is a mean-reverting random walk (Ornstein–Uhlenbeck process) with a plausible correlation time,
 * discretised exactly so that irregular plan steps are handled correctly.
 */

import { Rng } from '../../shared/rng';
import { TimePlan } from '../../shared/timeplan';
import { ABSORBED_SOLAR, logistic } from '../../shared/units';
import { PlanetParams } from './planet';

export interface SlowDrivers {
  /** Multiplier on volcanic/metamorphic degassing (1 = reference). */
  volcanic: Float64Array;
  /** Multiplier on silicate weathering supply, uplift/lithology (1 = reference). */
  uplift: Float64Array;
  /** Fraction of the poles occupied by land (0..1); controls glaciation threshold. */
  polarLand: Float64Array;
  /** Tectonic (ocean-basin volume) eustasy, m relative to reference. */
  tectonicSeaLevel: Float64Array;
  /** Change in absorbed solar flux relative to the start of the simulation, W m-2. */
  solarForcing: Float64Array;
}

/** Exact OU update over an interval dt (same units as tau). Returns the new value. */
function ouStep(x: number, dt: number, tau: number, sigma: number, rng: Rng): number {
  const a = Math.exp(-dt / tau);
  return x * a + sigma * Math.sqrt(1 - a * a) * rng.normal();
}

function ouSeries(plan: TimePlan, tauYr: number, sigma: number, rng: Rng): Float64Array {
  const out = new Float64Array(plan.n);
  let x = sigma * rng.normal(); // stationary start
  for (let i = 0; i < plan.n; i++) {
    x = ouStep(x, plan.dtYr[i], tauYr, sigma, rng);
    out[i] = x;
  }
  return out;
}

export function generateSlowDrivers(plan: TimePlan, planet: PlanetParams, rng: Rng): SlowDrivers {
  const r = rng.fork('slow-drivers');
  const n = plan.n;
  const volcOU = ouSeries(plan, 60e6, 0.22, r.fork('volcanic'));
  const upliftOU = ouSeries(plan, 80e6, 0.25, r.fork('uplift'));
  const polarOU = ouSeries(plan, 50e6, 1.1, r.fork('polar'));
  const seaOU = ouSeries(plan, 25e6, 45, r.fork('eustasy'));

  const volcanic = new Float64Array(n);
  const uplift = new Float64Array(n);
  const polarLand = new Float64Array(n);
  const solarForcing = new Float64Array(n);
  const durationMyr = plan.ageBaseMa[0];
  for (let i = 0; i < n; i++) {
    volcanic[i] = Math.exp(volcOU[i]);
    uplift[i] = Math.exp(upliftOU[i]);
    polarLand[i] = logistic(polarOU[i]);
    const elapsedMyr = durationMyr - 0.5 * (plan.ageBaseMa[i] + plan.ageTopMa[i]);
    solarForcing[i] = ABSORBED_SOLAR * planet.brighteningPer100Myr * (elapsedMyr / 100);
  }
  return { volcanic, uplift, polarLand, tectonicSeaLevel: seaOU, solarForcing };
}

/** Constant drivers (reference values). Handy for tests and for spin-up. */
export function constantDrivers(n: number, overrides: Partial<{ volcanic: number; uplift: number; polarLand: number; tectonicSeaLevel: number; solarForcing: number }> = {}): SlowDrivers {
  const fill = (v: number) => new Float64Array(n).fill(v);
  return {
    volcanic: fill(overrides.volcanic ?? 1),
    uplift: fill(overrides.uplift ?? 1),
    polarLand: fill(overrides.polarLand ?? 0),
    tectonicSeaLevel: fill(overrides.tectonicSeaLevel ?? 0),
    solarForcing: fill(overrides.solarForcing ?? 0),
  };
}
