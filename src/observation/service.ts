/**
 * The observation service: the ONLY interface between the hidden world and the player (design Layer 2).
 *
 * It sells measurements for budget. Each answer is a pure function of (world seed, action): the same core
 * request or the same assay at the same depth returns the same numbers however the player got there, and
 * asking again is free. It returns rock descriptions and lab numbers — never facies labels, ages, tracer
 * masses or event labels.
 */
import { LITH } from '../shared/lithology';
import { Action, AssayResult, AssaySample, CoreResult, DateResult, ErrorCode, FossilResult, Measurement, Morphotype, PublicInfo } from '../shared/protocol';
import { PROXIES, PROXY_IDS } from '../shared/proxies';
import { Rng, hashNormal, hashUnit } from '../shared/rng';
import { stepAtAge } from '../shared/timeplan';
import { drawAssemblage } from '../truth/bio/taphonomy';
import { EnvContext } from '../truth/bio/community';
import { decodeDepth, decodeLat, decodeO2, decodeSedRate, ENV } from '../truth/strat/envcode';
import { FLAG } from '../truth/strat/column';
import { StratWorld } from '../truth/strat/simulate';
import { NT, T, solidOf } from '../truth/strat/tracers';
import { World } from '../truth/world';
import { ColumnView, buildColumnView, forEachOverlap } from './columnview';
import { measureProxy } from './instruments';
import { bedsBetween, classify } from './lithology';
import { describe } from './morphotypes';

export const DRILL = { base: 5, perMeter: 0.02, offshoreFactor: 3, maxCoreM: 1500, basementPenetrationM: 3 };
export const SURVEY = { base: 2, perMeter: 0.01 };
export const DATE_COST = 15;
export const FOSSIL_COST_PER_EFFORT = 3;
const FOSSIL_INDIVIDUALS = 800;  // individuals-equivalent of the death assemblage processed per unit of effort
const SAMPLE_HALF_M = 0.03; // each sample integrates a 6-cm interval
const MAX_SAMPLES = 400;

export type ActResult = { ok: true; measurement: Measurement } | { ok: false; code: ErrorCode; message: string };

interface CoreRecord {
  id: string;
  cell: number;
  source: 'core' | 'outcrop';
  /** Outcrop rock is weathered: organics oxidised, pyrite lost, isotopes noisier. */
  weathered: boolean;
  /** Overburden removed since the rock was last at maximum burial (drives diagenesis), m. */
  exhumedM: number;
  view: ColumnView;
  /** Depth-scale error: reported depth = true depth × stretch. */
  stretch: number;
  /** True drilled length, m (rock + any basement penetration). */
  lengthTrue: number;
  rockTrue: number;
  gaps: { z0: number; z1: number }[];
}

export class ObservationService {
  budget: number;
  private readonly world: World;
  private readonly seed: string;
  private readonly views = new Map<number, ColumnView>();
  private readonly cores = new Map<string, CoreRecord>();
  private readonly coreMeasurements = new Map<string, CoreResult>();
  private readonly assays = new Map<string, AssayResult>();
  private readonly dates = new Map<string, DateResult>();
  private readonly fossils = new Map<string, FossilResult>();
  private exhumed: Float64Array | null = null;
  private readonly noiseScale: number;

  constructor(world: World) {
    this.world = world;
    this.seed = world.config.seed;
    this.budget = world.config.difficulty.budget;
    this.noiseScale = world.config.difficulty.noiseScale;
  }

  // ---------------------------------------------------------------------------------------------
  // Free information: the map
  // ---------------------------------------------------------------------------------------------

