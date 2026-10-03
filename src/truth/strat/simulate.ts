/**
 * The stratigraphic simulator (M2): runs the surface of the map through geological time.
 *
 * One plan step does, in order:
 *   1. tectonics        move the basement; add sediment load (local isostasy) -> surface elevation z
 *   2. plumbing         sort cells by height, route water downhill (D8), accumulate drainage area
 *   3. routing          walk downhill: rivers erode steep land (popping rock off the column) or drop
 *                       sediment on gentle land; at the sea the coarse fraction drops near the mouth and
 *                       the fines travel on, limited by accommodation (sediment can't fill above sea level)
 *   4. biogenic         carbonate factory (shelf), pelagic rain (above the CCD), evaporites, organic carbon
 *   5. facies           classify the setting (land / delta / shelf / deep ...)
 *   6. tracers          isotopes and trace fluxes from the Earth-system history for this step
 *   7. deposit          into each cell's column through the bioturbated mixed layer
 *
 * Units: metres, years, solid-rock thickness for sediment amounts (see tracers.ts).
 */

import { WorldConfig } from '../../shared/config';
import { Rng } from '../../shared/rng';
import { TimePlan } from '../../shared/timeplan';
import { d18OCalcite } from '../earth/carbonate';
import { EarthHistory } from '../earth/run';
import { drainageArea, flowReceivers, localRelief, resortDescending } from '../geo/landscape';
import { localTemperature, generateLatitude, zonalHumidity } from '../geo/paleogeo';
import { TEMPLATES, TemplateName, makeTectonics } from '../geo/tectonics';
import { ColumnStore, ENV_FIELDS, ErodeInfo, FLAG } from './column';
import { compactedThickness } from './compaction';
import { ENV, encodeDepth, encodeLat, encodeO2, encodeSedRate } from './envcode';
import { classifyFacies } from './environment';
import { carbonateTempFactor, shelfCarbonateRate } from './factory';
import { ErasedLog } from './erased';
import { F, FACIES, NO_DEPOSIT, isAllowedTransition } from './facies';
import { DEFAULT_STRAT, StratParams } from './params';
import { DENSITY, NT, T, massOf } from './tracers';

/** Something that adds extra material to a cell's deposit this step (impact ejecta, ash falls, ...). */
export interface StratSource {
  /** Add to `tr`; return extra FLAG bits for the layer. */
  add(step: number, cell: number, dtYr: number, ageMa: number, tr: Float64Array): number;
}

export interface StratInput {
  config: Pick<WorldConfig, 'grid' | 'durationMyr' | 'difficulty'>;
  plan: TimePlan;
  earth: EarthHistory;
  rng: Rng;
  template?: TemplateName;
  /** Length of the final regional-uplift (exhumation) phase, Myr; default 20 % of the history up to 35 Myr; 0 = none. */
  exhumeMyr?: number;
  /** Override the palaeolatitude track (degrees, per step). */
  latitude?: Float64Array;
  sources?: StratSource[];
  params?: Partial<StratParams>;
  /** Keep facies-per-cell-per-step (needed by the reveal and by tests). Default true. */
  recordEnv?: boolean;
  onProgress?: (frac: number) => void;
}

export interface Tally {
  /** Σ of every tracer ever delivered to columns / removed from them (for mass-balance checks). */
  delivered: Float64Array;
  removed: Float64Array;
  /** Solid metres eroded from crystalline basement (sediment from nowhere in the record). */
  basementEroded: number;
  /** Material that entered from outside the river system (pelagic dust, injected sources), by tracer. */
  external: Float64Array;
}

