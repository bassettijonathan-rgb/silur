/**
 * The Earth-system box model: carbon cycle + alkalinity + phosphorus + oxygen + carbon isotopes +
 * two-layer climate + ice sheets + eustatic sea level.
 *
 *   atmosphere  <--gas exchange-->  surface ocean  <--mixing, biological pump-->  deep ocean
 *        ^  |                           ^   |                                         |
 *  volcanoes weathering (rivers) ------+   +-- shelf carbonate burial               +-- pelagic carbonate & organic burial
 *
 * Every flux is written out in one place (`fluxes`) so you can read the physics top to bottom. The same
 * function feeds the ODE right-hand side and the diagnostics, so what you plot is what the model used.
 *
 * Bookkeeping conventions (see shared/units.ts):
 *   - Carbon and alkalinity fluxes are in Pg C yr-1 ("C-equivalents"; 1 mol Ca2+ = 1 mol C = 2 eq).
 *   - Ocean tracers are concentrations in µmol/kg; PGC_PER_UMOL converts (µmol/kg · kg/yr) to Pg C/yr.
 *   - Isotopes are tracked as δ values of each pool. For a pool of mass M and composition δ:
 *         M dδ/dt = Σ_inflows J (δ_in − δ)   (outflows at the pool's own δ drop out)
 *     and outflows that fractionate (organic burial, carbonate formation) add an explicit ε term.
 *
 * Process cheat-sheet (the sign conventions that matter):
 *   silicate weathering  Fsil : atmosphere −2·Fsil, ocean DIC +2·Fsil, ALK +2·Fsil   (Ca-moles; = V at steady state)
 *   carbonate weathering Fc   : atmosphere −Fc,     ocean DIC +2·Fc,   ALK +2·Fc     (+Fc rock carbon in total)
 *   carbonate burial     Bc   : ocean DIC −Bc, ALK −2·Bc                              (steady state: Bc = Fsil + Fc)
 *   organic burial       Bo   : ocean DIC −Bo, atmospheric O2 +Bo                      (steady state: Bo = Wo)
 */

import { Forcing, zeroForcing } from '../../shared/forcing';
import {
  ABSORBED_SOLAR,
  ATM_O2_MOL,
  CO2_FORCING_COEF,
  KELVIN,
  MOL_PER_PGC,
  PGC_PER_PPM,
  PGC_PER_UMOL,
  clamp,
  logistic,
} from '../../shared/units';
import { CarbonateState, d18OCalcite, newCarbonateState, solveCarbonate } from './carbonate';
import { PlanetParams } from './planet';

// ---------------------------------------------------------------------------------------------
// State vector layout
// ---------------------------------------------------------------------------------------------

export const IDX = {
  A: 0, // atmospheric carbon, Pg C
  DICs: 1, // surface-ocean DIC, µmol/kg
  ALKs: 2, // surface-ocean alkalinity, µmol/kg
  DICd: 3, // deep-ocean DIC
  ALKd: 4, // deep-ocean alkalinity
  P: 5, // ocean phosphate, µmol/kg
  O2d: 6, // deep-ocean O2, µmol/kg (negative = sulfide / "oxygen debt")
  O2a: 7, // atmospheric O2 relative to reference
  Morg: 8, // crustal organic carbon, Pg C
  dA: 9, // δ13C of atmospheric CO2, ‰
  dS: 10, // δ13C of surface DIC
  dD: 11, // δ13C of deep DIC
  Ts: 12, // surface temperature anomaly, K
  Td: 13, // deep-ocean temperature anomaly, K
  Ice: 14, // ice-sheet volume, 0..1
} as const;
export const N_STATE = 15;

/** Per-component absolute tolerances for the integrator (units of the state). */
export const ATOL = (() => {
  const a = new Float64Array(N_STATE);
  a[IDX.A] = 0.5; a[IDX.DICs] = 0.5; a[IDX.ALKs] = 0.5; a[IDX.DICd] = 0.5; a[IDX.ALKd] = 0.5;
  a[IDX.P] = 0.002; a[IDX.O2d] = 0.2; a[IDX.O2a] = 1e-5; a[IDX.Morg] = 2e3;
  a[IDX.dA] = 0.003; a[IDX.dS] = 0.003; a[IDX.dD] = 0.003;
  a[IDX.Ts] = 0.003; a[IDX.Td] = 0.003; a[IDX.Ice] = 2e-4;
  return a;
})();

