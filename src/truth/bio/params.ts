/** Tunable constants of the biosphere model. Rates are per species per Myr unless stated. */
import type { StressorId } from './traits';

export interface BioParams {
  // ---- diversification
  /** Intrinsic speciation rate (diversity-dependent: × (1 − N/K)). */
  lambda0: number;
  /** Background extinction rate at average breadth; specialists are higher. */
  h0: number;
  /** Carrying capacity (species) of each realm; split across trophic levels by `trophicShare`. */
  kRealm: [number, number, number];
  trophicShare: [number, number, number, number];
  /** Founders seeded when a clade originates. */
  foundersPerClade: number;
  nClades: number;
  /** Burn-in so the record starts with a standing biosphere. */
  burnInMyr: number;
  burnInDtMyr: number;
  /** Thermal adaptation: the niche tracks global temperature with this e-folding time, Myr. */
  thermalTauMyr: number;
  /** Running-mean window for "slow" background (Ω, shelf area), Myr. */
  baselineTauMyr: number;

  // ---- stressors: lethal time, years of full intensity needed to kill 63 % of fully vulnerable species
  lethalYr: Record<StressorId | 'thermal', number>;

  // ---- trait evolution at speciation
  massSd: number;
  /** Trait variance multiplier when niches are empty (adaptive radiation). */
  radiationBoost: number;
  /** Probability per speciation of a mineralogy / hard-part / habit flip. */
  flipProb: number;

  // ---- taphonomy
  /** Preservation by hard part [soft, chitin, carbonate, phosphate, silica]. */
  pHard: [number, number, number, number, number];
  /** Lagerstätte multipliers for soft and chitinous bodies. */
  lagerSoft: number;
  lagerChitin: number;
}

export const DEFAULT_BIO: BioParams = {
  lambda0: 0.32,
  h0: 0.1,
  kRealm: [720, 460, 110],
  trophicShare: [0.3, 0.35, 0.15, 0.2],
  foundersPerClade: 5,
  nClades: 40,
  burnInMyr: 40,
  burnInDtMyr: 0.5,
  thermalTauMyr: 5,
  baselineTauMyr: 3,

  lethalYr: {
    acid: 4e5,
    anoxia: 3e5,
    light: 0.5,
    uv: 30,
    fire: 30,
    shelf: 6e5,
    harvest: 3e3,
    habitat: 1e4,
    thermal: 4e5,
  },

  massSd: 0.3,
  radiationBoost: 2.5,
  flipProb: 0.02,

  pHard: [0.002, 0.12, 1.0, 0.7, 0.45],
  lagerSoft: 0.6,
  lagerChitin: 0.8,
};
