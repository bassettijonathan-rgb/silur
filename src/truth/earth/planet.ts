/**
 * Planet parameters for the Earth-system model.
 *
 * Everything you might want to tweak lives here, with units and a sensible Earth-like range. The model
 * is *normalised to a reference state*: at pCO2 = pCO2Ref with no external forcing the planet sits in
 * a steady state (all carbon, alkalinity, phosphorus and oxygen budgets balance). `calibrate.ts` finds
 * that state numerically, so you can change a number here and the baseline re-closes itself.
 */

import { Rng } from '../../shared/rng';

export interface PlanetParams {
  // ---------------------------------------------------------------- reference state
  /** Baseline atmospheric CO2, ppm. Earth-like planets: 300–2500. */
  pCO2Ref: number;
  /** Baseline global-mean surface temperature at pCO2Ref, °C. */
  tBaseC: number;
  /** Baseline deep-ocean temperature, °C. */
  tDeepBaseC: number;
  /** Baseline surface-ocean calcite saturation state Ω. Sets the baseline alkalinity. */
  omegaSurf0: number;
  salinity: number;
  /** Seawater [Ca2+], mol/kg (modern 0.01028; was higher in the past). */
  caMolKg: number;

  // ---------------------------------------------------------------- climate
  /** Equilibrium climate sensitivity, K per CO2 doubling (fast feedbacks). Earth: 2–4.5. */
  ecs: number;
  /** Surface-layer heat capacity, W yr m-2 K-1. */
  heatCapSurf: number;
  /** Deep-ocean heat capacity, W yr m-2 K-1. */
  heatCapDeep: number;
  /** Surface <-> deep ocean heat exchange, W m-2 K-1. */
  heatExchange: number;
  /** Stellar brightening, fractional luminosity increase per 100 Myr (Sun: ~0.0035–0.007). */
  brighteningPer100Myr: number;

  // ---------------------------------------------------------------- ice
  /** Temperature (°C) below which ice sheets grow if there is no polar land (polarLand = 0). */
  iceTempNoPolar: number;
  /** Extra threshold temperature (°C) when polar land = 1 (continents on the pole help glaciation). */
  iceTempPolarBonus: number;
  /** Hysteresis: ice-sheet feedback shifts the melting threshold by this many K. */
  iceHysteresisK: number;
  iceWidthK: number;
  iceGrowTauYr: number;
  iceMeltTauYr: number;
  /** Global albedo forcing at full ice cover, W m-2 (positive number; applied negative). */
  iceAlbedoForcing: number;
  /** Eustatic sea-level fall at full ice cover, m. */
  iceSeaLevelM: number;
  /** δ18O enrichment of seawater at full ice cover, ‰. */
  iceD18O: number;
  /** Steric (thermal expansion) sea-level change, m per K of surface warming. */
  stericMPerK: number;

  // ---------------------------------------------------------------- carbon fluxes, Pg C yr-1
  /** Reference volcanic/metamorphic degassing = reference silicate weathering. */
  volc0: number;
  /** Reference carbonate weathering (rock carbon). */
  carbW0: number;
  /** Reference oxidative weathering of old organic carbon = reference organic burial. */
  orgW0: number;
  /** Silicate weathering: CO2 dependence exponent (0.2–0.5). */
  betaCO2: number;
  /** Silicate weathering: e-folding temperature, K (≈ 10–15). */
  tauSilK: number;
  /** Carbonate weathering: e-folding temperature, K. */
  tauCarbK: number;
  /** Reference organic carbon in crustal reservoir, Pg C. */
  morg0: number;
  /**
   * Share of organic burial that is terrestrial (plant matter, coal) at the reference state. Terrestrial
   * burial is suppressed when the atmosphere is oxygen-rich (more wildfire), which is the main thing that
   * keeps atmospheric O2 within bounds over geological time.
   */
  terrBurialFrac: number;

