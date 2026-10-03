/**
 * Taphonomy: what survives to become a fossil. The fossil record is a *biased* sample of life:
 * hard parts beat soft ones by orders of magnitude, shallow marine beats terrestrial, fast burial helps,
 * and aragonite dissolves with burial and age. Rare anoxic, rapidly buried deposits (Lagerstätten)
 * preserve soft tissue.
 *
 * Realisation is lazy and deterministic: an assemblage is drawn from a seed built from
 * (world seed, caller's key), so the same sample of the same layer always contains the same fossils.
 */

import { Rng } from '../../shared/rng';
import { F } from '../strat/facies';
import { Community, EnvContext, communityAt } from './community';
import { BioWorld } from './diversify';
import { HARD, MINERAL, REALM } from './traits';

// taphonomic environment factor f_env[realm][facies]
const F_ENV: number[][] = [
  // fluv terr glac evap delt shSil shCar deep
  [0, 0, 0, 0.05, 0.5, 0.7, 1.0, 0.35], //   marine
  [0.12, 0.08, 0.02, 0.05, 0.3, 0.05, 0.05, 0.02], // terrestrial
  [0.2, 0.5, 0, 0, 0.3, 0, 0, 0], //          freshwater
];

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Probability weight (relative to a perfect case = 1) that an individual of species i is preserved and found. */
export function preservation(bio: BioWorld, i: number, ctx: EnvContext): number {
  const sp = bio.species;
  const P = bio.params;
  const hard = sp.hard[i];
  let pHard = P.pHard[hard];
  if (ctx.lagerstatte) {
    if (hard === HARD.soft) pHard = Math.max(pHard, P.lagerSoft);
    else if (hard === HARD.chitin) pHard = Math.max(pHard, P.lagerChitin);
  }
  let fEnv = F_ENV[sp.realm[i]][ctx.facies];
  if (sp.realm[i] === REALM.marine && ctx.facies === F.deepMarine && sp.pelagic[i]) fEnv = 0.5; // plankton rain
  // burial: fast burial protects, slow exposure on the seafloor destroys
  const fBurial = clamp(0.15 + 0.85 * clamp(Math.log10(1 + ctx.sedRateMPerMyr) / 3, 0, 1.2), 0.15, 1.2);
  // diagenesis: aragonite dissolves with burial depth and age; calcite and other phases hold up better
  let fDiag: number;
  if (hard === HARD.carbonate && sp.mineral[i] === MINERAL.aragonite) fDiag = Math.exp(-ctx.burialDepthM / 1500) * Math.exp(-ctx.ageMa / 120);
  else if (hard === HARD.carbonate && sp.mineral[i] === MINERAL.hmc) fDiag = Math.exp(-ctx.burialDepthM / 5000) * Math.exp(-ctx.ageMa / 600);
  else fDiag = Math.exp(-ctx.burialDepthM / 12000) * Math.exp(-ctx.ageMa / 2000);
  return pHard * fEnv * fBurial * fDiag;
}

export interface Specimens {
  species: number;
  count: number;
}

/**
 * Draw the fossils found in a sample.
 * @param individuals  size of the death assemblage sampled (individuals-equivalent), e.g. 2000
 * @param key          caller's key; the same key always returns the same sample
 */
export function drawAssemblage(
  bio: BioWorld, stepFrom: number, stepTo: number, ctx: EnvContext, individuals: number, key: string,
  community?: Community,
): Specimens[] {
  const comm = community ?? communityAt(bio, stepFrom, stepTo, ctx);
  const rng = new Rng(`${bio.seed}|fossil|${key}`);
  const out: Specimens[] = [];
  for (let k = 0; k < comm.ids.length; k++) {
    const i = comm.ids[k];
    const mean = individuals * comm.weight[k] * preservation(bio, i, ctx);
    if (mean < 1e-9) { continue; }
    const count = rng.poisson(mean);
    if (count > 0) out.push({ species: i, count });
  }
  return out;
}