// ---------------------------------------------------------------------------------------------
// Calibrated normalisations and per-step context
// ---------------------------------------------------------------------------------------------

/** Quantities fixed by `calibrate()` so that the reference state is an exact steady state. */
export interface BaseState {
  /** Deep carbonate ion at the reference state, µmol/kg (defines where the CCD sits). */
  co3d0: number;
  /** Surface-ocean calcite Ω at the reference state. */
  omegaCal0: number;
  /** Shelf carbonate burial coefficient, Pg C yr-1 per (Ω−1)^n at reference shelf area. */
  kShelf: number;
  /** Organic burial efficiency in oxic conditions (fraction of export that is buried). */
  epsOx: number;
  /** Fe/Ca-bound P burial coefficient, mol P yr-1 per µmol/kg. */
  kFe: number;
}

/** Everything that is constant within one plan step. */
export interface StepContext {
  volcanic: number;
  uplift: number;
  polarLand: number;
  tectonicSeaLevel: number;
  solarForcing: number;
  forcing: Forcing;
}

export function neutralContext(): StepContext {
  return { volcanic: 1, uplift: 1, polarLand: 0, tectonicSeaLevel: 0, solarForcing: 0, forcing: zeroForcing() };
}

// ---------------------------------------------------------------------------------------------
// Diagnostics (everything the rest of the game can "see" of the Earth system)
// ---------------------------------------------------------------------------------------------

export const DIAG_NAMES = [
  'pCO2', // atmospheric CO2, ppm
  'tempC', // global surface temperature, °C
  'dT', // warming relative to reference, K
  'pH', // surface-ocean pH
  'omegaCal', // surface calcite saturation
  'omegaArag', // surface aragonite saturation
  'omegaCalDeep', // deep calcite saturation (surface-pressure basis)
  'ccd', // carbonate compensation depth, m
  'd13C_dic', // δ13C of surface DIC
  'd13C_carb', // δ13C of shelf carbonate
  'd13C_org', // δ13C of organic matter
  'd13C_atm', // δ13C of atmospheric CO2
  'd13C_deep', // δ13C of deep DIC
  'd18O_sw', // δ18O of seawater, ‰
  'd18O_carb', // δ18O of carbonate precipitated at global surface temperature
  'ice', // ice-sheet volume 0..1
  'seaLevel', // eustatic sea level, m relative to reference
  'shelfArea', // flooded shelf area relative to reference
  'O2deep', // deep-ocean O2, µmol/kg
  'anoxic', // fraction of anoxic burial conditions 0..1
  'euxinia', // 0..1
  'O2atm', // atmospheric O2 mole fraction
  'fire', // wildfire index (0 none, 1 modern, up to 3)
  'd15N', // sedimentary δ15N, ‰
  'export', // organic export production, Pg C/yr
  'orgBurial', // Pg C/yr
  'carbBurial', // Pg C/yr (shelf + pelagic)
  'silWeath', // Pg C/yr
  'PO4', // µmol/kg
  'DICs', 'ALKs', 'DICd', 'ALKd',
  'totalC', // atmosphere + ocean carbon, Pg C
] as const;
export type DiagName = (typeof DIAG_NAMES)[number];
export const DIAG: { readonly [K in DiagName]: number } = Object.fromEntries(
  DIAG_NAMES.map((n, i) => [n, i]),
) as { [K in DiagName]: number };

/** Wildfire index vs atmospheric O2 mole fraction (Belcher & McElwain 2008-style fire window). */
export function fireIndex(o2frac: number): number {
  if (o2frac <= 0.15) return 0;
  if (o2frac <= 0.21) return (o2frac - 0.15) / 0.06;
  return 1 + ((o2frac - 0.21) / 0.09) * 2;
}

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