  publicInfo(): PublicInfo {
    const s: StratWorld = this.world.strat;
    const n = s.nx * s.ny;
    const elevationM = new Float32Array(n);
    const surfaceClass = new Uint8Array(n);
    const exposure = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      elevationM[i] = s.surface[i] - s.seaLevelNow + 3 * hashNormal(this.seed, 'topo', i);
      const col = s.columns[i];
      let lith = LITH['crystalline basement'];
      if (col.n > 0) lith = classify(col.tr, (col.n - 1) * NT, col.facies[col.n - 1]).lith;
      // remote sensing is sometimes wrong: mostly in whole patches (cloud, vegetation, a mis-registered scene), a little cell by cell
      const bx = Math.floor((i % s.nx) / 3), by = Math.floor(Math.floor(i / s.nx) / 3);
      const patchBad = hashUnit(this.seed, 'recon-patch', by * 1000 + bx) < 0.10;
      if (patchBad ? hashUnit(this.seed, 'recon', i) < 0.7 : hashUnit(this.seed, 'recon', i) < 0.06) lith = Math.floor(hashUnit(this.seed, 'recon-alt', i) * 10);
      surfaceClass[i] = lith;
      const e = 0.15 + 0.5 * Math.min(1, s.relief[i] / 100) + 0.35 * Math.min(1, (s.erosionRate[i] * 1e6) / 50);
      exposure[i] = Math.round(100 * Math.min(1, Math.max(0, e + 0.05 * hashNormal(this.seed, 'expo', i))));
    }
    return {
      nx: s.nx, ny: s.ny, cellKm: s.cellKm, elevationM, surfaceClass, exposure,
      budget: this.world.config.difficulty.budget, maxCoreM: DRILL.maxCoreM,
      drillCost: { base: DRILL.base, perMeter: DRILL.perMeter, offshoreFactor: DRILL.offshoreFactor },
      costs: { survey: { base: SURVEY.base, perMeter: SURVEY.perMeter }, date: DATE_COST, fossilsPerEffort: FOSSIL_COST_PER_EFFORT },
      proxies: PROXY_IDS.map((id) => PROXIES[id]),
    };
  }

  /** Depth-scale stretch of a section (reported depth = true depth × stretch). For tests and tooling that need to place samples exactly. */
  coreStretch(coreId: string): number | undefined {
    return this.cores.get(coreId)?.stretch;
  }

  // ---------------------------------------------------------------------------------------------
  // Paid actions
  // ---------------------------------------------------------------------------------------------

  execute(a: Action): ActResult {
    switch (a.kind) {
      case 'drill': return this.drill(a.cell, a.depthM);
      case 'survey': return this.survey(a.cell);
      case 'assay': return this.assay(a.coreId, a.proxy, a.depthsM);
      case 'date': return this.date(a.coreId, a.depthM);
      case 'fossils': return this.fossilSample(a.coreId, a.depthM, a.effort);
      default: return fail('bad_request', 'unknown action');
    }
  }

  private view(cell: number): ColumnView {
    let v = this.views.get(cell);
    if (!v) { v = buildColumnView(this.world.strat.columns[cell]); this.views.set(cell, v); }
    return v;
  }

  /** Overburden (m, compacted) stripped off each cell since its rock was last at maximum burial: the rock was buried deeper than it is now. */
  private overburden(cell: number): number {
    if (!this.exhumed) {
      const s = this.world.strat, e = s.erased;
      this.exhumed = new Float64Array(s.nx * s.ny);
      for (let k = 0; k < e.n; k++) {
        const c = e.cell[k];
        if (e.stepStart[k] > s.columns[c].lastDepositStep) this.exhumed[c] += e.thickness[k] * 1.3;
      }
    }
    return this.exhumed[cell];
  }

  /** Lost / covered intervals along a section: gaps of mean length ~`meanLen` covering about `fraction` of it. */
  private gapsFor(key: string, length: number, fraction: number, meanLen: number, start: number): { z0: number; z1: number }[] {
    const r = new Rng(`${this.seed}|gaps|${key}`);
    const spacing = (meanLen * (1 - fraction)) / Math.max(fraction, 1e-3);
    const gaps: { z0: number; z1: number }[] = [];
    let p = start;
    for (;;) {
      p += -Math.log(1 - r.next()) * spacing;
      if (p >= length) break;
      const len = meanLen * (0.4 + 1.2 * r.next());
      gaps.push({ z0: p, z1: Math.min(p + len, length) });
      p += len;
    }
    return gaps;
  }

  /** Describe a section's beds (cut by gaps) and register it for later assays, dates and fossil samples. */
  private makeSection(rec: CoreRecord, requestedM: number, cost: number): CoreResult {
    const { view, stretch, lengthTrue, rockTrue, gaps } = rec;
    const rawBeds = bedsBetween(view, 0, Math.min(lengthTrue, rockTrue), this.seed, rec.cell);
    const beds: CoreResult['beds'] = [];
    const cut = (z0: number, z1: number): [number, number][] => {
      let pieces: [number, number][] = [[z0, z1]];
      for (const g of gaps) pieces = pieces.flatMap(([a, b]) => (g.z1 <= a || g.z0 >= b ? [[a, b] as [number, number]] : [[a, Math.min(b, g.z0)], [Math.max(a, g.z1), b]].filter(([x, y]) => y - x > 1e-4) as [number, number][]));
      return pieces;
    };
    for (const b of rawBeds) for (const [z0, z1] of cut(b.z0, b.z1)) {
      beds.push({ topM: z0 * stretch, baseM: z1 * stretch, lith: b.lith, carbonatePct: b.carbonatePct, sandPct: b.sandPct, organicPct: b.organicPct, contact: b.contact, notes: b.notes });
    }
    const reachedBasement = lengthTrue > rockTrue + 1e-9 || rockTrue === 0;
    if (reachedBasement) {
      beds.push({ topM: rockTrue * stretch, baseM: lengthTrue * stretch, lith: LITH['crystalline basement'], carbonatePct: 0, sandPct: 0, organicPct: 0, contact: 'sharp', notes: ['unconformity on crystalline basement'] });
    }
    this.cores.set(rec.id, rec);
    return {
      kind: 'core', source: rec.source, coreId: rec.id, cell: rec.cell, requestedM, lengthM: lengthTrue * stretch, reachedBasement, beds,
      gaps: gaps.map((g) => ({ topM: g.z0 * stretch, baseM: g.z1 * stretch })), cost, budgetLeft: this.budget,
    };
  }

  private drill(cell: number, depthM: number): ActResult {
    const s = this.world.strat;
    if (!Number.isInteger(cell) || cell < 0 || cell >= s.nx * s.ny) return fail('out_of_range', 'no such cell');
    if (!(depthM >= 1) || depthM > DRILL.maxCoreM) return fail('out_of_range', `core depth must be 1–${DRILL.maxCoreM} m`);
    const id = `core-${cell}-${Math.round(depthM)}`;
    const known = this.coreMeasurements.get(id);
    if (known) return { ok: true, measurement: { ...known, cost: 0, budgetLeft: this.budget } };

    const view = this.view(cell);
    const rock = view.total;
    const lengthTrue = Math.min(depthM, rock + DRILL.basementPenetrationM);
    const offshore = s.surface[cell] < s.seaLevelNow;
    const cost = (DRILL.base + DRILL.perMeter * lengthTrue) * (offshore ? DRILL.offshoreFactor : 1);
    if (cost > this.budget + 1e-9) return fail('insufficient_budget', `needs ${cost.toFixed(1)}, have ${this.budget.toFixed(1)}`);

    const stretch = 1 + 0.004 * hashNormal(this.seed, 'stretch', cell, Math.round(depthM));
    // core loss: on average a ~0.5 m gap every ~11 m (≈ 8 % lost)
    const gaps = this.gapsFor(id, lengthTrue, 0.045, 0.5, 0.5);
    this.budget -= cost;
    const result = this.makeSection({ id, cell, source: 'core', weathered: false, exhumedM: this.overburden(cell), view, stretch, lengthTrue, rockTrue: rock, gaps }, depthM, cost);
    this.coreMeasurements.set(id, result);
    return { ok: true, measurement: result };
  }

  private survey(cell: number): ActResult {
    const s = this.world.strat;
    if (!Number.isInteger(cell) || cell < 0 || cell >= s.nx * s.ny) return fail('out_of_range', 'no such cell');
    if (s.surface[cell] < s.seaLevelNow) return fail('out_of_range', 'no outcrops on the sea floor');
    const id = `out-${cell}`;
    const known = this.coreMeasurements.get(id);
    if (known) return { ok: true, measurement: { ...known, cost: 0, budgetLeft: this.budget } };

    const view = this.view(cell);
    // true exposure of this cell: relief and erosion expose rock; flat, slowly eroding ground is covered by soil and plants
    const e = Math.min(1, Math.max(0.05, 0.15 + 0.5 * Math.min(1, s.relief[cell] / 100) + 0.35 * Math.min(1, (s.erosionRate[cell] * 1e6) / 50)));
    const exposedM = Math.min(250, Math.max(3, (4 + 1.2 * s.relief[cell] + 2 * s.erosionRate[cell] * 1e6) * (0.4 + 0.6 * e)));
    const rockTrue = Math.min(exposedM, view.total);
    const lengthTrue = view.total > 0 ? rockTrue : 3;
    const cost = SURVEY.base + SURVEY.perMeter * lengthTrue;
    if (cost > this.budget + 1e-9) return fail('insufficient_budget', `needs ${cost.toFixed(1)}, have ${this.budget.toFixed(1)}`);
    const stretch = 1 + 0.001 * hashNormal(this.seed, 'tape', cell); // measured with a tape: nearly exact
    const covered = this.gapsFor(id, lengthTrue, 0.6 * (1 - e) + 0.03, 1.5, 0);
    this.budget -= cost;
    const result = this.makeSection({ id, cell, source: 'outcrop', weathered: true, exhumedM: this.overburden(cell), view, stretch, lengthTrue, rockTrue, gaps: covered }, lengthTrue, cost);
    this.coreMeasurements.set(id, result);
    return { ok: true, measurement: result };
  }

  /** Composition of the 6-cm sample at reported depth `d` (null with the reason if there is nothing to sample). */
  private sampleAt(core: CoreRecord, d: number): { acc: Float64Array; age: number; layer: number; t: number } | 'out of range' | 'lost core' {
    const t = d / core.stretch;
    if (!(t >= 0) || t > Math.min(core.lengthTrue, core.rockTrue)) return 'out of range';
    if (core.gaps.some((g) => t >= g.z0 && t <= g.z1)) return 'lost core';
    const v = core.view, col = v.col;
    const acc = new Float64Array(NT);
    let age = 0, w = 0, bestOv = -1, layer = -1;
    forEachOverlap(v, t - SAMPLE_HALF_M, t + SAMPLE_HALF_M, (i, ov) => {
      const f = ov / v.thick[i];
      for (let k = 0; k < NT; k++) acc[k] += col.tr[i * NT + k] * f;
      age += col.ageMean[i] * ov; w += ov;
      if (ov > bestOv) { bestOv = ov; layer = i; }
    });
    if (w <= 0) return 'out of range';
    return { acc, age: age / w, layer, t };
  }

  private assay(coreId: string, proxy: (typeof PROXY_IDS)[number], depthsM: number[]): ActResult {
    const core = this.cores.get(coreId);
    if (!core) return fail('unknown_core', 'no such core — drill or survey first');
    if (!PROXIES[proxy]) return fail('bad_request', 'unknown proxy');
    if (!Array.isArray(depthsM) || depthsM.length === 0 || depthsM.length > MAX_SAMPLES) return fail('bad_request', `request 1–${MAX_SAMPLES} samples`);
    const key = `${coreId}|${proxy}|${depthsM.map((d) => Math.round(d * 100)).join(',')}`;
    const known = this.assays.get(key);
    if (known) return { ok: true, measurement: { ...known, cost: 0, budgetLeft: this.budget } };

    const cost = depthsM.length * PROXIES[proxy].cost;
    if (cost > this.budget + 1e-9) return fail('insufficient_budget', `needs ${cost}, have ${this.budget.toFixed(1)}`);

    const samples: AssaySample[] = depthsM.map((d) => {
      const s = this.sampleAt(core, d);
      if (typeof s === 'string') return { depthM: d, value: null, sigma: 0, note: s };
      const r = measureProxy(proxy, s.acc, { seed: this.seed, noiseScale: this.noiseScale, cell: core.cell, depthKey: Math.round(d * 100), ageMa: s.age, burialM: s.t + core.exhumedM, weathered: core.weathered });
      return { depthM: d, value: r.value, sigma: r.sigma, note: r.note };
    });
    this.budget -= cost;
    const result: AssayResult = { kind: 'assay', coreId, proxy, samples, cost, budgetLeft: this.budget };
    this.assays.set(key, result);
    return { ok: true, measurement: result };
  }

  /** U–Pb dating of zircons from an ash-bearing sample. Needs at least ~2 % ash. */
  private date(coreId: string, depthM: number): ActResult {
    const core = this.cores.get(coreId);
    if (!core) return fail('unknown_core', 'no such core — drill or survey first');
    const key = `${coreId}|${Math.round(depthM * 100)}`;
    const known = this.dates.get(key);
    if (known) return { ok: true, measurement: { ...known, cost: 0, budgetLeft: this.budget } };
    if (DATE_COST > this.budget + 1e-9) return fail('insufficient_budget', `needs ${DATE_COST}, have ${this.budget.toFixed(1)}`);

    const s = this.sampleAt(core, depthM);
    let result: DateResult;
    if (typeof s === 'string') {
      result = { kind: 'date', coreId, depthM, ageMa: null, sigmaMa: 0, note: s, cost: 0, budgetLeft: this.budget };
    } else {
      const ash = s.acc[T.ash], solid = solidOf(s.acc);
      if (ash / Math.max(solid, 1e-12) < 0.02 || ash < 1e-4) {
        result = { kind: 'date', coreId, depthM, ageMa: null, sigmaMa: 0, note: 'no datable ash', cost: 0, budgetLeft: this.budget };
      } else {
        const trueAge = s.acc[T.ashAge] / ash; // zircons carry the eruption age (a blend if several eruptions are mixed)
        const sigma = 0.001 * trueAge + 0.005;
        const u = hashUnit(this.seed, 'zircon', core.cell, Math.round(depthM * 100));
        let age = trueAge;
        if (u < 0.05) age *= 1 + (0.01 + 0.05 * hashUnit(this.seed, 'inherit', core.cell, Math.round(depthM * 100))); //   inherited older zircons
        else if (u < 0.1) age *= 1 - (0.01 + 0.07 * hashUnit(this.seed, 'pbloss', core.cell, Math.round(depthM * 100))); // lead loss: too young
        age *= 1 + 0.001 * hashNormal(this.seed, 'decay-constant'); // systematic, shared by every date in this world
        age += sigma * hashNormal(this.seed, 'u-pb', core.cell, Math.round(depthM * 100));
        result = { kind: 'date', coreId, depthM, ageMa: Math.max(age, 0), sigmaMa: sigma, cost: 0, budgetLeft: this.budget };
      }
    }
    this.budget -= DATE_COST;
    result = { ...result, cost: DATE_COST, budgetLeft: this.budget };
    this.dates.set(key, result);
    return { ok: true, measurement: result };
  }

  /** Collect and identify fossils from a sample of rock. */
  private fossilSample(coreId: string, depthM: number, effort: number): ActResult {
    const core = this.cores.get(coreId);
    if (!core) return fail('unknown_core', 'no such core — drill or survey first');
    const eff = Math.round(effort);
    if (!(eff >= 1 && eff <= 4)) return fail('bad_request', 'effort must be 1–4');
    const key = `${coreId}|${Math.round(depthM * 100)}|${eff}`;
    const known = this.fossils.get(key);
    if (known) return { ok: true, measurement: { ...known, cost: 0, budgetLeft: this.budget } };
    const cost = FOSSIL_COST_PER_EFFORT * eff;
    if (cost > this.budget + 1e-9) return fail('insufficient_budget', `needs ${cost}, have ${this.budget.toFixed(1)}`);

    const s = this.sampleAt(core, depthM);
    let found: Morphotype[] = [];
    let note: FossilResult['note'];
    if (typeof s === 'string') note = s;
    else {
      const col = core.view.col, i = s.layer;
      const bio = this.world.bio, plan = this.world.plan;
      const sigma = col.ageSigma[i];
      const ctx: EnvContext = {
        facies: col.facies[i], waterDepthM: decodeDepth(col.env[i * 4 + ENV.DEPTH]), bottomO2: decodeO2(col.env[i * 4 + ENV.O2]),
        latDeg: decodeLat(col.env[i * 4 + ENV.LAT]), sedRateMPerMyr: decodeSedRate(col.env[i * 4 + ENV.SEDRATE]),
        burialDepthM: s.t + core.exhumedM, ageMa: s.age, lagerstatte: (col.flags[i] & FLAG.LAGERSTATTE) !== 0,
      };
      const sFrom = stepAtAge(plan, s.age + sigma), sTo = stepAtAge(plan, Math.max(s.age - sigma, 0));
      const specimens = drawAssemblage(bio, Math.min(sFrom, sTo), Math.max(sFrom, sTo), ctx, FOSSIL_INDIVIDUALS * eff, `${this.seed}|${core.cell}|${Math.round(depthM * 100)}|${eff}`);
      // lump species into the forms a palaeontologist can tell apart
      const byName = new Map<string, Morphotype>();
      for (const sp of specimens) {
        const m = describe(bio, sp.species, sp.count);
        const prev = byName.get(m.name);
        if (prev) prev.count += m.count; else byName.set(m.name, m);
      }
      found = [...byName.values()].sort((a, b) => b.count - a.count);
    }
    this.budget -= cost;
    const result: FossilResult = { kind: 'fossils', coreId, depthM, effort: eff, found, note, cost, budgetLeft: this.budget };
    this.fossils.set(key, result);
    return { ok: true, measurement: result };
  }
}

function fail(code: ErrorCode, message: string): ActResult {
  return { ok: false, code, message };
}