  // ---------------------------------------------------------------- ocean
  oceanMassKg: number;
  /** Fraction of ocean mass in the "surface/thermocline" box. */
  surfFrac: number;
  /** Surface <-> deep exchange, kg yr-1 (1.5e18 ≈ 50 Sv). */
  mixKgYr: number;
  /** Net gas exchange coefficient, Pg C yr-1 per ppm of pCO2 difference. */
  gasExchange: number;
  /** Gross isotopic exchange atmosphere <-> surface ocean, Pg C yr-1. */
  isoExchange: number;
  /** Organic carbon exported out of the surface box, Pg C yr-1 (reference). */
  exportOrg0: number;
  /** Carbonate rain out of the surface box, Pg C yr-1 (reference). */
  rainCarb0: number;
  /** Exponent in shelf carbonate burial ∝ (Ω-1)^n (Zeebe & Westbroek 2003: 1.7). */
  shelfExponent: number;
  /** Fraction of carbonate rain that is buried when the whole seafloor is above the CCD. */
  pelagicBurialMax: number;
  /** Reference CCD depth, m. */
  ccd0: number;
  /** d ln[CO3]sat / dz, m-1 (pressure effect on calcite solubility). */
  ccdKappa: number;
  /** Hypsometry: depth (m) at which half the seafloor is shallower; and its width. */
  hypsZ0: number;
  hypsW: number;
  /** Ocean mixing is multiplied by max(0.2, 1 - this * warming(K)). Stratification with warmth. */
  stratPerK: number;

  // ---------------------------------------------------------------- phosphorus, oxygen
  /** Reference riverine reactive P, mol yr-1. */
  pRiv0: number;
  /** Reference ocean phosphate, µmol/kg. */
  pRef: number;
  /** C:P of buried organic matter, oxic and anoxic (Van Cappellen & Ingall 1994). */
  cpOxic: number;
  cpAnoxic: number;
  /** Fe/Ca-bound P burial falls by this fraction (0..1) under full anoxia. */
  fePReduction: number;
  /** Oxidative weathering of old organic carbon scales as (pO2/pO2ref)^this. */
  o2WeatherExp: number;
  /** Organic burial efficiency is multiplied by (1 + (anoxicBurialGain-1)*a). */
  anoxicBurialGain: number;
  /** Deep-ocean O2 saturation at reference, µmol/kg. */
  o2Sat0: number;
  /** O2 saturation falls by this fraction per K of warming. */
  o2SatPerK: number;
  /** O2 consumed per C respired. */
  respRatio: number;
  /** Deep O2 (µmol/kg) at which the anoxic fraction is 0.5, and logistic width. */
  o2Crit: number;
  o2Width: number;

  // ---------------------------------------------------------------- isotopes (‰)
  d13CVolc: number;
  d13CCarbW: number;
  d13COrgW: number;
  /** Photosynthetic fractionation ε_p at pCO2Ref and its change per CO2 doubling. */
  epsP0: number;
  epsPPerDoubling: number;
  /** Carbonate-bicarbonate offset. */
  epsCalcite: number;
  /** Terrestrial plant matter is this much lighter than atmospheric CO2 (C3 photosynthesis). */
  epsTerr: number;
  /** Atmospheric CO2 is this much lighter than surface DIC at isotopic equilibrium. */
  epsAtm: number;
  /** Reference seawater δ18O (ice-free), ‰. */
  d18OSw0: number;

  // ---------------------------------------------------------------- test switches
  /** Disable all external sources/sinks (for conservation tests). */
  closedSystem: boolean;
}

