/**
 * What a geologist sees in a core: rock type, composition estimates and field notes — derived from the
 * layer's composition, never its facies label, age or tracer masses (with one exception: texture of glacial
 * diamict, which a geologist sees directly).
 */
import { LITH } from '../shared/lithology';
import { Bed } from '../shared/protocol';
import { hashNormal, hashUnit } from '../shared/rng';
import { FLAG } from '../truth/strat/column';
import { F } from '../truth/strat/facies';
import { KG_C_PER_M_ORGANIC, NT, T, massOf, solidOf } from '../truth/strat/tracers';
import { ColumnView } from './columnview';

export interface Composition {
  lith: number;
  carbonatePct: number;
  sandPct: number;
  organicPct: number;
}

/** Classify the rock represented by a tracer vector (offset `o` into `tr`). */
export function classify(tr: ArrayLike<number>, o: number, facies: number): Composition {
  const solid = Math.max(solidOf(tr, o), 1e-12);
  const clastic = tr[o + T.clastic];
  const fCarb = tr[o + T.caco3] / solid;
  const fEvap = tr[o + T.evap] / solid;
  const fAsh = tr[o + T.ash] / solid;
  const fOrg = tr[o + T.orgC] / KG_C_PER_M_ORGANIC / solid;
  const sandFrac = clastic > 0 ? tr[o + T.sand] / clastic : 0;
  const mass = massOf(tr, o);
  const comp = {
    carbonatePct: (100 * tr[o + T.caco3] * 2710) / Math.max(mass, 1e-9),
    sandPct: (100 * tr[o + T.sand] * 2700) / Math.max(mass, 1e-9),
    organicPct: (100 * tr[o + T.orgC] * 2) / Math.max(mass, 1e-9),
  };
  let lith: number;
  if (fAsh > 0.5) lith = LITH['tuff (volcanic ash)'];
  else if (fEvap > 0.5) lith = LITH.evaporite;
  else if (fOrg > 0.25) lith = LITH.coal;
  else if (fOrg > 0.06) lith = LITH['black shale'];
  else if (fCarb > 0.65) lith = LITH.limestone;
  else if (fCarb > 0.25) lith = LITH.marl;
  else if (facies === F.glacial) lith = LITH.diamictite;
  else if (sandFrac > 0.65) lith = LITH.sandstone;
  else if (sandFrac > 0.3) lith = LITH['muddy sandstone'];
  else lith = LITH.mudstone;
  return { lith, ...comp };
}

/** Beds of a column between depths [z0, z1] (true depths), merged where adjacent layers look alike. */
export type RawBed = Omit<Bed, 'topM' | 'baseM'> & { z0: number; z1: number };

export function bedsBetween(v: ColumnView, z0: number, z1: number, seed: string, cell: number): RawBed[] {
  const out: (RawBed & { w: number })[] = [];
  const col = v.col;
  for (let i = col.n - 1; i >= 0; i--) {
    const a = v.top[i], b = v.top[i] + v.thick[i];
    if (b <= z0) continue;
    if (a >= z1) break;
    const lo = Math.max(a, z0), hi = Math.min(b, z1);
    const comp = classify(col.tr, i * NT, col.facies[i]);
    const flags = col.flags[i];
    const notes: string[] = [];
    if (flags & FLAG.ASH) notes.push('volcanic ash bed');
    if ((flags & FLAG.EJECTA) && v.thick[i] < 0.6) notes.push('thin clay-rich layer');
    if (flags & FLAG.TSUNAMI) notes.push('chaotic graded sand bed');
    if (flags & FLAG.LAGERSTATTE) notes.push('finely laminated, soft-tissue fossils');
    const prev = out[out.length - 1];
    const sameLook = prev && prev.lith === comp.lith && notes.length === 0 && prev.notes.length === 0;
    const sharp = (flags & FLAG.HIATUS) !== 0 && hashUnit(seed, 'contact', cell, i) < 0.6;
    if (sameLook && !sharp) {
      const wt = hi - lo;
      prev.carbonatePct = (prev.carbonatePct * prev.w + comp.carbonatePct * wt) / (prev.w + wt);
      prev.sandPct = (prev.sandPct * prev.w + comp.sandPct * wt) / (prev.w + wt);
      prev.organicPct = (prev.organicPct * prev.w + comp.organicPct * wt) / (prev.w + wt);
      prev.w += wt;
      prev.z1 = hi;
      continue;
    }
    out.push({
      z0: lo, z1: hi, w: hi - lo, lith: comp.lith,
      carbonatePct: comp.carbonatePct, sandPct: comp.sandPct, organicPct: comp.organicPct,
      contact: sharp ? 'sharp' : 'gradational', notes: sharp ? [...notes, 'sharp contact'] : notes,
    });
  }
  // visual estimates are only good to a few percent
  for (const b of out) {
    const e = (k: string) => 4 * hashNormal(seed, 'est', cell, Math.round(b.z0 * 100), k);
    b.carbonatePct = Math.max(0, Math.min(100, b.carbonatePct + e('c')));
    b.sandPct = Math.max(0, Math.min(100, b.sandPct + e('s')));
    b.organicPct = Math.max(0, b.organicPct + 0.3 * e('o'));
  }
  return out;
}
