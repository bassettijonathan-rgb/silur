/**
 * Clades: the founding body plans of this planet's biosphere (design D15 — generic trait bundles, no Earth taxonomy).
 * ~40 clades are built from a dozen archetypes with random perturbation, so every world has calcifiers, soft-bodied
 * things, burrowers, plants, small and large land animals, island endemics... but never the same ones twice.
 */

import { Rng } from '../../shared/rng';
import { HARD, MINERAL, REALM, TROPHIC, Traits } from './traits';

export interface Clade extends Traits {
  id: number;
  name: string;
  /** Multipliers on speciation and extinction. */
  lamMult: number;
  hMult: number;
  /** Fraction of the history elapsed when the clade first appears (0 = present from the start). */
  originFrac: number;
  /** Chance that a new species of this clade is an island endemic. */
  insularProb: number;
}

interface Archetype {
  realm: number; trophic: number; hard: number; mineral: number; pelagic: number; endo: number; burrower: number;
  logMass: number; breadth: number; depth: number; originFrac: [number, number]; insularProb: number;
}

const A = (a: Partial<Archetype> & Pick<Archetype, 'realm' | 'trophic'>): Archetype => ({
  hard: HARD.soft, mineral: MINERAL.none, pelagic: 0, endo: 0, burrower: 0, logMass: 0, breadth: 0.5, depth: 30,
  originFrac: [0, 0], insularProb: 0, ...a,
});

const ARCHETYPES: Archetype[] = [
  A({ realm: REALM.marine, trophic: TROPHIC.autotroph, pelagic: 1, hard: HARD.carbonate, mineral: MINERAL.lmc, logMass: -9, breadth: 0.7, depth: 20, originFrac: [0, 0.25] }), // calcareous plankton
  A({ realm: REALM.marine, trophic: TROPHIC.autotroph, pelagic: 1, hard: HARD.silica, logMass: -9, breadth: 0.7, depth: 20 }), //          silica plankton
  A({ realm: REALM.marine, trophic: TROPHIC.grazer, hard: HARD.carbonate, mineral: MINERAL.aragonite, logMass: -3, breadth: 0.4, depth: 25 }), // aragonitic shelf grazers
  A({ realm: REALM.marine, trophic: TROPHIC.grazer, hard: HARD.carbonate, mineral: MINERAL.hmc, logMass: -2, breadth: 0.5, depth: 40 }), //      reef-ish builders
  A({ realm: REALM.marine, trophic: TROPHIC.grazer, hard: HARD.carbonate, mineral: MINERAL.lmc, logMass: -3, breadth: 0.6, depth: 80 }), //      calcite shell-bearers
  A({ realm: REALM.marine, trophic: TROPHIC.predator, pelagic: 1, hard: HARD.phosphate, logMass: 2, breadth: 0.5, depth: 100, endo: 0 }), //      nekton
  A({ realm: REALM.marine, trophic: TROPHIC.predator, hard: HARD.chitin, logMass: -1, breadth: 0.5, depth: 60 }), //                             armoured benthic hunters
  A({ realm: REALM.marine, trophic: TROPHIC.detritivore, hard: HARD.chitin, burrower: 1, logMass: -3, breadth: 0.6, depth: 150 }), //          burrowing deposit feeders
  A({ realm: REALM.marine, trophic: TROPHIC.grazer, hard: HARD.soft, logMass: -2, breadth: 0.5, depth: 200 }), //                              soft-bodied
  A({ realm: REALM.marine, trophic: TROPHIC.detritivore, hard: HARD.soft, burrower: 1, logMass: -4, breadth: 0.7, depth: 1500 }), //          deep burrowing worms
  A({ realm: REALM.terrestrial, trophic: TROPHIC.autotroph, hard: HARD.soft, logMass: 3, breadth: 0.5, originFrac: [0.02, 0.2] }), //          land plants
  A({ realm: REALM.terrestrial, trophic: TROPHIC.grazer, hard: HARD.chitin, logMass: -4, breadth: 0.5, originFrac: [0.05, 0.25] }), //         small arthropod-like
  A({ realm: REALM.terrestrial, trophic: TROPHIC.detritivore, hard: HARD.chitin, burrower: 1, logMass: -5, breadth: 0.6, originFrac: [0.05, 0.25] }), // soil fauna
  A({ realm: REALM.terrestrial, trophic: TROPHIC.grazer, hard: HARD.phosphate, endo: 1, logMass: 5, breadth: 0.4, originFrac: [0.3, 0.55], insularProb: 0.15 }), // large endothermic herbivores
  A({ realm: REALM.terrestrial, trophic: TROPHIC.predator, hard: HARD.phosphate, endo: 1, logMass: 4, breadth: 0.4, originFrac: [0.35, 0.6], insularProb: 0.1 }), //  large predators
  A({ realm: REALM.terrestrial, trophic: TROPHIC.grazer, hard: HARD.phosphate, logMass: 1, breadth: 0.5, originFrac: [0.15, 0.4], insularProb: 0.2 }), //             mid-size ectotherm vertebrate-likes
  A({ realm: REALM.terrestrial, trophic: TROPHIC.predator, hard: HARD.phosphate, burrower: 1, logMass: -1, breadth: 0.5, originFrac: [0.2, 0.45] }), //              burrowing small predators
  A({ realm: REALM.freshwater, trophic: TROPHIC.grazer, hard: HARD.carbonate, mineral: MINERAL.aragonite, logMass: -4, breadth: 0.4, originFrac: [0.05, 0.3] }), // freshwater shells
  A({ realm: REALM.freshwater, trophic: TROPHIC.predator, hard: HARD.phosphate, logMass: 1, breadth: 0.4, originFrac: [0.1, 0.4] }), //                              freshwater fish-likes
];

const SYL = ['ka', 'vo', 'ra', 'thi', 'mur', 'el', 'zan', 'ori', 'qua', 'dre', 'sel', 'nu', 'bai', 'lor', 'tek', 'yr', 'ash', 'om', 'ixi', 'pel'];

export function makeClades(n: number, rng: Rng): Clade[] {
  const r = rng.fork('clades');
  const out: Clade[] = [];
  for (let i = 0; i < n; i++) {
    const a = ARCHETYPES[i % ARCHETYPES.length]; // every archetype appears at least twice with n = 40
    const originFrac = a.originFrac[1] > 0 ? r.range(a.originFrac[0], a.originFrac[1]) : 0;
    let name = '';
    const syllables = 2 + r.int(2);
    for (let k = 0; k < syllables; k++) name += r.pick(SYL);
    out.push({
      id: i,
      name: name[0].toUpperCase() + name.slice(1),
      realm: a.realm, trophic: a.trophic, hard: a.hard, mineral: a.mineral, endo: a.endo, burrower: a.burrower,
      insular: 0, pelagic: a.pelagic,
      logMass: a.logMass + r.gauss(0, 1),
      breadth: Math.min(0.95, Math.max(0.1, a.breadth + r.gauss(0, 0.12))),
      range: 0.5,
      depthPref: a.realm === REALM.marine ? a.depth * Math.exp(r.gauss(0, 0.6)) : 0,
      latPref: r.range(0, 70),
      tOff: 0,
      lamMult: Math.exp(r.gauss(0, 0.25)),
      hMult: Math.exp(r.gauss(0, 0.2)),
      originFrac,
      insularProb: a.insularProb,
    });
  }
  return out;
}
