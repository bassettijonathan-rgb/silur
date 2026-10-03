/**
 * Units and physical constants.
 *
 * Conventions used across the model:
 *   - time        : years inside integrators, Ma (million years BEFORE PRESENT) for ages
 *   - carbon      : Pg C  (1 Pg = 1e15 g).  Ocean concentrations are µmol/kg.
 *   - "C-equivalents": alkalinity and cation fluxes are expressed in the same Pg C unit
 *                      (1 mol Ca2+ <-> 1 mol C <-> 2 mol of alkalinity equivalents).
 *   - temperature : °C or K as named; anomalies are in K
 *   - length      : metres
 */

export const YR_PER_KYR = 1e3;
export const YR_PER_MYR = 1e6;

export const C_MOLAR_MASS = 12.011; // g/mol
/** mol of C in one Pg C. */
export const MOL_PER_PGC = 1e15 / C_MOLAR_MASS; // 8.326e13
/** Pg C carried by 1 µmol/kg of dissolved carbon in 1 kg of water. */
export const PGC_PER_UMOL = (C_MOLAR_MASS * 1e-6) / 1e15; // 1.2011e-20 per (µmol/kg · kg)

export const OCEAN_MASS_KG = 1.4e21;
/** Atmosphere: 5.15e18 kg / 28.97 g/mol -> 1 ppm of CO2 = 2.135 Pg C. */
export const PGC_PER_PPM = 2.135;
/** Moles of O2 in the present-day-like atmosphere (21 %). */
export const ATM_O2_MOL = 3.7e19;

/** Radiative forcing per e-fold of CO2, W m-2 (Myhre et al. 1998: 5.35 ln(C/C0)). */
export const CO2_FORCING_COEF = 5.35;
/** Absorbed solar flux, W m-2 (S0 (1-albedo) / 4 for an Earth-like planet). */
export const ABSORBED_SOLAR = 240;

export const KELVIN = 273.15;

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const logistic = (x: number): number => 1 / (1 + Math.exp(-x));