export interface StratWorld {
  nx: number;
  ny: number;
  cellKm: number;
  plan: TimePlan;
  columns: ColumnStore[];
  erased: ErasedLog;
  template: TemplateName;
  params: StratParams;
  latitude: Float64Array;
  /** Final basement elevation and surface elevation (m) and sea level (m) at the present. */
  tecto: Float32Array;
  surface: Float32Array;
  seaLevelNow: number;
  /** Facies (or NO_DEPOSIT) per step per cell, row-major steps × cells. */
  envHistory: Uint8Array | null;
  /** Local relief (m) and recent erosion rate (m/yr, 5-Myr running mean) at the present. */
  relief: Float32Array;
  erosionRate: Float32Array;
  tally: Tally;
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export function simulateStrata(input: StratInput): StratWorld {
  const { plan, earth } = input;
  const { nx, ny, cellKm } = input.config.grid;
  const N = nx * ny;
  const cellM = cellKm * 1000;
  const P: StratParams = { ...DEFAULT_STRAT, ...input.params };
  const rng = input.rng.fork('strat');
  const pres = input.config.difficulty.preservation;
  const bioFactor = 2 * (1 - pres) + 0.4 * pres;
  const E = earth.mean;
  const planet = earth.calibrated.planet;
  const omegaRef = earth.calibrated.base.omegaCal0;
  const exportRef = planet.exportOrg0;
  const durationMyr = plan.ageBaseMa[0];
  const sources = input.sources ?? [];
  const recordEnv = input.recordEnv ?? true;

  const template = input.template ?? rng.fork('template').pick(TEMPLATES);
  const tect = makeTectonics(template, nx, ny, durationMyr, rng, input.exhumeMyr);
  const tecto = tect.initial.slice();
  const latitude = input.latitude ?? generateLatitude(plan, rng);

  const columns: ColumnStore[] = new Array(N);
  for (let i = 0; i < N; i++) { columns[i] = new ColumnStore(); columns[i].mergeBedM = P.mergeBedM; }
  const erased = new ErasedLog();
  const openEp = new Int32Array(N).fill(-1);
  const lastFacies = new Uint8Array(N).fill(NO_DEPOSIT);
  const lastDepStep = new Int32Array(N).fill(-10);
  const envHistory = recordEnv ? new Uint8Array(plan.n * N).fill(NO_DEPOSIT) : null;
  const eroEma = new Float32Array(N);
  let lastFineStep = -100;

  const tally: Tally = { delivered: new Float64Array(NT), removed: new Float64Array(NT), basementEroded: 0, external: new Float64Array(NT) };

  // work arrays
  const rate = new Float32Array(N);
  const z = new Float32Array(N);
  const order = new Uint32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  const rec = new Int32Array(N);
  const slope = new Float32Array(N);
  const area = new Float32Array(N);
  const Qc = new Float64Array(N), Qf = new Float64Array(N);
  const depC = new Float64Array(N), depF = new Float64Array(N);
  const hum = new Float32Array(N);
  const ml = { phi0: 0, lambda: 0, s: 0 };
  const removed = new Float64Array(NT);
  const einfo: ErodeInfo = { removedSolid: 0, ageOldMa: 0, ageYoungMa: 0 };
  const tr = new Float64Array(NT);
  const envBytes = new Uint8Array(ENV_FIELDS);
  const lmixByFacies = FACIES.map((n) => P.lmix[n] ?? 0);

  const updateSurface = () => {
    for (let i = 0; i < N; i++) {
      columns[i].meanLitho(ml);
      z[i] = tecto[i] + (1 - P.isoK) * compactedThickness(ml.s, ml.phi0, ml.lambda);
    }
  };
  updateSurface();
  for (let i = 0; i < N; i++) order[i] = i;
  order.sort((a, b) => z[b] - z[a]);

  for (let s = 0; s < plan.n; s++) {
    const dt = plan.dtYr[s];
    const ageMid = 0.5 * (plan.ageBaseMa[s] + plan.ageTopMa[s]);
    const tElapsed = durationMyr - ageMid;
    const SL = E.seaLevel[s];
    const Tg = E.tempC[s];
    const lat = latitude[s];
    const Tl = localTemperature(Tg, lat);
    const f = earth.forcing[s];
    const iceNow = E.ice[s];
    const glacialOn = iceNow > 0.25 && lat > 70 - 40 * iceNow; // ice sheets reach this latitude
    const hz = zonalHumidity(lat, Tg);
    const anoxG = E.anoxic[s];
    const fire = E.fire[s];
    const fOmega = clamp((E.omegaCal[s] - 1) / (omegaRef - 1), 0, 1.3);
    const fTemp = carbonateTempFactor(P, Tl);
    const fine = plan.tag[s] > 0;
    if (fine) lastFineStep = s;
    const keep = s - lastFineStep <= 2; // refined steps and the two just after: never merged away

    // 1. tectonics + isostasy -> surface elevation
    tect.rate(tElapsed, rate);
    for (let i = 0; i < N; i++) tecto[i] += rate[i] * dt;
    updateSurface();

    // 2. plumbing
    resortDescending(order, z);
    flowReceivers(z, nx, ny, cellM, rec, slope);
    drainageArea(order, rec, cellM, area);
    for (let i = 0; i < N; i++) hum[i] = clamp(hz * (0.55 + 0.9 * tect.wetness[i]), 0, 1);
    Qc.fill(0); Qf.fill(0); depC.fill(0); depF.fill(0);
    const erosionMult = (1 + 2 * f.landCoverLoss) * f.sedimentFluxMultiplier;

    // 3. routing, erosion
    for (let k = 0; k < N; k++) {
      const i = order[k];
      const d = SL - z[i];
      let qc = Qc[i], qf = Qf[i];
      const r = rec[i];
      let dc = 0, df = 0;
      let eroded = 0;

      if (d <= 0) {
        // ---- land
        const S = slope[i];
        if (r < 0) {
          dc = qc; df = qf; // closed basin: everything stays
        } else if (S < P.slopeCrit) {
          const g = 1 - 0.5 * (S / P.slopeCrit);
          dc = qc * Math.min(1, P.floodplainDeposit * 1.4 * g);
          df = qf * P.floodplainDeposit * 0.6 * g;
        } else {
          const kEff = P.kStream * (0.3 + 0.7 * hum[i]) * erosionMult;
          let e = kEff * Math.pow(area[i] / 1e6, P.streamM) * S * dt;
          e = Math.min(e, 0.5 * (z[i] - z[r]));
          if (e > 0) {
            removed.fill(0);
            columns[i].erode(e, removed, einfo);
            const basement = e - einfo.removedSolid;
            const rc = removed[T.clastic], rs = removed[T.sand];
            qc += rs + basement * P.sandFracBedrock;
            qf += rc - rs + removed[T.ash] + basement * (1 - P.sandFracBedrock);
            for (let t = 0; t < NT; t++) tally.removed[t] += removed[t];
            tally.basementEroded += basement;
            tecto[i] -= basement;
            eroded = e;
            if (einfo.removedSolid > 0) {
              const ep = openEp[i];
              if (ep >= 0 && erased.stepEnd[ep] >= s - 1) erased.extend(ep, s, einfo.ageOldMa, einfo.ageYoungMa, einfo.removedSolid);
              else openEp[i] = erased.open(i, s, einfo.ageOldMa, einfo.ageYoungMa, einfo.removedSolid);
            }
          }
        }
      } else {
        // ---- sea
        if (r < 0) {
          dc = qc; df = qf;
        } else {
          const pc = clamp(Math.exp(-d / P.coarseDecayM), 0.05, 0.9);
          const pf = d < P.shelfDepthMax ? P.fineShelf : P.fineBasin;
          dc = qc * pc; df = qf * pf;
          const cap = d * P.accomSolidPerM;
          const tot = dc + df;
          if (tot > cap) { const sc = tot > 0 ? cap / tot : 0; dc *= sc; df *= sc; }
        }
      }

      depC[i] = dc; depF[i] = df;
      if (r >= 0) { Qc[r] += qc - dc; Qf[r] += qf - df; }
      const ee = eroEma[i];
      const a = 1 - Math.exp(-dt / 5e6);
      eroEma[i] = ee + a * (eroded / dt - ee);
    }

    // 4–7. biogenic production, facies, tracers, deposit
    for (let i = 0; i < N; i++) {
      const d = SL - z[i];
      const col = columns[i];
      const clastic = depC[i] + depF[i];
      const sand = depC[i];
      let carb = 0, evap = 0, extraClay = 0;
      const marine = d > 0;
      const sink = rec[i] < 0;
      const humidity = hum[i];
      const aridity = 1 - humidity;
      let capLeft = marine && !sink ? Math.max(d * P.accomSolidPerM - clastic, 0) : Infinity;

      if (marine) {
        if (d < P.shelfDepthMax) {
          const G = shelfCarbonateRate(P, d, fTemp, fOmega, clastic / dt);
          carb = Math.min(G * dt, capLeft);
          capLeft -= carb;
          if (d < P.evapDepthMax && aridity > P.evapAridity && tect.restriction[i] > P.evapRestriction && clastic / dt < P.carbClasticTol) {
            const ev = P.evapRate * dt * ((aridity - P.evapAridity) / (1 - P.evapAridity)) * ((tect.restriction[i] - P.evapRestriction) / (1 - P.evapRestriction));
            evap = Math.min(ev, capLeft);
            carb = carb * (1 - Math.min(1, evap / Math.max(P.evapRate * dt, 1e-12))); // brines poison the carbonate factory
          }
        } else {
          carb = d > E.ccd[s] ? 0 : P.pelagicRate * dt * fOmega;
          extraClay = P.pelagicClay * dt;
        }
      } else if (sink && humidity < 0.25) {
        evap = P.evapRate * dt * 0.5 * ((0.25 - humidity) / 0.25); // playa
      }

      const clasticAll = clastic + extraClay;
      const sandAll = sand;
      const solidTotal = clasticAll + carb + evap;
      if (solidTotal <= 1e-9) {
        if (envHistory) envHistory[s * N + i] = NO_DEPOSIT;
        continue;
      }

      const fac = classifyFacies({
        waterDepth: d, clasticRate: clasticAll / dt, sandFrac: clasticAll > 0 ? sandAll / clasticAll : 0,
        carb, clastic: clasticAll, evap, areaKm2: area[i] / 1e6, isSink: sink, humidity, glaciated: glacialOn && (d <= 0 ? lat > 60 || -d > 500 : lat > 60 && d < 400),
        shelfDepthMax: P.shelfDepthMax, riverAreaKm2: P.riverAreaKm2,
      });

      // ---- build the tracer vector for this step
      tr.fill(0);
      tr[T.clastic] = clasticAll;
      tr[T.sand] = sandAll;
      tr[T.caco3] = carb;
      tr[T.evap] = evap;
      const massNoOrg = clasticAll * DENSITY.clastic + carb * DENSITY.caco3 + evap * DENSITY.evap;
      const isShelf = marine && d < P.shelfDepthMax;
      const anoxLocal = marine ? (d >= 150 ? anoxG : 0.35 * anoxG) : 0;
      let orgC = 0;
      if (marine) {
        const prod = E.export[s] / exportRef;
        orgC = P.tocMarine * prod * (1 + 6 * anoxLocal) * (isShelf ? 1 : 0.6) * massNoOrg;
      } else if (fac !== F.fluvial) {
        orgC = P.tocTerrestrial * humidity * humidity * massNoOrg;
      } else {
        orgC = 0.2 * P.tocTerrestrial * humidity * humidity * massNoOrg;
      }
      tr[T.orgC] = orgC;

      if (carb > 0) {
        tr[T.d13C_carb] = (E.d13C_carb[s] + (isShelf ? 0.5 : 0)) * carb;
        tr[T.d18O_carb] = d18OCalcite(Tl + (isShelf ? 2 : 0), E.d18O_sw[s]) * carb;
      }
      if (orgC > 0) {
        tr[T.d13C_org] = (marine ? E.d13C_org[s] : E.d13C_atm[s] - 19) * orgC;
        let d15 = marine ? E.d15N[s] : 3;
        if (marine && f.nutrientRunoff > 0) {
          const w = d < 150 && clasticAll / dt > 2e-5 ? 1 : 0.15; // river-mouth proximity proxy
          d15 += w * (f.nutrientRunoff / (1 + f.nutrientRunoff)) * (f.nutrientRunoffD15N - 5);
        }
        tr[T.d15N] = d15 * orgC;
      }
      tr[T.Ir] = P.irDetrital * clasticAll * DENSITY.clastic * 1000 + P.irCarbonate * carb * DENSITY.caco3 * 1000 + P.irCosmicFlux * dt;
      const tocRatio = massNoOrg > 0 ? Math.min(orgC / massNoOrg / P.tocMarine, 3) : 0;
      tr[T.Hg] = P.hgFlux * dt * (1 + f.mercuryEmission) * (0.6 + 0.4 * tocRatio);
      tr[T.charcoal] = P.charcoalFlux * dt * (fire * (1 + f.fireIgnition) + f.soot);
      tr[T.Fe60] = f.fe60Flux * dt;
      tr[T.persistOrg] = P.persistFlux * dt * (0.5 + 0.5 * fire + f.persistentOrgFlux);
      const euxLocal = marine ? (d >= 150 ? E.euxinia[s] : 0.2 * E.euxinia[s]) : 0;
      tr[T.pyriteS] = marine ? P.pyriteSPerC * orgC * (0.3 + 3 * euxLocal) : 0;

      let flags = (fine ? FLAG.FINE : 0) | (keep ? FLAG.KEEP : 0);
      if (anoxLocal > 0.5) flags |= FLAG.ANOXIC;
      tally.external[T.clastic] += extraClay;
      for (const src of sources) {
        const before = tr.slice();
        flags |= src.add(s, i, dt, ageMid, tr);
        for (let t = 0; t < NT; t++) tally.external[t] += tr[t] - before[t];
      }

      // continuity check: an unresolvable facies jump marks a condensed / drowning surface
      if (lastDepStep[i] === s - 1 && !isAllowedTransition(lastFacies[i], fac)) flags |= FLAG.DROWN;

      // ---- environment bytes + deposit
      const bottomO2 = marine ? (d >= 150 ? E.O2deep[s] : Math.max(E.O2deep[s], 150 * (1 - 0.35 * anoxG))) : 250;
      envBytes[ENV.DEPTH] = encodeDepth(d);
      envBytes[ENV.O2] = encodeO2(bottomO2);
      envBytes[ENV.SEDRATE] = encodeSedRate((solidTotal / dt) * 1e6);
      envBytes[ENV.LAT] = encodeLat(lat);
      const lmix = lmixByFacies[fac] * bioFactor * clamp((bottomO2 - 5) / 50, 0, 1);

      col.deposit(s, { tr, facies: fac, flags, env: envBytes, lmix, ageMa: ageMid });
      for (let t = 0; t < NT; t++) tally.delivered[t] += tr[t];
      lastFacies[i] = fac;
      lastDepStep[i] = s;
      openEp[i] = -1;
      if (envHistory) envHistory[s * N + i] = fac;
    }

    if (input.onProgress && (s % 50 === 0 || s === plan.n - 1)) input.onProgress((s + 1) / plan.n);
  }

  for (const c of columns) c.finalize();
  updateSurface();
  const relief = localRelief(z, nx, ny);

  return {
    nx, ny, cellKm, plan, columns, erased, template, params: P, latitude,
    tecto, surface: z.slice(), seaLevelNow: E.seaLevel[plan.n - 1], envHistory, relief, erosionRate: eroEma, tally,
  };
}

/** Σ of every tracer currently in all columns (stack + mixed layers). */
export function totalTracers(w: StratWorld): Float64Array {
  const out = new Float64Array(NT);
  for (const c of w.columns) c.sumTracers(out);
  return out;
}

/** Total layers and approximate bytes across the grid. */
export function memoryStats(w: StratWorld): { layers: number; mbytes: number } {
  let layers = 0, bytes = 0;
  for (const c of w.columns) { layers += c.n; bytes += c.bytes; }
  return { layers, mbytes: bytes / 1e6 + (w.envHistory ? w.envHistory.length / 1e6 : 0) };
}

export { massOf };
