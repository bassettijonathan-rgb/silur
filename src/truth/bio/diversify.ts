/**
 * The biosphere simulator: species-level birth–death process on the TimePlan.
 *
 *   speciation  λ = λ0 · clade · (1 − N_guild / K_guild)       diversity-dependent: empty niches refill, full ones don't
 *   extinction  hazard = h_base + Σ_s v_s I_s / τ_s + thermal   dose-based: correct for a year-long winter and a 100-kyr acidification
 *               P(die in step) = 1 − exp(−hazard · dt)
 *
 * Species inherit traits from a parent with mutation (more variance when niches are empty — adaptive
 * radiation), so lineages track climate and can become large, burrow, calcify differently, etc.
 * A burn-in at the start (no stress) gives the record a standing biosphere; its survivors are the roots.
 */

import { Rng } from '../../shared/rng';
import { TimePlan } from '../../shared/timeplan';
import { EarthHistory } from '../earth/run';
import { Clade, makeClades } from './clades';
import { BioParams, DEFAULT_BIO } from './params';
import { ALIVE, BEFORE_RECORD, SpeciesTable } from './species';
import { StressorSeries, computeStressors, lethalCoefficients, vulnerabilities } from './stressors';
import { GUILDS, NS, REALM, Traits, guildOf } from './traits';

export interface BioInput {
  plan: TimePlan;
  earth: EarthHistory;
  rng: Rng;
  params?: Partial<BioParams>;
}

