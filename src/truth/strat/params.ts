/**
 * Tunable constants of the surface-process / sedimentation model. Units in the comments.
 * Change a number here and regenerate; nothing else needs to know.
 */

export interface StratParams {
  /** Surface elevation = basement + (1 − isoK) × compacted sediment: the rest is lost to isostatic sinking. */
  isoK: number;
  /** Solid metres of sediment needed per metre of surface rise (accommodation conversion). */
  accomSolidPerM: number;

  // ---- rivers
  /** Stream-power erosion  E = kStream · humidityFactor · A^m · S  (E in m/yr of solid rock, A in km²). */
  kStream: number;
  streamM: number;
  /** Below this slope (m/m) a river deposits instead of eroding (floodplain / alluvial plain). */
  slopeCrit: number;
  /** Fraction of incoming sediment dropped on a gentle subaerial cell. */
  floodplainDeposit: number;
  /** Sand fraction of eroded bedrock. */
  sandFracBedrock: number;
  /** Drainage area (km²) above which a depositing cell counts as a river channel belt. */
  riverAreaKm2: number;

  // ---- marine redistribution (fractions of incoming sediment deposited per cell)
  /** Coarse: exp(−d/coarseDecayM), clamped. Fine: constant on shelf, higher in basin. */
  coarseDecayM: number;
  fineShelf: number;
  fineBasin: number;

  // ---- carbonates
  /** Max platform production, m/yr (Bosscher & Schlager 1992 saturation curve). */
  carbGmax: number;
  carbI0: number; // surface light, µE
  carbIk: number; // saturating light
  carbK: number; // light extinction, 1/m
  /** Cool-water (heterozoan) carbonates still form at this fraction of the tropical rate. */
  carbCoolFraction: number;
  /** Clastic input (m/yr) at which carbonate production falls to 1/e (terrigenous poisoning). */
  carbClasticTol: number;
  /** Pelagic carbonate rain above the CCD, m/yr of solid rock. */
  pelagicRate: number;
  /** Clay/dust rain everywhere in the ocean, m/yr. */
  pelagicClay: number;
  shelfDepthMax: number; // m; deeper than this is "deep marine"

  // ---- evaporites
  evapRate: number; // m/yr
  evapAridity: number;
  evapRestriction: number;
  evapDepthMax: number;

  // ---- organic carbon (wt-fraction of dry sediment mass at baseline productivity)
  tocMarine: number;
  tocTerrestrial: number;

  // ---- bioturbation: mixing-layer thickness in SOLID metres per facies at preservation = 0.5
  lmix: Record<string, number>;

  // ---- trace fluxes
  charcoalFlux: number; // g m⁻² yr⁻¹ at fire index 1
  hgFlux: number; //       µg m⁻² yr⁻¹ background
  irDetrital: number; //   ng per g of detrital clastic
  irCarbonate: number; //  ng per g of carbonate
  irCosmicFlux: number; // ng m⁻² yr⁻¹ cosmic dust
  persistFlux: number; //  arbitrary units m⁻² yr⁻¹ background
  pyriteSPerC: number; //  kg S per kg organic C

  // ---- layering / memory
  mergeBedM: number;
}

export const DEFAULT_STRAT: StratParams = {
  isoK: 0.35,
  accomSolidPerM: 0.7,

  kStream: 4e-4,
  streamM: 0.5,
  slopeCrit: 0.0015,
  floodplainDeposit: 0.55,
  sandFracBedrock: 0.35,
  riverAreaKm2: 600,

  coarseDecayM: 35,
  fineShelf: 0.3,
  fineBasin: 0.5,

  carbGmax: 4e-4,
  carbI0: 2000,
  carbIk: 250,
  carbK: 0.06,
  carbCoolFraction: 0.2,
  carbClasticTol: 4e-5,
  pelagicRate: 1.2e-5,
  pelagicClay: 2e-6,
  shelfDepthMax: 200,

  evapRate: 3e-4,
  evapAridity: 0.62,
  evapRestriction: 0.55,
  evapDepthMax: 40,

  tocMarine: 0.004,
  tocTerrestrial: 0.012,

  lmix: {
    fluvial: 0, terrestrial: 0, glacial: 0, evaporite: 0,
    deltaic: 0.03, shelfSiliciclastic: 0.08, shelfCarbonate: 0.1, deepMarine: 0.05,
  },

  charcoalFlux: 2e-4,
  hgFlux: 5e-5,
  irDetrital: 0.03,
  irCarbonate: 0.004,
  irCosmicFlux: 0.2,
  persistFlux: 1e-3,
  pyriteSPerC: 0.36,

  mergeBedM: 10,
};
