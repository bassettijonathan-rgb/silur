/**
 * The observation service: the ONLY interface between the hidden world and the player (design Layer 2).
 *
 * It sells measurements for budget. Each answer is a pure function of (world seed, action): the same core
 * request or the same assay at the same depth returns the same numbers however the player got there, and
 * asking again is free. It returns rock descriptions and lab numbers — never facies labels, ages, tracer
 * masses or event labels.
 */
import { LITH } from '../shared/lithology';
import { Action, AssayResult, AssaySample, CoreResult, ErrorCode, Measurement, PublicInfo } from '../shared/protocol';
import { PROXIES, PROXY_IDS } from '../shared/proxies';
import { Rng, hashNormal, hashUnit } from '../shared/rng';
import { StratWorld } from '../truth/strat/simulate';
import { NT } from '../truth/strat/tracers';
import { World } from '../truth/world';
import { ColumnView, buildColumnView, forEachOverlap } from './columnview';
import { measureProxy } from './instruments';
import { bedsBetween, classify } from './lithology';

export const DRILL = { base: 5, perMeter: 0.02, offshoreFactor: 3, maxCoreM: 1500, basementPenetrationM: 3 };
const SAMPLE_HALF_M = 0.03; // each sample integrates a 6-cm interval
const MAX_SAMPLES = 400;

export type ActResult = { ok: true; measurement: Measurement } | { ok: false; code: ErrorCode; message: string };