export const EARTH_LIKE: PlanetParams = {
  pCO2Ref: 600,
  tBaseC: 16,
  tDeepBaseC: 4,
  omegaSurf0: 5,
  salinity: 35,
  caMolKg: 0.01028,

  ecs: 3.2,
  heatCapSurf: 8,
  heatCapDeep: 1200,
  heatExchange: 0.7,
  brighteningPer100Myr: 0.0035,

  iceTempNoPolar: 8,
  iceTempPolarBonus: 12,
  iceHysteresisK: 3,
  iceWidthK: 0.8,
  iceGrowTauYr: 30_000,
  iceMeltTauYr: 10_000,
  iceAlbedoForcing: 6,
  iceSeaLevelM: 120,
  iceD18O: 1.1,
  stericMPerK: 0.5,

  volc0: 0.075,
  carbW0: 0.12,
  orgW0: 0.05,
  betaCO2: 0.4,
  tauSilK: 12,
  tauCarbK: 25,
  morg0: 1.0e7,
  terrBurialFrac: 0.4,

  oceanMassKg: 1.4e21,
  surfFrac: 0.1,
  mixKgYr: 1.5e18,
  gasExchange: 0.2,
  isoExchange: 60,
  exportOrg0: 2.6,
  rainCarb0: 1.0,
  shelfExponent: 1.7,
  pelagicBurialMax: 0.15,
  ccd0: 4400,
  ccdKappa: 1.8e-4,
  hypsZ0: 3500,
  hypsW: 800,
  stratPerK: 0.012,

  pRiv0: 1.0e11,
  pRef: 2.2,
  cpOxic: 106,
  cpAnoxic: 250,
  fePReduction: 0.85,
  o2WeatherExp: 1,
  anoxicBurialGain: 3,
  o2Sat0: 330,
  o2SatPerK: 0.01,
  respRatio: 1.3,
  o2Crit: 20,
  o2Width: 20,

  d13CVolc: -5,
  d13CCarbW: 2,
  d13COrgW: -25,
  epsP0: 26,
  epsPPerDoubling: 1,
  epsCalcite: 1,
  epsTerr: 19,
  epsAtm: 8,
  d18OSw0: -1,

  closedSystem: false,
};

/** Draw a random Earth-*like* planet: same physics, different numbers. */
export function samplePlanet(rng: Rng): PlanetParams {
  const r = rng.fork('planet');
  // Faster ocean overturn supports proportionally more biological export at the same oxygen deficit,
  // so the *baseline* deep-ocean oxygenation does not depend on the sampled mixing rate.
  const mixKgYr = r.range(1.0e18, 2.2e18);
  const mixScale = mixKgYr / EARTH_LIKE.mixKgYr;
  const p: PlanetParams = {
    ...EARTH_LIKE,
    mixKgYr,
    exportOrg0: EARTH_LIKE.exportOrg0 * mixScale,
    rainCarb0: EARTH_LIKE.rainCarb0 * mixScale,
    pCO2Ref: Math.round(r.logUniform(350, 2500)),
    tBaseC: r.range(12, 20),
    omegaSurf0: r.range(4, 6.5),
    caMolKg: r.range(0.008, 0.016),
    ecs: r.range(2.2, 4.5),
    brighteningPer100Myr: r.range(0.001, 0.007),
    betaCO2: r.range(0.25, 0.5),
    tauSilK: r.range(9, 15),
    volc0: r.range(0.055, 0.1),
    carbW0: r.range(0.09, 0.16),
    orgW0: r.range(0.035, 0.07),
    iceTempNoPolar: r.range(6, 10),
    iceTempPolarBonus: r.range(9, 15),
  };
  // The baseline needs shelf carbonate burial to make up the difference between total carbonate burial (= Fsil + Fc)
  // and pelagic burial; keep pelagic burial under 60 % of the total whatever the sampled fluxes.
  const fracAbove0 = 1 / (1 + Math.exp(-(p.ccd0 - p.hypsZ0) / p.hypsW));
  p.pelagicBurialMax = Math.min(p.pelagicBurialMax, (0.6 * (p.volc0 + p.carbW0)) / (p.rainCarb0 * fracAbove0));
  return p;
}