interface Fx {
  A: number; pCO2a: number; co2Rel: number;
  pCO2s: number; omCal: number; omAr: number; co3d: number; omCalD: number;
  sl: number; aRel: number; ice: number;
  Fsil: number; Fc: number; Wo: number; V: number; E: number;
  prodRel: number; Pexp: number; anox: number; BoM: number; Bt: number; Bo: number; Rc: number; ccd: number; Bpel: number; Bsh: number;
  Fgas: number; nuEff: number; mixDIC: number; mixALK: number; acid: number;
  epsP: number;
}

export class EarthModel {
  readonly planet: PlanetParams;
  base: BaseState;
  ctx: StepContext = neutralContext();
  /** When true the crustal organic reservoir and atmospheric O2 are held fixed (used by spin-up). */
  freezeSlow = false;

  private readonly Ms: number;
  private readonly Md: number;
  private readonly cS: number; // Pg C per (µmol/kg) of the surface box
  private readonly cD: number;
  private readonly csS: CarbonateState = newCarbonateState();
  private readonly csD: CarbonateState = newCarbonateState();
  private readonly fx: Fx = {} as Fx;

  constructor(planet: PlanetParams, base: BaseState) {
    this.planet = planet;
    this.base = base;
    this.Ms = planet.surfFrac * planet.oceanMassKg;
    this.Md = (1 - planet.surfFrac) * planet.oceanMassKg;
    this.cS = this.Ms * PGC_PER_UMOL;
    this.cD = this.Md * PGC_PER_UMOL;
  }

  /** All fluxes for state y under the current context. Results land in this.fx. */
  private fluxes(y: Float64Array): Fx {
    const p = this.planet;
    const b = this.base;
    const c = this.ctx;
    const f = c.forcing;
    const x = this.fx;
    const closed = p.closedSystem;

    // ---- atmosphere / chemistry
    const A = Math.max(y[IDX.A], 1e-3);
    x.A = A;
    x.pCO2a = A / PGC_PER_PPM;
    x.co2Rel = x.pCO2a / p.pCO2Ref;
    const Ts = y[IDX.Ts];
    const Td = y[IDX.Td];
    solveCarbonate(y[IDX.DICs], y[IDX.ALKs], p.tBaseC + Ts + KELVIN, p.salinity, p.caMolKg, this.csS, 0);
    solveCarbonate(y[IDX.DICd], y[IDX.ALKd], p.tDeepBaseC + Td + KELVIN, p.salinity, p.caMolKg, this.csD, 1);
    x.pCO2s = this.csS.pCO2;
    x.omCal = this.csS.omegaCalcite;
    x.omAr = this.csS.omegaAragonite;
    x.co3d = Math.max(this.csD.CO3, 1);
    x.omCalD = this.csD.omegaCalcite;

    // ---- ice, sea level, shelf area
    const ice = clamp(y[IDX.Ice], 0, 1);
    x.ice = ice;
    x.sl = c.tectonicSeaLevel - p.iceSeaLevelM * ice + p.stericMPerK * Ts;
    x.aRel = Math.exp(0.006 * x.sl); // 100 m of sea level ≈ ±80 % flooded shelf area

    // ---- weathering and degassing (reference: V = Fsil, Bo = Wo)
    const U = c.uplift;
    x.V = closed ? 0 : p.volc0 * c.volcanic;
    x.Fsil = closed ? 0 : p.volc0 * U * Math.exp(Ts / p.tauSilK) * Math.pow(x.co2Rel, p.betaCO2);
    x.Fc = closed ? 0 : p.carbW0 * Math.sqrt(U) * Math.exp(Ts / p.tauCarbK);
    x.Wo = closed ? 0 : p.orgW0 * (y[IDX.Morg] / p.morg0) * Math.pow(Math.max(y[IDX.O2a], 0.05), p.o2WeatherExp);
    x.E = f.carbonEmission;

    // ---- biological pump, organic burial
    // Productivity responds to phosphate but saturates (nitrogen/light limitation): 1 at reference, <2 always.
    const pRel = Math.max(y[IDX.P], 0) / p.pRef;
    x.prodRel = (2 * pRel) / (1 + pRel);
    x.Pexp = p.exportOrg0 * x.prodRel;
    x.anox = 1 / (1 + Math.exp((y[IDX.O2d] - p.o2Crit) / p.o2Width));
    x.BoM = closed ? 0 : x.Pexp * b.epsOx * (1 + (p.anoxicBurialGain - 1) * x.anox); // marine
    // Terrestrial organic burial: scales with sediment supply, suppressed by wildfire in an O2-rich atmosphere.
    const fire = fireIndex(0.21 * Math.max(y[IDX.O2a], 0.05));
    x.Bt = closed ? 0 : p.terrBurialFrac * p.orgW0 * Math.sqrt(U) * clamp(1 / Math.max(fire, 0.05), 0.1, 4);
    x.Bo = x.BoM + x.Bt;

    // ---- carbonate production and burial
    const satFac = clamp((x.omCal - 1) / (b.omegaCal0 - 1), 0, 1.5);
    x.Rc = p.rainCarb0 * Math.sqrt(x.prodRel) * Math.pow(satFac, 0.3);
    x.ccd = p.ccd0 + Math.log(x.co3d / b.co3d0) / p.ccdKappa;
    const fracAboveCcd = 1 / (1 + Math.exp(-(x.ccd - p.hypsZ0) / p.hypsW));
    x.Bpel = closed ? 0 : x.Rc * p.pelagicBurialMax * fracAboveCcd;
    x.Bsh = closed ? 0 : b.kShelf * x.aRel * Math.pow(Math.max(x.omCal - 1, 0), p.shelfExponent);

    // ---- air–sea exchange, ocean mixing
    x.Fgas = p.gasExchange * (x.pCO2a - x.pCO2s);
    x.nuEff = p.mixKgYr * clamp(1 - p.stratPerK * Ts, 0.2, 1.5);
    x.mixDIC = x.nuEff * (y[IDX.DICd] - y[IDX.DICs]) * PGC_PER_UMOL;
    x.mixALK = x.nuEff * (y[IDX.ALKd] - y[IDX.ALKs]) * PGC_PER_UMOL;
    // Acid delivered to the surface ocean: direct pulse + sulfuric acid from SO2 (2 eq per S; 0.749 Pg C-eq per Pg S)
    x.acid = f.acidPulse + 0.749 * f.sulfurEmission;

    x.epsP = p.epsP0 + p.epsPPerDoubling * Math.log2(Math.max(x.co2Rel, 1e-3));
    return x;
  }