interface CoreRecord {
  id: string;
  cell: number;
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
      if (hashUnit(this.seed, 'recon', i) < 0.15) lith = Math.floor(hashUnit(this.seed, 'recon-alt', i) * 10); // remote sensing is sometimes wrong
      surfaceClass[i] = lith;
      const e = 0.15 + 0.5 * Math.min(1, s.relief[i] / 100) + 0.35 * Math.min(1, (s.erosionRate[i] * 1e6) / 50);
      exposure[i] = Math.round(100 * Math.min(1, Math.max(0, e + 0.05 * hashNormal(this.seed, 'expo', i))));
    }
    return {
      nx: s.nx, ny: s.ny, cellKm: s.cellKm, elevationM, surfaceClass, exposure,
      budget: this.world.config.difficulty.budget, maxCoreM: DRILL.maxCoreM,
      drillCost: { base: DRILL.base, perMeter: DRILL.perMeter, offshoreFactor: DRILL.offshoreFactor },
      proxies: PROXY_IDS.map((id) => PROXIES[id]),
    };
  }

  /** Depth-scale stretch of a drilled core (reported depth = true depth × stretch). For tests and tooling that need to place samples exactly. */
  coreStretch(coreId: string): number | undefined {
    return this.cores.get(coreId)?.stretch;
  }

  // ---------------------------------------------------------------------------------------------
  // Paid actions
  // ---------------------------------------------------------------------------------------------

  execute(a: Action): ActResult {
    if (a.kind === 'drill') return this.drill(a.cell, a.depthM);
    if (a.kind === 'assay') return this.assay(a.coreId, a.proxy, a.depthsM);
    return fail('bad_request', 'unknown action');
  }

  private view(cell: number): ColumnView {
    let v = this.views.get(cell);
    if (!v) { v = buildColumnView(this.world.strat.columns[cell]); this.views.set(cell, v); }
    return v;
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
    const r = new Rng(`${this.seed}|core|${cell}|${Math.round(depthM)}`);
    const gaps: { z0: number; z1: number }[] = [];
    let p = 0.5;
    for (;;) {
      p += -Math.log(1 - r.next()) * 11;
      if (p >= lengthTrue) break;
      const len = 0.2 + 0.8 * r.next();
      gaps.push({ z0: p, z1: Math.min(p + len, lengthTrue) });
      p += len;
    }
    this.cores.set(id, { id, cell, view, stretch, lengthTrue, rockTrue: rock, gaps });

    // beds: rock down to the basement (or the end of the hole), cut by the lost intervals
    const rawBeds = bedsBetween(view, 0, Math.min(lengthTrue, rock), this.seed, cell);
    const beds: CoreResult['beds'] = [];
    const cut = (z0: number, z1: number): [number, number][] => {
      let pieces: [number, number][] = [[z0, z1]];
      for (const g of gaps) pieces = pieces.flatMap(([a, b]) => (g.z1 <= a || g.z0 >= b ? [[a, b] as [number, number]] : [[a, Math.min(b, g.z0)], [Math.max(a, g.z1), b]].filter(([x, y]) => y - x > 1e-4) as [number, number][]));
      return pieces;
    };
    for (const b of rawBeds) for (const [z0, z1] of cut(b.z0, b.z1)) {
      beds.push({ topM: z0 * stretch, baseM: z1 * stretch, lith: b.lith, carbonatePct: b.carbonatePct, sandPct: b.sandPct, organicPct: b.organicPct, contact: b.contact, notes: b.notes });
    }
    const reachedBasement = depthM > rock;
    if (reachedBasement && lengthTrue > rock) {
      beds.push({ topM: rock * stretch, baseM: lengthTrue * stretch, lith: LITH['crystalline basement'], carbonatePct: 0, sandPct: 0, organicPct: 0, contact: 'sharp', notes: ['unconformity on crystalline basement'] });
    }

    this.budget -= cost;
    const result: CoreResult = {
      kind: 'core', coreId: id, cell, requestedM: depthM, lengthM: lengthTrue * stretch, reachedBasement, beds,
      gaps: gaps.map((g) => ({ topM: g.z0 * stretch, baseM: g.z1 * stretch })), cost, budgetLeft: this.budget,
    };
    this.coreMeasurements.set(id, result);
    return { ok: true, measurement: result };
  }

  private assay(coreId: string, proxy: (typeof PROXY_IDS)[number], depthsM: number[]): ActResult {
    const core = this.cores.get(coreId);
    if (!core) return fail('unknown_core', 'no such core — drill first');
    if (!PROXIES[proxy]) return fail('bad_request', 'unknown proxy');
    if (!Array.isArray(depthsM) || depthsM.length === 0 || depthsM.length > MAX_SAMPLES) return fail('bad_request', `request 1–${MAX_SAMPLES} samples`);
    const key = `${coreId}|${proxy}|${depthsM.map((d) => Math.round(d * 100)).join(',')}`;
    const known = this.assays.get(key);
    if (known) return { ok: true, measurement: { ...known, cost: 0, budgetLeft: this.budget } };

    const cost = depthsM.length * PROXIES[proxy].cost;
    if (cost > this.budget + 1e-9) return fail('insufficient_budget', `needs ${cost}, have ${this.budget.toFixed(1)}`);

    const v = core.view;
    const col = v.col;
    const acc = new Float64Array(NT);
    const samples: AssaySample[] = depthsM.map((d) => {
      const t = d / core.stretch;
      if (!(t >= 0) || t > Math.min(core.lengthTrue, core.rockTrue)) return { depthM: d, value: null, sigma: 0, note: 'out of range' };
      if (core.gaps.some((g) => t >= g.z0 && t <= g.z1)) return { depthM: d, value: null, sigma: 0, note: 'lost core' };
      acc.fill(0);
      let age = 0, w = 0;
      forEachOverlap(v, t - SAMPLE_HALF_M, t + SAMPLE_HALF_M, (i, ov) => {
        const f = ov / v.thick[i];
        for (let k = 0; k < NT; k++) acc[k] += col.tr[i * NT + k] * f;
        age += col.ageMean[i] * ov; w += ov;
      });
      if (w <= 0) return { depthM: d, value: null, sigma: 0, note: 'out of range' };
      const r = measureProxy(proxy, acc, { seed: this.seed, noiseScale: this.noiseScale, cell: core.cell, depthKey: Math.round(d * 100), ageMa: age / w, burialM: t });
      return { depthM: d, value: r.value, sigma: r.sigma, note: r.note };
    });
    this.budget -= cost;
    const result: AssayResult = { kind: 'assay', coreId, proxy, samples, cost, budgetLeft: this.budget };
    this.assays.set(key, result);
    return { ok: true, measurement: result };
  }
}

function fail(code: ErrorCode, message: string): ActResult {
  return { ok: false, code, message };
}
