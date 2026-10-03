/**
 * Features of an anomaly, as an IDEAL observer would measure them (design D5): unlimited budget, optimal site
 * choice, noise-free instruments. For a time window [t0, t1] (Ma, t0 older) we compare, column by column, the
 * extreme value of each proxy inside the window with its baseline just before, then aggregate across columns with
 * a high percentile ("a good section"). Extinction selectivity comes from the fossilisable part of the species table.
 *
 * These are the same quantities whether the cause was a civilization or a natural event; the signature library
 * tells us what each cause typically looks like in them.
 */
import { Rng, hash32 } from '../../shared/rng';
import { stepAtAge } from '../../shared/timeplan';
import { ColumnStore } from '../../truth/strat/column';
import { NT, T, massOf, solidOf } from '../../truth/strat/tracers';
import { HARD, REALM } from '../../truth/bio/traits';
import { World } from '../../truth/world';

export const FEATURES = ['cie', 'd18O', 'hgToc', 'ir', 'charcoal', 'persist', 'd15N', 'sed', 'ash', 'ext', 'extBig', 'extIns', 'extCalc', 'fwhm'] as const;
export type FeatureName = (typeof FEATURES)[number];
export type Features = Record<FeatureName, number>; // NaN = not measurable

/** Layers of a column whose mean age lies in [young, old] (ageMean decreases with index). */
function ageRange(col: ColumnStore, old: number, young: number): [number, number] {
  let lo = 0, hi = col.n; // first index with ageMean <= old
  while (lo < hi) { const m = (lo + hi) >> 1; if (col.ageMean[m] > old) lo = m + 1; else hi = m; }
  const i0 = lo;
  lo = i0; hi = col.n; // first index with ageMean < young
  while (lo < hi) { const m = (lo + hi) >> 1; if (col.ageMean[m] >= young) lo = m + 1; else hi = m; }
  return [i0, lo]; // [i0, lo)
}

const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a: number[], p: number): number => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const log10 = (x: number): number => Math.log10(Math.max(x, 1e-12));

interface LayerQ {
  d13c: number; d13o: number; d13: number; d18: number; hgToc: number; ir: number; charcoal: number; persist: number; d15N: number; sedFrac: number; ash: number; age: number;
}

function layerQ(col: ColumnStore, i: number): LayerQ {
  const o = i * NT;
  const tr = col.tr;
  const mass = Math.max(massOf(tr, o), 1e-9);
  const solid = Math.max(solidOf(tr, o), 1e-12);
  const caco3 = tr[o + T.caco3], org = tr[o + T.orgC];
  const hasC = caco3 / solid > 0.05;
  const toc = (org * 2) / mass * 100;
  const clastic = tr[o + T.clastic];
  return {
    d13c: hasC ? tr[o + T.d13C_carb] / caco3 : NaN,
    d13o: org / solid > 1e-4 ? tr[o + T.d13C_org] / org : NaN,
    d13: NaN,
    d18: hasC ? tr[o + T.d18O_carb] / caco3 : NaN,
    hgToc: tr[o + T.Hg] / mass / Math.max(toc, 0.05),
    ir: tr[o + T.Ir] / (mass * 1000),
    charcoal: (tr[o + T.charcoal] * 1000) / mass,
    persist: tr[o + T.persistOrg] / mass,
    d15N: org / solid > 1e-4 ? tr[o + T.d15N] / org : NaN,
    sedFrac: caco3 > 1e-6 ? clastic / (clastic + caco3) : NaN,
    ash: tr[o + T.ash] / solid,
    age: col.ageMean[i],
  };
}

/** A fixed random order of the columns of a world (computed once per world). */
const ORDERS = new WeakMap<World, number[]>();
function columnOrder(world: World, rng: Rng): number[] {
  let o = ORDERS.get(world);
  if (!o) {
    o = Array.from({ length: world.strat.columns.length }, (_, i) => i);
    for (let i = o.length - 1; i > 0; i--) { const j = rng.int(i + 1); [o[i], o[j]] = [o[j], o[i]]; }
    ORDERS.set(world, o);
  }
  return o;
}