  /** ODE right-hand side. */
  rhs = (y: Float64Array, d: Float64Array): void => {
    const p = this.planet;
    const b = this.base;
    const c = this.ctx;
    const f = c.forcing;
    const x = this.fluxes(y);
    const Ts = y[IDX.Ts];
    const Td = y[IDX.Td];
    const cS = this.cS;
    const cD = this.cD;

    // ---- carbon and alkalinity
    d[IDX.A] = x.V + x.Wo + x.E - 2 * x.Fsil - x.Fc - x.Fgas - x.Bt;
    d[IDX.DICs] = (x.Fgas + 2 * x.Fsil + 2 * x.Fc + x.mixDIC - x.Pexp - x.Rc - x.Bsh) / cS;
    d[IDX.ALKs] = (2 * x.Fsil + 2 * x.Fc - 2 * x.Rc - 2 * x.Bsh + x.mixALK - x.acid) / cS;
    d[IDX.DICd] = (-x.mixDIC + (x.Pexp - x.BoM) + (x.Rc - x.Bpel)) / cD;
    d[IDX.ALKd] = (-x.mixALK + 2 * (x.Rc - x.Bpel)) / cD;

    // ---- phosphorus (mol yr-1 -> µmol/kg/yr)
    const cp = p.cpOxic + (p.cpAnoxic - p.cpOxic) * x.anox;
    const Priv = p.closedSystem ? 0 : p.pRiv0 * ((x.Fsil + x.Fc) / (p.volc0 + p.carbW0)) * (1 + f.nutrientRunoff);
    const PbOrg = (x.BoM * MOL_PER_PGC) / cp;
    const PbFe = p.closedSystem ? 0 : b.kFe * Math.max(y[IDX.P], 0) * (1 - p.fePReduction * x.anox);
    d[IDX.P] = (Priv - PbOrg - PbFe) / (p.oceanMassKg * 1e-6);

    // ---- oxygen
    const o2rel = Math.max(y[IDX.O2a], 0.05);
    const o2sat = Math.max(p.o2Sat0 * o2rel * (1 - p.o2SatPerK * Ts), 0);
    const respUmol = p.respRatio * (x.Pexp - x.BoM) * MOL_PER_PGC * 1e6; // µmol O2 / yr
    d[IDX.O2d] = (x.nuEff * (o2sat - y[IDX.O2d]) - respUmol) / this.Md;
    if (this.freezeSlow) {
      d[IDX.O2a] = 0;
      d[IDX.Morg] = 0;
    } else {
      d[IDX.O2a] = ((x.Bo - x.Wo) * MOL_PER_PGC) / ATM_O2_MOL;
      d[IDX.Morg] = x.Bo - x.Wo;
    }

    // ---- carbon isotopes
    const da = y[IDX.dA];
    const ds = y[IDX.dS];
    const dd = y[IDX.dD];
    const Jx = p.isoExchange;
    const ingas = Math.max(x.Fgas, 0);
    const outgas = Math.max(-x.Fgas, 0);
    const exch = Jx * (ds - p.epsAtm - da); // Pg·‰/yr moved into the atmosphere by isotopic equilibration
    d[IDX.dA] =
      (x.V * (p.d13CVolc - da) + x.Wo * (p.d13COrgW - da) + x.E * (f.d13CofEmission - da) + exch +
        outgas * (ds - p.epsAtm - da) + x.Bt * p.epsTerr) / x.A;
    const Ms = Math.max(y[IDX.DICs], 1) * cS;
    d[IDX.dS] =
      (ingas * (da - ds) + 2 * x.Fsil * (da - ds) + 2 * x.Fc * (0.5 * (p.d13CCarbW + da) - ds) +
        x.nuEff * PGC_PER_UMOL * y[IDX.DICd] * (dd - ds) +
        x.Pexp * x.epsP - (x.Rc + x.Bsh) * p.epsCalcite + outgas * p.epsAtm - exch) / Ms;
    const Mdp = Math.max(y[IDX.DICd], 1) * cD;
    d[IDX.dD] =
      (x.nuEff * PGC_PER_UMOL * y[IDX.DICs] * (ds - dd) + (x.Pexp - x.BoM) * (ds - x.epsP - dd) +
        (x.Rc - x.Bpel) * (ds + p.epsCalcite - dd)) / Mdp;

    // ---- climate: two-layer energy balance
    const forcingW =
      CO2_FORCING_COEF * Math.log(Math.max(x.co2Rel, 1e-3)) +
      c.solarForcing -
      p.iceAlbedoForcing * x.ice -
      ABSORBED_SOLAR * f.lightReduction -
      25 * f.aerosolOpticalDepth;
    const lambda = (CO2_FORCING_COEF * Math.LN2) / p.ecs;
    d[IDX.Ts] = (forcingW - lambda * Ts - p.heatExchange * (Ts - Td)) / p.heatCapSurf;
    d[IDX.Td] = (p.heatExchange * (Ts - Td)) / p.heatCapDeep;

    // ---- ice sheets with hysteresis (ice makes the local climate colder, so it persists past its onset)
    const tGlob = p.tBaseC + Ts;
    const tCrit = p.iceTempNoPolar + p.iceTempPolarBonus * c.polarLand;
    const iceEq = logistic((tCrit - tGlob + p.iceHysteresisK * x.ice) / p.iceWidthK);
    d[IDX.Ice] = (iceEq - x.ice) / (iceEq > x.ice ? p.iceGrowTauYr : p.iceMeltTauYr);
  };

