/**
 * Forcing channels — the ONLY way anything (volcanoes, impacts, a civilization...) can push on the
 * planet. A `Forcing` is a record of physical rates at an instant; it carries no information about who
 * or what is causing it. This is what enforces the rule "hidden agents act only through the same
 * physical channels as natural processes".
 *
 * M1 (Earth system) consumes the carbon / aerosol / light / acid / nutrient channels. Later milestones
 * consume the rest (surface, biosphere, ejecta). Unused channels simply default to zero.
 */

export interface EjectaField {
  /** Crater position relative to the region origin, km. May lie far outside the map. */
  craterXKm: number;
  craterYKm: number;
  /** Impactor diameter, km. */
  diameterKm: number;
}

export interface Forcing {
  // ---- carbon cycle (Earth system) ----
  /** Carbon released to the atmosphere, Pg C per year. */
  carbonEmission: number;
  /** δ13C of that carbon, ‰ VPDB (e.g. -60 clathrate, -25 fossil fuel, -5 mantle). */
  d13CofEmission: number;
  /** SO2 released, Pg S per year (becomes aerosol + sulfur proxy). */
  sulfurEmission: number;
  /** Hg released, relative to background flux (1 = background). Additive: 3 means +3x background. */
  mercuryEmission: number;

  // ---- radiative ----
  /** Stratospheric aerosol optical depth (volcanic/impact winter), dimensionless. */
  aerosolOpticalDepth: number;
  /** Fraction of sunlight blocked at the surface by dust/soot (0..1). */
  lightReduction: number;

  // ---- fire / chemistry ----
  fireIgnition: number; // extra wildfire frequency, relative to background (0 = none)
  soot: number; // black carbon flux, relative to background
  /** Alkalinity removed from the surface ocean by acid rain etc., Pg C-equivalents per year. */
  acidPulse: number;
  ozoneLoss: number; // fractional column ozone loss (0..1)
  fe60Flux: number; // 60Fe delivery, atoms m-2 yr-1 (arbitrary units; decays with half-life 2.6 Myr)

  // ---- land surface ----
  landCoverLoss: number; // fraction of vegetation cover removed (0..1)
  sedimentFluxMultiplier: number; // multiplies terrigenous sediment supply (1 = unchanged)
  /** Extra global riverine P input, as a fraction of background (0.1 = +10 %). */
  nutrientRunoff: number;
  /** δ15N of the runoff nitrate, ‰ (local signal near river mouths). */
  nutrientRunoffD15N: number;
  persistentOrgFlux: number; // pyrogenic/persistent organics, relative to background

  // ---- biosphere ----
  harvestPressure: number; // 0..1 hunting/harvest mortality scale
  habitatConversion: number; // 0..1 fraction of land habitat converted

  // ---- spatial ----
  ejecta: EjectaField | null;
}

export function zeroForcing(): Forcing {
  return {
    carbonEmission: 0,
    d13CofEmission: -5,
    sulfurEmission: 0,
    mercuryEmission: 0,
    aerosolOpticalDepth: 0,
    lightReduction: 0,
    fireIgnition: 0,
    soot: 0,
    acidPulse: 0,
    ozoneLoss: 0,
    fe60Flux: 0,
    landCoverLoss: 0,
    sedimentFluxMultiplier: 1,
    nutrientRunoff: 0,
    nutrientRunoffD15N: 0,
    persistentOrgFlux: 0,
    harvestPressure: 0,
    habitatConversion: 0,
    ejecta: null,
  };
}

/**
 * Combine two forcings acting simultaneously. Rates add; multipliers multiply; the δ13C of emitted carbon
 * is the flux-weighted mean.
 */
export function addForcing(a: Forcing, b: Forcing): Forcing {
  const eA = a.carbonEmission;
  const eB = b.carbonEmission;
  const eT = eA + eB;
  return {
    carbonEmission: eT,
    d13CofEmission: eT !== 0 ? (eA * a.d13CofEmission + eB * b.d13CofEmission) / eT : a.d13CofEmission,
    sulfurEmission: a.sulfurEmission + b.sulfurEmission,
    mercuryEmission: a.mercuryEmission + b.mercuryEmission,
    aerosolOpticalDepth: a.aerosolOpticalDepth + b.aerosolOpticalDepth,
    lightReduction: Math.min(1, a.lightReduction + b.lightReduction),
    fireIgnition: a.fireIgnition + b.fireIgnition,
    soot: a.soot + b.soot,
    acidPulse: a.acidPulse + b.acidPulse,
    ozoneLoss: Math.min(1, a.ozoneLoss + b.ozoneLoss),
    fe60Flux: a.fe60Flux + b.fe60Flux,
    landCoverLoss: Math.min(1, a.landCoverLoss + b.landCoverLoss),
    sedimentFluxMultiplier: a.sedimentFluxMultiplier * b.sedimentFluxMultiplier,
    nutrientRunoff: a.nutrientRunoff + b.nutrientRunoff,
    nutrientRunoffD15N:
      a.nutrientRunoff + b.nutrientRunoff > 0
        ? (a.nutrientRunoff * a.nutrientRunoffD15N + b.nutrientRunoff * b.nutrientRunoffD15N) /
          (a.nutrientRunoff + b.nutrientRunoff)
        : 0,
    persistentOrgFlux: a.persistentOrgFlux + b.persistentOrgFlux,
    harvestPressure: Math.min(1, a.harvestPressure + b.harvestPressure),
    habitatConversion: Math.min(1, a.habitatConversion + b.habitatConversion),
    ejecta: a.ejecta ?? b.ejecta,
  };
}

/**
 * A source of forcing over time. `ageStartMa` > `ageEndMa` (older -> younger). Implementations return
 * the *average* forcing over that interval.
 */
export type ForcingProvider = (ageStartMa: number, ageEndMa: number) => Forcing;

export const noForcing: ForcingProvider = () => zeroForcing();
