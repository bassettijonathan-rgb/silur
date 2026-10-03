/**
 * Seawater carbonate chemistry.
 *
 * Given dissolved inorganic carbon (DIC) and total alkalinity (ALK) in µmol/kg, temperature and salinity,
 * solve for [H+] and derive pCO2, pH, carbonate ion and the saturation states Ω of calcite and aragonite.
 *
 *   ALK = [HCO3-] + 2[CO3 2-] + [B(OH)4-] + [OH-] - [H+]
 *
 * Constants: K0 Weiss (1974); K1, K2 Lueker et al. (2000); KB Dickson (1990); Kw Millero (1995);
 * Ksp calcite/aragonite Mucci (1983). All on a single (total-like) scale; the small scale differences
 * (~0.01 pH) are irrelevant for a game and are ignored. Pressure effects are not applied here — the
 * pressure dependence of calcite solubility enters through the CCD relation in the carbon-cycle model.
 *
 * This is a hot-path function (called twice per right-hand-side evaluation), so it writes into a
 * caller-supplied result object and caches the temperature-dependent constants.
 */

export interface CarbonateState {
  pH: number;
  /** Hydrogen ion activity, mol/kg. */
  H: number;
  /** pCO2 in equilibrium with the water, µatm. */
  pCO2: number;
  /** Carbonate ion, µmol/kg. */
  CO3: number;
  HCO3: number;
  CO2aq: number;
  omegaCalcite: number;
  omegaAragonite: number;
}

export function newCarbonateState(): CarbonateState {
  return { pH: 8.1, H: 10 ** -8.1, pCO2: 400, CO3: 200, HCO3: 1800, CO2aq: 10, omegaCalcite: 5, omegaAragonite: 3.3 };
}

interface Constants {
  tK: number;
  S: number;
  K0: number; // mol/kg/atm
  K1: number;
  K2: number;
  Kb: number;
  Kw: number;
  BT: number; // total borate, mol/kg
  Ca: number; // mol/kg
  KspC: number;
  KspA: number;
}

// Small cache of temperature-dependent constants. The model solves two boxes (surface, deep) at
// different temperatures each right-hand-side evaluation, so each caller gets its own slot.
const caches: (Constants | null)[] = [null, null, null, null];

export function carbonateConstants(tK: number, S: number, caMolKg: number, slot = 0): Constants {
  const hit = caches[slot];
  if (hit && hit.tK === tK && hit.S === S && hit.Ca === caMolKg) return hit;
  const lnT = Math.log(tK);
  const sqrtS = Math.sqrt(S);

  // Weiss (1974) CO2 solubility, mol kg-1 atm-1
  const t100 = tK / 100;
  const K0 = Math.exp(
    93.4517 / t100 - 60.2409 + 23.3585 * Math.log(t100) + S * (0.023517 - 0.023656 * t100 + 0.0047036 * t100 * t100),
  );

  // Lueker et al. (2000)
  const pK1 = 3633.86 / tK - 61.2172 + 9.6777 * lnT - 0.011555 * S + 0.0001152 * S * S;
  const pK2 = 471.78 / tK + 25.929 - 3.16967 * lnT - 0.01781 * S + 0.0001122 * S * S;

  // Dickson (1990) boric acid
  const lnKb =
    (-8966.9 - 2890.53 * sqrtS - 77.942 * S + 1.728 * S * sqrtS - 0.0996 * S * S) / tK +
    (148.0248 + 137.1942 * sqrtS + 1.62142 * S) +
    (-24.4344 - 25.085 * sqrtS - 0.2474 * S) * lnT +
    0.053105 * sqrtS * tK;

  // Millero (1995) water
  const lnKw =
    148.9652 - 13847.26 / tK - 23.6521 * lnT + (-5.977 + 118.67 / tK + 1.0495 * lnT) * sqrtS - 0.01615 * S;

  // Mucci (1983) solubility products, (mol/kg)^2
  const log10 = Math.log10;
  const log10KspC =
    -171.9065 - 0.077993 * tK + 2839.319 / tK + 71.595 * log10(tK) +
    (-0.77712 + 0.0028426 * tK + 178.34 / tK) * sqrtS - 0.07711 * S + 0.0041249 * S * sqrtS;
  const log10KspA =
    -171.945 - 0.077993 * tK + 2903.293 / tK + 71.595 * log10(tK) +
    (-0.068393 + 0.0017276 * tK + 88.135 / tK) * sqrtS - 0.10018 * S + 0.0059415 * S * sqrtS;

  const made: Constants = {
    tK,
    S,
    K0,
    K1: 10 ** -pK1,
    K2: 10 ** -pK2,
    Kb: Math.exp(lnKb),
    Kw: Math.exp(lnKw),
    BT: 0.0004157 * (S / 35),
    Ca: caMolKg,
    KspC: 10 ** log10KspC,
    KspA: 10 ** log10KspA,
  };
  caches[slot] = made;
  return made;
}