  /** Fill `out` (length DIAG_NAMES.length) with diagnostics for state y. */
  diagnose(y: Float64Array, out: Float64Array): void {
    const p = this.planet;
    const x = this.fluxes(y);
    const Ts = y[IDX.Ts];
    const tempC = p.tBaseC + Ts;
    const d18Osw = p.d18OSw0 + p.iceD18O * x.ice;
    const o2frac = 0.21 * y[IDX.O2a];
    const o2d = y[IDX.O2d];
    const sub = logistic((60 - o2d) / 25);
    const nfix = logistic((8 - o2d) / 6);

    out[DIAG.pCO2] = x.pCO2a;
    out[DIAG.tempC] = tempC;
    out[DIAG.dT] = Ts;
    out[DIAG.pH] = this.csS.pH;
    out[DIAG.omegaCal] = x.omCal;
    out[DIAG.omegaArag] = x.omAr;
    out[DIAG.omegaCalDeep] = x.omCalD;
    out[DIAG.ccd] = x.ccd;
    out[DIAG.d13C_dic] = y[IDX.dS];
    out[DIAG.d13C_carb] = y[IDX.dS] + p.epsCalcite;
    out[DIAG.d13C_org] = y[IDX.dS] - x.epsP;
    out[DIAG.d13C_atm] = y[IDX.dA];
    out[DIAG.d13C_deep] = y[IDX.dD];
    out[DIAG.d18O_sw] = d18Osw;
    out[DIAG.d18O_carb] = d18OCalcite(tempC, d18Osw);
    out[DIAG.ice] = x.ice;
    out[DIAG.seaLevel] = x.sl;
    out[DIAG.shelfArea] = x.aRel;
    out[DIAG.O2deep] = o2d;
    out[DIAG.anoxic] = x.anox;
    out[DIAG.euxinia] = logistic(-o2d / 15);
    out[DIAG.O2atm] = o2frac;
    out[DIAG.fire] = fireIndex(o2frac);
    // Sedimentary δ15N: denitrification in suboxic water raises it, N2 fixation under strong anoxia lowers it.
    // The *sign* of the shift therefore depends on how anoxic the ocean gets (design D10).
    out[DIAG.d15N] = 5 + 4 * sub - 8 * nfix;
    out[DIAG.export] = x.Pexp;
    out[DIAG.orgBurial] = x.Bo;
    out[DIAG.carbBurial] = x.Bsh + x.Bpel;
    out[DIAG.silWeath] = x.Fsil;
    out[DIAG.PO4] = y[IDX.P];
    out[DIAG.DICs] = y[IDX.DICs];
    out[DIAG.ALKs] = y[IDX.ALKs];
    out[DIAG.DICd] = y[IDX.DICd];
    out[DIAG.ALKd] = y[IDX.ALKd];
    out[DIAG.totalC] = y[IDX.A] + y[IDX.DICs] * this.cS + y[IDX.DICd] * this.cD;
  }

