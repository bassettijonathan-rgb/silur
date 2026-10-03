/**
 * Mimicry (design §5). Every channel the civilization acts on has a natural event that leaves a similar mark in at
 * least one proxy; `injectMimics` makes sure such look-alikes occur in EVERY world (civilization or not), at a rate set
 * by `mimicFrequency`, so "any δ13C excursion plus a nitrogen shift means civilization" is never a winning rule.
 */
import { Rng } from '../../shared/rng';
import { makeAridification } from './aridification';
import { drawDiameter, makeBolide } from './bolide';
import { makeClathrate } from './clathrate';
import { makeLip } from './lip';
import { ForcedEvent } from './types';

export interface MimicPair {
  /** What the civilization does. */
  agentSignature: string;
  /** The natural event that imitates it. */
  naturalMimic: 'clathrate' | 'lip' | 'bolide' | 'aridification' | 'oae';
  /** Proxies where the two overlap. */
  sharedProxies: string[];
}

export const MIMIC_PAIRS: MimicPair[] = [
  { agentSignature: 'fossil-carbon burning (light-carbon excursion, warming)', naturalMimic: 'clathrate', sharedProxies: ['d13C_carb', 'd13C_org', 'd18O_carb'] },
  { agentSignature: 'fossil-carbon burning (light-carbon excursion, warming)', naturalMimic: 'lip', sharedProxies: ['d13C_carb', 'd18O_carb'] },
  { agentSignature: 'coal burning (mercury)', naturalMimic: 'lip', sharedProxies: ['hg', 'toc'] },
  { agentSignature: 'soot and fire (charcoal, pyrogenic organics)', naturalMimic: 'bolide', sharedProxies: ['charcoal', 'persistOrg'] },
  { agentSignature: 'fertiliser runoff (δ15N)', naturalMimic: 'oae', sharedProxies: ['d15N'] },
  { agentSignature: 'agriculture (sediment flux, land cover)', naturalMimic: 'aridification', sharedProxies: ['accumulation rate', 'sand fraction'] },
  { agentSignature: 'hunting of large animals', naturalMimic: 'bolide', sharedProxies: ['extinction selectivity'] },
  { agentSignature: 'habitat loss on islands', naturalMimic: 'aridification', sharedProxies: ['extinction selectivity'] },
];

export type MimicKind = 'clathrate-small' | 'lip-burst' | 'impact-fire' | 'aridification';

/** A short LIP burst: sills cooking coal release light thermogenic carbon and mercury in a geological instant. */
export function makeLipBurst(ageMa: number, r: Rng): ForcedEvent {
  const lip = makeLip(ageMa, r);
  lip.durationMyr = r.logUniform(0.05, 0.3);
  lip.carbonPg = r.logUniform(3e3, 1.5e4);
  lip.d13C = r.range(-28, -12);
  lip.sulfurPg = r.logUniform(150, 800);
  lip.hgMult = r.logUniform(4, 25);
  lip.pulses = [r.range(0.2, 0.45), r.range(0.55, 0.85)];
  return lip;
}

export function injectMimics(rng: Rng, durationMyr: number, mimicFrequency: number, mapHalfKm: number): ForcedEvent[] {
  const r = rng.fork('mimics');
  const n = r.poisson(3 * mimicFrequency);
  const out: ForcedEvent[] = [];
  const kinds: MimicKind[] = ['clathrate-small', 'lip-burst', 'impact-fire', 'aridification'];
  for (let i = 0; i < n; i++) {
    const age = r.range(3.5, durationMyr - 3);
    switch (r.pick(kinds)) {
      case 'clathrate-small': { const e = makeClathrate(age, r); e.massPg = r.range(1500, 3000); e.onsetKyr = r.logUniform(1, 5); out.push(e); break; }
      case 'lip-burst': out.push(makeLipBurst(age, r)); break;
      case 'impact-fire': out.push(makeBolide(age, drawDiameter(r, 3, 9), r, mapHalfKm)); break;
      case 'aridification': out.push(makeAridification(age, r)); break;
    }
  }
  return out;
}