/**
 * Solve the carbonate system. dicUmol / alkUmol in µmol/kg, temperature in K.
 * Newton iteration on pH inside a shrinking bracket (guaranteed to converge; f is monotonic in pH).
 */
export function solveCarbonate(
  dicUmol: number,
  alkUmol: number,
  tK: number,
  salinity: number,
  caMolKg: number,
  out: CarbonateState,
  slot = 0,
): CarbonateState {
  const c = carbonateConstants(tK, salinity, caMolKg, slot);
  const dic = Math.max(dicUmol, 1e-3) * 1e-6;
  const alk = alkUmol * 1e-6;
  const { K1, K2, Kb, Kw, BT } = c;
  const K1K2 = K1 * K2;

  let lo = 4.0;
  let hi = 12.0;
  let pH = out.pH > lo && out.pH < hi ? out.pH : 8.0;
  const LN10 = Math.LN10;

  for (let it = 0; it < 60; it++) {
    const H = 10 ** -pH;
    const D = H * H + K1 * H + K1K2;
    const carbAlk = (dic * (K1 * H + 2 * K1K2)) / D;
    const f = carbAlk + (BT * Kb) / (Kb + H) + Kw / H - H - alk;
    if (f > 0) hi = pH;
    else lo = pH;

    // df/dH
    const dCarb = (dic * (K1 * D - (K1 * H + 2 * K1K2) * (2 * H + K1))) / (D * D);
    const dfdH = dCarb - (BT * Kb) / ((Kb + H) * (Kb + H)) - Kw / (H * H) - 1;
    const dfdpH = dfdH * (-LN10 * H);

    let next = pH - f / dfdpH;
    if (!(next > lo && next < hi) || !Number.isFinite(next)) next = 0.5 * (lo + hi);
    if (Math.abs(next - pH) < 1e-10) {
      pH = next;
      break;
    }
    pH = next;
  }

  const H = 10 ** -pH;
  const D = H * H + K1 * H + K1K2;
  const CO3 = (dic * K1K2) / D;
  const HCO3 = (dic * K1 * H) / D;
  const CO2aq = (dic * H * H) / D;

  out.pH = pH;
  out.H = H;
  out.CO2aq = CO2aq * 1e6;
  out.HCO3 = HCO3 * 1e6;
  out.CO3 = CO3 * 1e6;
  out.pCO2 = (CO2aq / c.K0) * 1e6; // µatm
  out.omegaCalcite = (c.Ca * CO3) / c.KspC;
  out.omegaAragonite = (c.Ca * CO3) / c.KspA;
  return out;
}

/**
 * Inverse problem used when building a planet's baseline state: find (DIC, ALK) that give a
 * specified pCO2 (µatm) and a specified calcite saturation state Ω. Closed form — no iteration.
 */
export function stateFromPco2AndOmega(
  pCO2uatm: number,
  omegaCalcite: number,
  tK: number,
  salinity: number,
  caMolKg: number,
): { dicUmol: number; alkUmol: number } {
  const c = carbonateConstants(tK, salinity, caMolKg);
  const co2aq = (pCO2uatm * 1e-6) * c.K0; // mol/kg
  const co3 = (omegaCalcite * c.KspC) / c.Ca; // mol/kg
  // [CO3]/[CO2] = K1K2/H^2  ->  H = sqrt(K1 K2 [CO2]/[CO3])
  const H = Math.sqrt((c.K1 * c.K2 * co2aq) / co3);
  const hco3 = (c.K1 * co2aq) / H;
  const dic = co2aq + hco3 + co3;
  const alk = hco3 + 2 * co3 + (c.BT * c.Kb) / (c.Kb + H) + c.Kw / H - H;
  return { dicUmol: dic * 1e6, alkUmol: alk * 1e6 };
}

// ---------------------------------------------------------------------------------------------
// Oxygen-isotope palaeothermometer
// ---------------------------------------------------------------------------------------------

/**
 * δ18O of calcite precipitated at temperature tC (°C) from water of δ18O = d18Ow.
 * Inverts T = 16.5 - 4.3 x + 0.14 x^2 with x = δc - δw (Craig 1965 / Epstein et al. 1953).
 * Slope near 16 °C is -0.23 ‰ per K.
 */
export function d18OCalcite(tC: number, d18Ow: number): number {
  const a = 0.14;
  const b = -4.3;
  const cc = 16.5 - tC;
  const disc = b * b - 4 * a * cc;
  const x = (-b - Math.sqrt(Math.max(disc, 0))) / (2 * a);
  return d18Ow + x;
}