  /** Total carbon in atmosphere + ocean, Pg C (conserved in a closed system with no emissions). */
  totalCarbon(y: Float64Array): number {
    return y[IDX.A] + y[IDX.DICs] * this.cS + y[IDX.DICd] * this.cD;
  }

  /** Total alkalinity in the ocean, Pg C-equivalents. */
  totalAlkalinity(y: Float64Array): number {
    return y[IDX.ALKs] * this.cS + y[IDX.ALKd] * this.cD;
  }

  /** Carbon-weighted mean δ13C of the atmosphere + ocean, ‰. */
  meanD13C(y: Float64Array): number {
    const mA = y[IDX.A];
    const mS = y[IDX.DICs] * this.cS;
    const mD = y[IDX.DICd] * this.cD;
    return (mA * y[IDX.dA] + mS * y[IDX.dS] + mD * y[IDX.dD]) / (mA + mS + mD);
  }

  /** Pg C per (µmol/kg) of the surface and deep boxes (for tests). */
  snapshotMassFactors(): { cS: number; cD: number } {
    return { cS: this.cS, cD: this.cD };
  }

  /** Expose reference-state flux bookkeeping for tests and calibration. */
  snapshotFluxes(y: Float64Array): Readonly<Fx> {
    return { ...this.fluxes(y) };
  }
}