export interface BioWorld {
  plan: TimePlan;
  params: BioParams;
  clades: Clade[];
  species: SpeciesTable;
  stress: StressorSeries;
  /** Species alive at the end of each step, and births / deaths during it. */
  living: Int32Array;
  births: Int32Array;
  deaths: Int32Array;
  /** Marine burrower richness relative to the start (drives bioturbation depth in the strata). */
  burrowIndex: Float64Array;
  /** Seed string for deterministic fossil sampling. */
  seed: string;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export function runBiosphere(input: BioInput): BioWorld {
  const { plan, earth } = input;
  const p: BioParams = { ...DEFAULT_BIO, ...input.params };
  const r = input.rng.fork('bio');
  const rEvo = r.fork('evolve');
  const clades = makeClades(p.nClades, r);
  const species = new SpeciesTable();
  const stress = computeStressors(plan, earth, p.baselineTauMyr);
  const coef = lethalCoefficients(p);
  const thermalCoef = 1 / p.lethalYr.thermal;
  const durationMyr = plan.ageBaseMa[0];

  // capacity per guild
  const K = new Float64Array(GUILDS);
  for (let realm = 0; realm < 3; realm++) for (let t = 0; t < 4; t++) K[guildOf(realm, t)] = p.kRealm[realm] * p.trophicShare[t];

  let alive = new Int32Array(8192);
  let nAlive = 0;
  const N = new Int32Array(GUILDS);
  let Tlag = stress.tempC[0];
  const c = new Float64Array(NS);

  /** Create a species from a parent (or clade founder when parent < 0). */
  const spawn = (parent: number, clade: Clade, birth: number, vacancy: number): void => {
    const base: Traits = parent >= 0 ? species.traitsOf(parent) : clade;
    const boost = 1 + p.radiationBoost * vacancy;
    const t: Traits = { ...base };
    t.logMass = clamp(base.logMass + rEvo.gauss(parent >= 0 ? 0.03 * vacancy : 0, p.massSd * boost), -14, 9);
    t.breadth = clamp(base.breadth + rEvo.gauss(0, 0.08 * boost), 0.05, 1);
    t.range = clamp(0.15 + 0.75 * t.breadth + rEvo.gauss(0, 0.1), 0.02, 1);
    t.insular = clade.insularProb > 0 && rEvo.chance(clade.insularProb) ? 1 : 0;
    if (t.insular) { t.range = Math.min(t.range * 0.25, 0.15); t.breadth *= 0.7; }
    if (base.realm === REALM.marine) t.depthPref = clamp(Math.exp(Math.log(1 + base.depthPref) + rEvo.gauss(0, 0.35 * boost)) - 1, 0, 5000);
    t.latPref = clamp(base.latPref + rEvo.gauss(0, 6), 0, 85);
    t.tOff = clamp(base.tOff * 0.7 + rEvo.gauss(0, 2.5), -8, 8);
    if (rEvo.chance(p.flipProb)) {
      const which = rEvo.int(3);
      if (which === 0 && t.mineral > 0) t.mineral = 1 + rEvo.int(3);
      else if (which === 1) t.burrower = 1 - t.burrower;
      else if (which === 2 && t.realm === REALM.terrestrial) t.endo = 1 - t.endo;
    }
    const hBase = p.h0 * clade.hMult * (0.6 + 1.6 * (1 - t.breadth)) * (1 + 0.15 * Math.max(0, (t.logMass - 3) / 3));
    const id = species.push(clade.id, parent, birth, t, rEvo.gauss(0, 1.2), hBase);
    vulnerabilities(t, species.vuln, id * NS);
    if (nAlive === alive.length) { const b = new Int32Array(alive.length * 2); b.set(alive); alive = b; }
    alive[nAlive++] = id;
    N[guildOf(t.realm, t.trophic)]++;
  };

  const seedClade = (cl: Clade, birth: number): void => {
    for (let k = 0; k < p.foundersPerClade; k++) spawn(-1, cl, birth, 1);
  };

  // returns [births, deaths, marine burrowers alive]
  const out = { births: 0, deaths: 0, burrowers: 0 };
  const stepOnce = (stepIdx: number, dtYr: number, Tg: number, I: Float32Array[] | null): void => {
    const dtMyr = dtYr / 1e6;
    Tlag += (Tg - Tlag) * (1 - Math.exp(-dtMyr / p.thermalTauMyr));
    for (let s = 0; s < NS; s++) c[s] = I ? I[s][stepIdx] * dtYr * coef[s] : 0;
    const thermDose = (dtYr * thermalCoef);
    const nStart = nAlive;
    const vu = species.vuln;
    let w = 0;
    out.births = 0; out.deaths = 0; out.burrowers = 0;
    // First pass: extinction; remember who may speciate (decided on start-of-step guild counts).
    const speciators: number[] = [];
    for (let k = 0; k < nStart; k++) {
      const i = alive[k];
      let haz = species.hBase[i] * dtMyr;
      const o = i * NS;
      for (let s = 0; s < NS; s++) haz += vu[o + s] * c[s];
      const excess = Math.abs(Tg - (Tlag + species.tOff[i])) - species.tTol[i];
      if (excess > 0) haz += (excess / species.tTol[i]) * thermDose;
      if (rEvo.next() < 1 - Math.exp(-haz)) {
        species.death[i] = stepIdx;
        N[guildOf(species.realm[i], species.trophic[i])]--;
        out.deaths++;
        continue;
      }
      alive[w++] = i;
      const g = guildOf(species.realm[i], species.trophic[i]);
      const lam = p.lambda0 * clades[species.clade[i]].lamMult * Math.max(0, 1 - N[g] / K[g]);
      if (rEvo.next() < 1 - Math.exp(-lam * dtMyr)) speciators.push(i);
    }
    nAlive = w;
    for (const i of speciators) {
      const g = guildOf(species.realm[i], species.trophic[i]);
      const vacancy = Math.max(0, 1 - N[g] / K[g]);
      spawn(i, clades[species.clade[i]], stepIdx, vacancy);
      out.births++;
    }
    for (let k = 0; k < nAlive; k++) {
      const i = alive[k];
      if (species.realm[i] === REALM.marine && species.burrower[i]) out.burrowers++;
    }
  };

  // ---- burn-in: seed the clades present from the start and let diversity equilibrate under benign conditions
  for (const cl of clades) if (cl.originFrac === 0) seedClade(cl, BEFORE_RECORD);
  const burnSteps = Math.round(p.burnInMyr / p.burnInDtMyr);
  for (let b = 0; b < burnSteps; b++) stepOnce(-1, p.burnInDtMyr * 1e6, stress.tempC[0], null);
  species.compactSurvivors();
  nAlive = 0;
  N.fill(0);
  for (let i = 0; i < species.n; i++) {
    if (nAlive === alive.length) { const b = new Int32Array(alive.length * 2); b.set(alive); alive = b; }
    alive[nAlive++] = i;
    N[guildOf(species.realm[i], species.trophic[i])]++;
  }

  // ---- the record
  const n = plan.n;
  const living = new Int32Array(n), births = new Int32Array(n), deaths = new Int32Array(n);
  const burrowIndex = new Float64Array(n);
  const pending = clades.filter((cl) => cl.originFrac > 0).sort((a, b) => a.originFrac - b.originFrac);
  let nextClade = 0;
  let burrowBase = 0;
  for (let s = 0; s < n; s++) {
    const elapsedFrac = 1 - plan.ageBaseMa[s] / durationMyr;
    while (nextClade < pending.length && pending[nextClade].originFrac <= elapsedFrac) seedClade(pending[nextClade++], s);
    stepOnce(s, plan.dtYr[s], stress.tempC[s], stress.I);
    living[s] = nAlive; births[s] = out.births; deaths[s] = out.deaths;
    if (s === 0) burrowBase = Math.max(out.burrowers, 1);
    burrowIndex[s] = out.burrowers / burrowBase;
  }

  return { plan, params: p, clades, species, stress, living, births, deaths, burrowIndex, seed: r.key };
}

/** Species alive just before step s began and that died during step s (victims of an event in s). */
export function victimsAt(bio: BioWorld, s: number): { alive: number[]; died: number[] } {
  const sp = bio.species;
  const alive: number[] = [], died: number[] = [];
  for (let i = 0; i < sp.n; i++) {
    if (sp.birth[i] > s - 1 || sp.death[i] < s) continue;
    alive.push(i);
    if (sp.death[i] === s) died.push(i);
  }
  return { alive, died };
}

export { ALIVE };
