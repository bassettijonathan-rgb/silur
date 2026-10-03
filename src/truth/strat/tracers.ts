/**
 * Tracer registry — what a layer of rock is made of (design D2).
 *
 * Every quantity stored in a layer is EXTENSIVE (per m² of seafloor/land), so mixing two parcels of
 * sediment is plain addition and dilution/condensation come out right automatically. Finished proxies
 * (δ13C in ‰, Ir in ppb, TOC in wt %) are ratios computed at observation time.
 *
 * To add a new tracer: add its name here and say what it is; give it a deposition rule in simulate.ts.
 *
 * Isotope tracers are stored as MOMENTS: δ × (weight tracer). E.g. d13C_carb = δ13C(‰) × caco3 (m), so
 * the bulk δ13C of a mixed parcel is d13C_carb / caco3.
 */

export const TRACERS = [
  'clastic', // terrigenous grains, m of solid rock
  'sand', //    coarse part of clastic (sand/gravel), m of solid rock (sand ⊂ clastic; mud = clastic − sand)
  'caco3', //   carbonate, m of solid rock
  'orgC', //    organic carbon, kg C m⁻²
  'evap', //    evaporite minerals, m of solid rock
  'ash', //     volcanic ash, m of solid rock
  'ashAge', //  ash × age (m·Ma): mean age of ash grains = ashAge / ash
  'Ir', //      iridium, ng m⁻²
  'Hg', //      mercury, µg m⁻²
  'pyriteS', // sulfur in pyrite, kg S m⁻²
  'charcoal', // g m⁻²
  'shockedQz', // shocked quartz grains, 1000 m⁻²
  'spherules', // impact spherules, 1000 m⁻²
  'Fe60', //    ⁶⁰Fe atoms (arbitrary units) m⁻² as deposited (decay applied at observation)
  'persistOrg', // persistent/pyrogenic organics, arbitrary units m⁻²
  'd13C_carb', // δ13C of carbonate × caco3
  'd13C_org', //  δ13C of organic carbon × orgC
  'd18O_carb', // δ18O of carbonate × caco3
  'd15N', //      δ15N of organic N × orgC
] as const;

export type TracerName = (typeof TRACERS)[number];
export const NT = TRACERS.length;
export const T: { readonly [K in TracerName]: number } = Object.fromEntries(
  TRACERS.map((n, i) => [n, i]),
) as { [K in TracerName]: number };

/** Grain densities, kg m⁻³. */
export const DENSITY = { clastic: 2700, caco3: 2710, evap: 2200, ash: 2400 } as const;
/** Organic matter is ~50 % carbon with density ~1200 kg m⁻³ -> 600 kg C per m of solid organic matter. */
export const KG_C_PER_M_ORGANIC = 600;
/** Dry mass of organic matter per kg of organic carbon. */
export const ORG_MASS_PER_C = 2;

/** Thickness of solid grains represented by the tracer vector at offset `off`, m. */
export function solidOf(a: ArrayLike<number>, off = 0): number {
  return (
    a[off + T.clastic] + a[off + T.caco3] + a[off + T.evap] + a[off + T.ash] + a[off + T.orgC] / KG_C_PER_M_ORGANIC
  );
}

/** Dry sediment mass per m², kg. */
export function massOf(a: ArrayLike<number>, off = 0): number {
  return (
    a[off + T.clastic] * DENSITY.clastic +
    a[off + T.caco3] * DENSITY.caco3 +
    a[off + T.evap] * DENSITY.evap +
    a[off + T.ash] * DENSITY.ash +
    a[off + T.orgC] * ORG_MASS_PER_C
  );
}