export function extractFeatures(world: World, t0: number, t1: number, maxColumns = 120): Features {
  const out = Object.fromEntries(FEATURES.map((f) => [f, NaN])) as Features;
  const cols = world.strat.columns;
  const rng = new Rng(`features|${world.config.seed}|${t0.toFixed(4)}`);
  const winOld = t0 + 0.25, winYoung = t1 - 0.05;
  const baseOld = t0 + 1.2, baseYoung = t0 + 0.3;

  // sample columns that have rock on both sides of the event
  const order = columnOrder(world, rng);
  const per: Record<string, number[]> = { cie: [], d18O: [], hgToc: [], ir: [], charcoal: [], persist: [], d15N: [], sed: [], ash: [], fwhm: [] };
  let used = 0;
  for (const ci of order) {
    if (used >= maxColumns) break;
    const col = cols[ci];
    if (col.n < 6) continue;
    const [w0, w1] = ageRange(col, winOld, winYoung);
    const [b0, b1] = ageRange(col, baseOld, baseYoung);
    if (w1 - w0 < 1 || b1 - b0 < 2) continue;
    used++;
    const W: LayerQ[] = [], B: LayerQ[] = [];
    for (let i = w0; i < w1; i++) W.push(layerQ(col, i));
    for (let i = b0; i < b1; i++) B.push(layerQ(col, i));
    // carbon isotopes: carbonate where the section has it, otherwise organic matter (same excursion, different offset)
    const useCarb = B.filter((q) => !Number.isNaN(q.d13c)).length >= 2;
    for (const q of W) q.d13 = useCarb ? q.d13c : q.d13o;
    for (const q of B) q.d13 = useCarb ? q.d13c : q.d13o;
    const base = (f: (q: LayerQ) => number) => { const v = B.map(f).filter((x) => !Number.isNaN(x)); return v.length >= 2 ? median(v) : NaN; };
    const win = (f: (q: LayerQ) => number) => W.map(f).filter((x) => !Number.isNaN(x));

    const d13b = base((q) => q.d13), d13w = win((q) => q.d13);
    if (!Number.isNaN(d13b) && d13w.length) {
      const dmin = Math.min(...d13w);
      per.cie.push(dmin - d13b);
      const qMin = W.find((q) => q.d13 === dmin)!;
      const d18b = base((q) => q.d18);
      if (!Number.isNaN(d18b) && !Number.isNaN(qMin.d18)) per.d18O.push(qMin.d18 - d18b);
      if (dmin - d13b < -0.4) { // width of the excursion at half depth, in Myr, from layer ages
        const half = d13b + 0.5 * (dmin - d13b);
        const ages = W.filter((q) => q.d13 <= half).map((q) => q.age);
        if (ages.length) per.fwhm.push(log10(Math.max(Math.max(...ages) - Math.min(...ages), 0.002)));
      }
    }
    // peak in the window over the baseline median, with a floor of 10 % of the baseline (and a small absolute floor)
    const ratio = (key: 'hgToc' | 'ir' | 'charcoal' | 'persist' | 'ash', absFloor: number) => {
      const b = base((q) => q[key]);
      const w = win((q) => q[key]);
      if (Number.isNaN(b) || !w.length) return;
      const floor = Math.max(0.1 * b, absFloor);
      per[key].push(log10((Math.max(...w) + floor) / (b + floor)));
    };
    ratio('hgToc', 1e-6); ratio('ir', 0.005); ratio('charcoal', 1e-6); ratio('persist', 1e-9); ratio('ash', 1e-5);

    const d15b = base((q) => q.d15N), d15w = win((q) => q.d15N);
    if (!Number.isNaN(d15b) && d15w.length) per.d15N.push(d15w.reduce((a, b) => a + b, 0) / d15w.length - d15b);
    const sb = base((q) => q.sedFrac), sw = win((q) => q.sedFrac);
    if (!Number.isNaN(sb) && sw.length) per.sed.push(Math.max(...sw) - sb);
  }

  const agg = (v: number[], p: number): number => (v.length >= 3 ? pct(v, p) : NaN);
  out.cie = agg(per.cie, 0.2); //          the more negative, the better the section
  out.d18O = agg(per.d18O, 0.5);
  out.hgToc = agg(per.hgToc, 0.8);
  out.ir = agg(per.ir, 0.8);
  out.charcoal = agg(per.charcoal, 0.8);
  out.persist = agg(per.persist, 0.8);
  out.d15N = agg(per.d15N, 0.5);
  out.sed = agg(per.sed, 0.8);
  out.ash = agg(per.ash, 0.8);
  out.fwhm = agg(per.fwhm, 0.5);

  Object.assign(out, extinctionFeatures(world, t0, t1));
  return out;
}

/** Selectivity of the extinction coincident with the event, among species a palaeontologist can actually find. */
function extinctionFeatures(world: World, t0: number, t1: number): Pick<Features, 'ext' | 'extBig' | 'extIns' | 'extCalc'> {
  const nan = { ext: NaN, extBig: NaN, extIns: NaN, extCalc: NaN };
  const plan = world.plan, sp = world.bio.species;
  const sA = Math.max(1, stepAtAge(plan, t0 - 1e-7));
  const sB = Math.min(plan.n - 1, stepAtAge(plan, t1 - 1e-7) + 2);
  const fossilisable = (i: number) => sp.hard[i] === HARD.carbonate || sp.hard[i] === HARD.phosphate || sp.hard[i] === HARD.silica;
  const counts = { all: [0, 0], big: [0, 0], notBig: [0, 0], ins: [0, 0], notIns: [0, 0], calc: [0, 0], notCalc: [0, 0] };
  const add = (g: number[], died: boolean) => { g[died ? 1 : 0]++; };
  for (let i = 0; i < sp.n; i++) {
    if (!fossilisable(i) || sp.birth[i] > sA - 1 || sp.death[i] < sA) continue; // alive going into the event
    const died = sp.death[i] <= sB;
    add(counts.all, died);
    const big = sp.realm[i] === REALM.terrestrial && sp.logMass[i] > 3.5;
    add(big ? counts.big : counts.notBig, died);
    if (sp.realm[i] === REALM.terrestrial) add(sp.insular[i] ? counts.ins : counts.notIns, died);
    if (sp.realm[i] === REALM.marine) add(sp.mineral[i] > 0 ? counts.calc : counts.notCalc, died);
  }
  const frac = (g: number[]) => g[1] / Math.max(1, g[0] + g[1]);
  const lor = (a: number[], b: number[]) => (a[0] + a[1] < 3 || b[0] + b[1] < 3 ? NaN : Math.log(((a[1] + 0.5) / (a[0] + 0.5)) / ((b[1] + 0.5) / (b[0] + 0.5))));
  if (counts.all[0] + counts.all[1] < 20) return nan;
  // selectivity is only measurable when enough species actually died
  if (counts.all[1] < 6) return { ext: frac(counts.all), extBig: NaN, extIns: NaN, extCalc: NaN };
  return { ext: frac(counts.all), extBig: lor(counts.big, counts.notBig), extIns: lor(counts.ins, counts.notIns), extCalc: lor(counts.calc, counts.notCalc) };
}

export function featureHash(f: Features): number {
  let h = 0;
  for (const k of FEATURES) h = hash32(h, Number.isNaN(f[k]) ? -999 : f[k]);
  return h;
}
