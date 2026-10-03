/**
 * What a palaeontologist calls things. Species are grouped into MORPHOTYPES by what can be seen in a specimen
 * (body plan lineage, hard part, size, habit): sister species that look alike are lumped, which is a real source of
 * error in biostratigraphy. Names are stable, so the same form gets the same name in every sample.
 */
import { Morphotype } from '../shared/protocol';
import { hash32 } from '../shared/rng';
import { BioWorld } from '../truth/bio/diversify';
import { speciesName } from '../truth/bio/species';
import { HARD, REALM } from '../truth/bio/traits';

const MATERIAL = ['soft-tissue impression', 'chitinous cuticle', 'calcareous shell', 'phosphatic skeleton', 'siliceous test'];

export function sizeClass(logMass: number): string {
  return logMass < -6 ? 'microscopic' : logMass < -2 ? 'small (mm–cm)' : logMass < 2 ? 'medium (cm–dm)' : logMass < 5 ? 'large (dm–m)' : 'giant (m+)';
}

export function habitOf(bio: BioWorld, i: number): string {
  const sp = bio.species;
  if (sp.realm[i] === REALM.terrestrial) return sp.burrower[i] ? 'burrowing land animal' : 'land';
  if (sp.realm[i] === REALM.freshwater) return 'freshwater';
  return sp.pelagic[i] ? 'planktonic or swimming' : sp.burrower[i] ? 'burrowing seafloor animal' : 'seafloor';
}

/** Group key: species that look the same to a specialist share it. */
export function morphotypeKey(bio: BioWorld, i: number): string {
  const sp = bio.species;
  return [sp.clade[i], sp.hard[i], sp.mineral[i] > 0 ? 1 : 0, sp.realm[i], Math.round(sp.logMass[i] / 1.2), Math.round(Math.log1p(sp.depthPref[i]) / 1.2), sp.pelagic[i]].join('|');
}

export function morphotypeName(bio: BioWorld, i: number): string {
  return speciesName(bio.clades[bio.species.clade[i]].name, hash32(morphotypeKey(bio, i)) % 997);
}

export function describe(bio: BioWorld, i: number, count: number): Morphotype {
  const sp = bio.species;
  return { name: morphotypeName(bio, i), count, material: MATERIAL[sp.hard[i] as number] ?? MATERIAL[HARD.soft], size: sizeClass(sp.logMass[i]), habit: habitOf(bio, i) };
}
