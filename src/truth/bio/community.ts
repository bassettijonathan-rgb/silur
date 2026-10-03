/**
 * Who lives where: from the global species pool to the community at one place and time.
 *
 * A species is a candidate if it was alive during the time window. Its suitability for a particular
 * setting combines realm vs. facies (marine animals live in marine facies, land animals on land, with
 * some washing-in), depth preference, palaeolatitude and — for bottom-dwellers — oxygen. Relative
 * abundance follows a lognormal rank-abundance with smaller bodies more abundant.
 */

import { BioWorld } from './diversify';
import { REALM } from './traits';

/** The setting of a layer, as far as biology cares. */
export interface EnvContext {
  facies: number;
  /** Water depth, m (negative on land). */
  waterDepthM: number;
  /** Bottom-water O2, µmol/kg. */
  bottomO2: number;
  /** Absolute palaeolatitude, degrees. */
  latDeg: number;
  /** Sedimentation rate, m/Myr. */
  sedRateMPerMyr: number;
  /** Burial depth of the sample today, m (diagenesis). */
  burialDepthM: number;
  /** Age of the sample, Ma. */
  ageMa: number;
  /** Exceptional-preservation deposit. */
  lagerstatte: boolean;
}

// presence[realm][facies]: how much of the living community of this realm ends up in this facies' habitat
const PRESENCE: number[][] = [
  // fluv terr glac evap delt shSil shCar deep
  [0, 0, 0, 0.05, 0.8, 1, 1, 1], //          marine
  [1, 1, 0.3, 0.05, 0.4, 0.05, 0.05, 0.01], // terrestrial
  [1, 0.7, 0, 0, 0.3, 0, 0, 0], //            freshwater
];

export function presence(realm: number, facies: number): number {
  return PRESENCE[realm][facies];
}

const sqr = (x: number) => x * x;

/** 0..1 suitability of species i for the setting (ignores whether it was alive). */
export function suitability(bio: BioWorld, i: number, ctx: EnvContext): number {
  const sp = bio.species;
  const realm = sp.realm[i];
  let s = PRESENCE[realm][ctx.facies];
  if (s <= 0) return 0;
  if (realm === REALM.marine) {
    const z = Math.log(1 + Math.max(ctx.waterDepthM, 0));
    const zp = Math.log(1 + sp.depthPref[i]);
    const sigma = 0.7 + 1.2 * sp.breadth[i];
    s *= Math.exp(-0.5 * sqr((z - zp) / sigma));
    if (!sp.pelagic[i]) s *= 0.02 + 0.98 * Math.min(1, Math.max(0, (ctx.bottomO2 - 5) / 30)); // benthos needs oxygen
  }
  s *= Math.exp(-0.5 * sqr((ctx.latDeg - sp.latPref[i]) / (12 + 35 * sp.breadth[i])));
  return s;
}

/** Relative abundance weight of species i (before suitability). */
export function abundanceWeight(bio: BioWorld, i: number): number {
  const sp = bio.species;
  return Math.exp(0.9 * sp.abund[i] - 0.5 * Math.min(8, Math.max(-10, sp.logMass[i])));
}

export interface Community {
  ids: number[];
  /** Fraction of the community's individuals, sums to 1. */
  weight: number[];
}

/** Community living at an environment during steps [stepFrom, stepTo]. */
export function communityAt(bio: BioWorld, stepFrom: number, stepTo: number, ctx: EnvContext): Community {
  const sp = bio.species;
  const ids: number[] = [];
  const raw: number[] = [];
  let total = 0;
  for (let i = 0; i < sp.n; i++) {
    if (!sp.aliveBetween(i, stepFrom, stepTo)) continue;
    const w = suitability(bio, i, ctx) * abundanceWeight(bio, i);
    if (w <= 1e-6) continue;
    ids.push(i); raw.push(w); total += w;
  }
  const weight = total > 0 ? raw.map((w) => w / total) : raw;
  return { ids, weight };
}
