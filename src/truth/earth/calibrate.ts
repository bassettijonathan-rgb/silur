/**
 * Baseline calibration.
 *
 * We want a planet whose *reference state* is an exact steady state: with no external forcing, constant
 * drivers and pCO2 = pCO2Ref, every budget (carbon, alkalinity, phosphorus, oxygen, isotopes) closes and
 * nothing drifts. Rather than hand-tune dozens of constants, we:
 *
 *   1. build the surface-ocean chemistry analytically from (pCO2Ref, omegaSurf0, T) — closed form;
 *   2. set the shelf-carbonate coefficient so that carbonate burial balances Fsil + Fc exactly at that Ω;
 *   3. spin the full model up (with the slowest reservoirs frozen) to relax deep ocean, P, O2 and isotopes;
 *   4. re-normalise the CCD reference and the organic-burial efficiency to the spun-up state and repeat.
 *
 * The loop converges in a handful of iterations. Calibration costs ~tens of milliseconds.
 */

import { KELVIN, MOL_PER_PGC, PGC_PER_PPM } from '../../shared/units';
import { stateFromPco2AndOmega } from './carbonate';
import { ATOL, BaseState, EarthModel, IDX, N_STATE, neutralContext } from './model';
import { PlanetParams } from './planet';
import { Rosenbrock2 } from './ode';

export interface Calibrated {
  planet: PlanetParams;
  base: BaseState;
  /** Reference steady state. */
  y0: Float64Array;
}

const SPINUP_YR = 8e6;

/** Integrate `model` for `years` with the given state, in place. */
export function relax(model: EarthModel, y: Float64Array, years: number, rtol = 1e-6): void {
  const ode = new Rosenbrock2(N_STATE, model.rhs);
  ode.integrate(y, years, { rtol, atol: ATOL, hInit: 10, hMax: years / 4 });
}

export function calibrate(planet: PlanetParams): Calibrated {
  const tK = planet.tBaseC + KELVIN;
  const surf = stateFromPco2AndOmega(planet.pCO2Ref, planet.omegaSurf0, tK, planet.salinity, planet.caMolKg);

  const y = new Float64Array(N_STATE);
  y[IDX.A] = planet.pCO2Ref * PGC_PER_PPM;
  y[IDX.DICs] = surf.dicUmol;
  y[IDX.ALKs] = surf.alkUmol;
  y[IDX.DICd] = surf.dicUmol + 220;
  y[IDX.ALKd] = surf.alkUmol + 110;
  y[IDX.P] = planet.pRef;
  y[IDX.O2d] = 120;
  y[IDX.O2a] = 1;
  y[IDX.Morg] = planet.morg0;
  y[IDX.dS] = 1.5;
  y[IDX.dA] = y[IDX.dS] - planet.epsAtm;
  y[IDX.dD] = 0.5;

  // Initial guesses for the normalisations.
  const a0 = 0.01;
  const boM0 = planet.orgW0 * (1 - planet.terrBurialFrac); // marine share of reference organic burial
  const base: BaseState = {
    co3d0: 100,
    omegaCal0: planet.omegaSurf0,
    kShelf: 0,
    epsOx: boM0 / (planet.exportOrg0 * (1 + (planet.anoxicBurialGain - 1) * a0)),
    kFe: (planet.pRiv0 - (boM0 * MOL_PER_PGC) / planet.cpOxic) / (planet.pRef * (1 - planet.fePReduction * a0)),
  };

  const model = new EarthModel(planet, base);
  model.freezeSlow = true;
  model.ctx = neutralContext();

  // Pelagic burial at the reference CCD, then the shelf must supply the rest: Bsh0 = Fsil0 + Fc0 - Bpel0.
  const fracAbove0 = 1 / (1 + Math.exp(-(planet.ccd0 - planet.hypsZ0) / planet.hypsW));
  const bPel0 = planet.rainCarb0 * planet.pelagicBurialMax * fracAbove0;
  const bSh0 = planet.volc0 + planet.carbW0 - bPel0;
  if (bSh0 <= 0) throw new Error('calibrate: pelagic burial exceeds total carbonate burial; lower pelagicBurialMax');
  base.kShelf = bSh0 / Math.pow(planet.omegaSurf0 - 1, planet.shelfExponent);

  for (let iter = 0; iter < 6; iter++) {
    relax(model, y, SPINUP_YR);
    const x = model.snapshotFluxes(y);
    // Re-normalise to the spun-up state.
    base.co3d0 = x.co3d;
    base.epsOx *= boM0 / x.BoM;
  }
  // Final relaxation with the converged normalisations.
  relax(model, y, SPINUP_YR);

  return { planet, base: { ...base }, y0: y.slice() };
}
