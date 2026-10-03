/** The species table: every species that ever lived, as typed arrays (struct of arrays, growable). */

import { NS, Traits } from './traits';

export const ALIVE = 0x7fffffff;
/** Birth step of species present before the record begins. */
export const BEFORE_RECORD = -1;

export class SpeciesTable {
  n = 0;
  private cap: number;
  clade: Uint16Array;
  parent: Int32Array;
  birth: Int32Array; //   step of origin (BEFORE_RECORD = -1)
  death: Int32Array; //   last step alive (ALIVE = still living at the end)
  realm: Uint8Array;
  trophic: Uint8Array;
  hard: Uint8Array;
  mineral: Uint8Array;
  endo: Uint8Array;
  burrower: Uint8Array;
  insular: Uint8Array;
  pelagic: Uint8Array;
  logMass: Float32Array;
  breadth: Float32Array;
  range: Float32Array;
  depthPref: Float32Array;
  latPref: Float32Array;
  tOff: Float32Array;
  tTol: Float32Array;
  /** Lognormal abundance score (z) — stable per species. */
  abund: Float32Array;
  /** Background extinction rate multiplier (specialists / small ranges higher). */
  hBase: Float32Array;
  /** Per-stressor vulnerability, n × NS. */
  vuln: Float32Array;

  constructor(cap = 4096) {
    this.cap = cap;
    this.clade = new Uint16Array(cap);
    this.parent = new Int32Array(cap);
    this.birth = new Int32Array(cap);
    this.death = new Int32Array(cap);
    this.realm = new Uint8Array(cap);
    this.trophic = new Uint8Array(cap);
    this.hard = new Uint8Array(cap);
    this.mineral = new Uint8Array(cap);
    this.endo = new Uint8Array(cap);
    this.burrower = new Uint8Array(cap);
    this.insular = new Uint8Array(cap);
    this.pelagic = new Uint8Array(cap);
    this.logMass = new Float32Array(cap);
    this.breadth = new Float32Array(cap);
    this.range = new Float32Array(cap);
    this.depthPref = new Float32Array(cap);
    this.latPref = new Float32Array(cap);
    this.tOff = new Float32Array(cap);
    this.tTol = new Float32Array(cap);
    this.abund = new Float32Array(cap);
    this.hBase = new Float32Array(cap);
    this.vuln = new Float32Array(cap * NS);
  }

  private grow(): void {
    const c = this.cap * 2;
    const g = <A extends Float32Array | Uint8Array | Uint16Array | Int32Array>(a: A, k = 1): A => {
      const b = new (a.constructor as new (n: number) => A)(c * k);
      b.set(a);
      return b;
    };
    this.clade = g(this.clade); this.parent = g(this.parent); this.birth = g(this.birth); this.death = g(this.death);
    this.realm = g(this.realm); this.trophic = g(this.trophic); this.hard = g(this.hard); this.mineral = g(this.mineral);
    this.endo = g(this.endo); this.burrower = g(this.burrower); this.insular = g(this.insular); this.pelagic = g(this.pelagic);
    this.logMass = g(this.logMass); this.breadth = g(this.breadth); this.range = g(this.range);
    this.depthPref = g(this.depthPref); this.latPref = g(this.latPref); this.tOff = g(this.tOff); this.tTol = g(this.tTol);
    this.abund = g(this.abund); this.hBase = g(this.hBase); this.vuln = g(this.vuln, NS);
    this.cap = c;
  }

  /** Append a species; returns its id. Vulnerabilities are filled by the caller (stressors.ts). */
  push(clade: number, parent: number, birth: number, t: Traits, abund: number, hBase: number): number {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    this.clade[i] = clade; this.parent[i] = parent; this.birth[i] = birth; this.death[i] = ALIVE;
    this.realm[i] = t.realm; this.trophic[i] = t.trophic; this.hard[i] = t.hard; this.mineral[i] = t.mineral;
    this.endo[i] = t.endo; this.burrower[i] = t.burrower; this.insular[i] = t.insular; this.pelagic[i] = t.pelagic;
    this.logMass[i] = t.logMass; this.breadth[i] = t.breadth; this.range[i] = t.range;
    this.depthPref[i] = t.depthPref; this.latPref[i] = t.latPref; this.tOff[i] = t.tOff;
    this.tTol[i] = 4 + 6 * t.breadth;
    this.abund[i] = abund; this.hBase[i] = hBase;
    return i;
  }

  traitsOf(i: number): Traits {
    return {
      realm: this.realm[i], trophic: this.trophic[i], hard: this.hard[i], mineral: this.mineral[i], endo: this.endo[i],
      burrower: this.burrower[i], insular: this.insular[i], pelagic: this.pelagic[i], logMass: this.logMass[i],
      breadth: this.breadth[i], range: this.range[i], depthPref: this.depthPref[i], latPref: this.latPref[i], tOff: this.tOff[i],
    };
  }

  /** True if species i lived at any time between steps `a` and `b` inclusive. */
  aliveBetween(i: number, a: number, b: number): boolean {
    return this.birth[i] <= b && this.death[i] >= a;
  }

  /** Drop everything that is not alive, re-rooting survivors as founders of the record. */
  compactSurvivors(): void {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.death[i] !== ALIVE) continue;
      if (w !== i) this.copy(i, w);
      this.parent[w] = -1;
      this.birth[w] = BEFORE_RECORD;
      w++;
    }
    this.n = w;
  }

  private copy(from: number, to: number): void {
    this.clade[to] = this.clade[from]; this.parent[to] = this.parent[from]; this.birth[to] = this.birth[from]; this.death[to] = this.death[from];
    this.realm[to] = this.realm[from]; this.trophic[to] = this.trophic[from]; this.hard[to] = this.hard[from]; this.mineral[to] = this.mineral[from];
    this.endo[to] = this.endo[from]; this.burrower[to] = this.burrower[from]; this.insular[to] = this.insular[from]; this.pelagic[to] = this.pelagic[from];
    this.logMass[to] = this.logMass[from]; this.breadth[to] = this.breadth[from]; this.range[to] = this.range[from];
    this.depthPref[to] = this.depthPref[from]; this.latPref[to] = this.latPref[from]; this.tOff[to] = this.tOff[from]; this.tTol[to] = this.tTol[from];
    this.abund[to] = this.abund[from]; this.hBase[to] = this.hBase[from];
    for (let k = 0; k < NS; k++) this.vuln[to * NS + k] = this.vuln[from * NS + k];
  }
}

const SYL = ['ka', 'vo', 'ra', 'thi', 'mur', 'el', 'zan', 'ori', 'qua', 'dre', 'sel', 'nu', 'bai', 'lor', 'tek', 'yr'];
/** Deterministic pseudo-latin name for a species (stable across runs; the player sees these as morphotype labels). */
export function speciesName(cladeName: string, id: number): string {
  let h = (id * 2654435761) >>> 0;
  let s = '';
  for (let k = 0; k < 2; k++) { s += SYL[h & 15]; h >>>= 4; }
  return `${cladeName} ${s}${(id % 97) + 1}`;
}
