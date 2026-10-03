/**
 * Bot players for balancing (M8). Each bot plays one world through the ordinary observation service and returns a
 * Submission, so the whole pipeline (budget, noise, dating, scoring) is exercised exactly as for a human.
 *
 *   do-nothing  prior headline, no events                                      (the zero line)
 *   random      random sites and assays, random claims
 *   greedy      a sensible field geologist: coarse δ13C log of the thickest-looking core, follow-up assays on the
 *               anomalies, date ash beds, build an age model, classify with rules of thumb
 *   informed    greedy's measurements and events, but the headline probability comes from the ideal observer
 *   ideal       upper bound: the ideal observer's headline plus every detectable event, aged to within dating error
 *
 * Only `informed` and `ideal` look at truth-side objects; that is the point of them.
 */
import { AgePoint, fitAgeModel } from '../src/game/agemodel';
import { ObservationService } from '../src/observation/service';
import { auditEvents } from '../src/observation/reveal';
import { Solvability } from '../src/observation/solvability/gate';
import { LITH } from '../src/shared/lithology';
import { AssayResult, CoreResult, DateResult } from '../src/shared/protocol';
import { ProxyId } from '../src/shared/proxies';
import { Rng } from '../src/shared/rng';
import { CAUSES, CauseId, SUBMISSION_TYPES, Submission, SubmissionType, SubmittedEvent, isEpisode } from '../src/shared/submission';
import { World } from '../src/truth/world';

export interface BotContext { world: World; svc: ObservationService; solv: Solvability | null; rng: Rng }
export type Bot = (c: BotContext) => Submission;

const PRIOR = 0.4;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const median = (v: number[]): number => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

export const doNothing: Bot = () => ({ pCivilization: PRIOR, events: [] });

export const randomBot: Bot = ({ world, svc, rng }) => {
  const info = svc.publicInfo();
  for (let k = 0; k < 2; k++) {
    const cell = rng.int(info.nx * info.ny);
    const r = svc.execute({ kind: 'drill', cell, depthM: 200 });
    if (r.ok && r.measurement.kind === 'core') svc.execute({ kind: 'assay', coreId: r.measurement.coreId, proxy: 'd13C_carb', depthsM: Array.from({ length: 15 }, (_, i) => 1 + i * 12) });
  }
  const D = world.config.durationMyr;
  const events: SubmittedEvent[] = Array.from({ length: 3 }, (_, i) => {
    const type = SUBMISSION_TYPES[rng.int(SUBMISSION_TYPES.length)];
    const a = rng.range(0, D), w = rng.range(0.5, 5);
    return { id: `r${i}`, type, ageMinMa: a, ageMaxMa: Math.min(D, a + w), exists: 0.5, causes: isEpisode(type) ? { unknown_natural: 1 } : {} };
  });
  return { pCivilization: rng.next(), events };
};

// ---------------------------------------------------------------------------------------------------------------

interface Anomaly { depthM: number; z: number; value: number; hg?: number; toc?: number; ir?: number; persist?: number }

function assay(svc: ObservationService, coreId: string, proxy: ProxyId, depths: number[]): AssayResult | null {
  const r = svc.execute({ kind: 'assay', coreId, proxy, depthsM: depths });
  return r.ok && r.measurement.kind === 'assay' ? r.measurement : null;
}

/** The field geologist. Returns its evidence-based events and a (rule-of-thumb) headline. */
export function greedyAnalysis(c: BotContext): Submission {
  const { world, svc } = c;
  const info = svc.publicInfo();
  const D = world.config.durationMyr;
  const N = info.nx * info.ny;

  // 1. sites: carbonate/mud-looking surface rock (marine records carry the best isotope logs), spread over the map; drill two
  const marine = new Set([LITH.limestone, LITH.marl, LITH.mudstone, LITH['black shale']]);
  const sed = Array.from({ length: N }, (_, i) => i).filter((i) => marine.has(info.surfaceClass[i]));
  if (sed.length < 4) for (let i = 0; i < N; i++) if (info.surfaceClass[i] !== LITH['crystalline basement'] && !marine.has(info.surfaceClass[i])) sed.push(i);
  for (let i = sed.length - 1; i > 0; i--) { const j = c.rng.int(i + 1); [sed[i], sed[j]] = [sed[j], sed[i]]; }
  const cores: CoreResult[] = [];
  const tried = new Set<number>();
  for (let k = 0; k < Math.min(sed.length, 12) && cores.length < 3 && k < 12; k++) {
    const cell = sed[Math.floor((k * sed.length) / 12)];
    if (tried.has(cell)) continue;
    tried.add(cell);
    const r = svc.execute({ kind: 'drill', cell, depthM: 150 });
    if (r.ok && r.measurement.kind === 'core' && r.measurement.lengthM > 100) cores.push(r.measurement);
  }
  if (!cores.length) return { pCivilization: PRIOR, events: [] };
  // the best log: long, and carbonate-rich if possible (otherwise organic carbon isotopes have to do)
  const carbonate = (k: CoreResult): number => k.beds.reduce((a, b) => a + (b.baseM - b.topM) * b.carbonatePct, 0) / Math.max(1, k.lengthM) / 100;
  const core = cores.reduce((a, b) => (b.lengthM * (0.2 + carbonate(b)) > a.lengthM * (0.2 + carbonate(a)) ? b : a));
  const proxy: ProxyId = carbonate(core) > 0.25 ? 'd13C_carb' : 'd13C_org';
  // the record is read from the top down and old events lie deep: re-drill the chosen site as deep as the budget allows
  const deep = svc.execute({ kind: 'drill', cell: core.cell, depthM: Math.min(1500, Math.max(300, (svc.budget * 0.35 - 5) / 0.02 / (info.elevationM[core.cell] < 0 ? 3 : 1))) });
  const full = deep.ok && deep.measurement.kind === 'core' ? deep.measurement : core;
  const L = Math.min(full.lengthM, full.reachedBasement ? full.lengthM - 5 : full.lengthM);

  // 2. coarse δ13C log
  const n1 = Math.max(12, Math.floor((svc.budget * 0.4) / (proxy === 'd13C_carb' ? 1 : 2)));
  const coarse = assay(svc, full.coreId, proxy, Array.from({ length: n1 }, (_, i) => +(((i + 0.5) * L) / n1).toFixed(2)));
  const pts = (coarse?.samples ?? []).filter((s) => s.value !== null);
  if (pts.length < 6) return { pCivilization: PRIOR, events: [] };
  const med = median(pts.map((s) => s.value!));
  const mad = median(pts.map((s) => Math.abs(s.value! - med))) * 1.4826;
  const sd = Math.max(0.3, mad);
  if (process.env.BOTDEBUG) console.error('greedy', { cell: core.cell, L, n1, pts: pts.length, med, mad, min: Math.min(...pts.map((s) => s.value!)), max: Math.max(...pts.map((s) => s.value!)) });
  const flagged = pts.filter((s) => Math.abs(s.value! - med) > 3 * sd);
  // group neighbours
  const groups: Anomaly[] = [];
  for (const s of flagged) {
    const z = (s.value! - med) / sd;
    const last = groups[groups.length - 1];
    if (last && s.depthM - last.depthM < (L / n1) * 2.5) { if (Math.abs(z) > Math.abs(last.z)) { last.depthM = s.depthM; last.z = z; last.value = s.value!; } } else groups.push({ depthM: s.depthM, z, value: s.value! });
  }
  groups.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const top = groups.slice(0, 4);

  // 3. follow-up assays at the anomalies and at two baseline depths
  const base = [L * 0.2, L * 0.8];
  const bgHg = assay(svc, full.coreId, 'hg', base), bgToc = assay(svc, full.coreId, 'toc', base);
  const bgHgRatio = median((bgHg?.samples ?? []).map((s, i) => (s.value ?? NaN) / Math.max(0.05, bgToc?.samples[i]?.value ?? NaN)).filter(Number.isFinite));
  for (const a of top) {
    if (svc.budget < 25) break;
    a.hg = assay(svc, full.coreId, 'hg', [a.depthM])?.samples[0]?.value ?? undefined;
    a.toc = assay(svc, full.coreId, 'toc', [a.depthM])?.samples[0]?.value ?? undefined;
    if (svc.budget >= 30) a.ir = assay(svc, full.coreId, 'ir', [a.depthM])?.samples[0]?.value ?? undefined;
  }
  let persistRatio = 1;
  if (top.length && svc.budget >= 14) {
    const bg = assay(svc, full.coreId, 'persistOrg', [base[0]])?.samples[0]?.value, at = assay(svc, full.coreId, 'persistOrg', [top[0].depthM])?.samples[0]?.value;
    if (bg != null && at != null) persistRatio = at / Math.max(0.01, bg);
    top[0].persist = at ?? undefined;
  }

  // 4. dating: ash beds, closest to the anomalies first
  const ashDepths: number[] = [];
  for (const b of full.beds) if (b.notes.some((n) => n.includes('ash'))) ashDepths.push(0.5 * (b.topM + b.baseM));
  ashDepths.sort((a, b) => Math.min(...top.map((t) => Math.abs(t.depthM - a)), 1e9) - Math.min(...top.map((t) => Math.abs(t.depthM - b)), 1e9));
  const dates: AgePoint[] = [];
  for (const z of ashDepths) {
    if (svc.budget < 16 || dates.length >= 3) break;
    const r = svc.execute({ kind: 'date', coreId: full.coreId, depthM: z });
    if (r.ok && r.measurement.kind === 'date') { const d: DateResult = r.measurement; if (d.ageMa !== null) dates.push({ depthM: z, ageMa: d.ageMa, sigmaMa: d.sigmaMa, origin: 'date' }); }
  }
  if (process.env.BOTDEBUG) console.error('dating', { ashBeds: ashDepths.length, dates: dates.map((d) => `${d.depthM.toFixed(0)}m=${d.ageMa.toFixed(1)}`), L, anomalies: top.map((t) => `${t.depthM.toFixed(0)}m z=${t.z.toFixed(1)}`) });
  const model = fitAgeModel(dates);
  const RATE = 40; // m/Myr prior
  const ageAt = (z: number): { age: number; sigma: number } => {
    const m = model.at(z, 0);
    if (m) return { age: m.ageMa, sigma: Math.max(m.sigmaMa, 0.05) };
    if (dates.length >= 2) {
      const k = model.knots, a = z < k[0].depthM ? k[0] : k[k.length - 1], b = z < k[0].depthM ? k[1] : k[k.length - 2];
      const rate = Math.abs((b.depthM - a.depthM) / (b.ageMa - a.ageMa));
      const age = a.ageMa + (z - a.depthM) / Math.max(5, rate);
      return { age, sigma: Math.max(0.3, 0.15 * Math.abs(age - a.ageMa)) };
    }
    if (dates.length === 1) { const d = dates[0]; const age = d.ageMa + (z - d.depthM) / RATE; return { age, sigma: Math.max(0.5, 0.5 * Math.abs(age - d.ageMa)) }; }
    const age = D * 0.5; // no dates at all: the answer is "somewhere"
    return { age, sigma: D * 0.4 };
  };

  // 5. classify
  const events: SubmittedEvent[] = [];
  let civScore = 0;
  top.forEach((a, i) => {
    const hgRatio = a.hg != null && a.toc != null ? a.hg / Math.max(0.05, a.toc) : NaN;
    const hgHigh = Number.isFinite(hgRatio) && Number.isFinite(bgHgRatio) && hgRatio > 2.5 * bgHgRatio;
    const irHigh = (a.ir ?? 0) > 0.25;
    let type: SubmissionType, causes: Partial<Record<CauseId, number>> = {};
    if (irHigh) { type = 'bolide'; }
    else if (a.z < 0 && hgHigh) { type = 'lip'; }
    else if (a.z < 0) { type = 'hyperthermal'; causes = { clathrate: 0.35, lip: 0.2, civilization: persistRatio > 2 ? 0.3 : 0.1, unknown_natural: 0.2, tectonic: 0.05 }; if (i === 0 && persistRatio > 2) civScore += 0.3; }
    else { type = 'oae'; causes = { lip: 0.4, unknown_natural: 0.4, clathrate: 0.1, tectonic: 0.1 }; }
    if (a.z < 0 && !hgHigh && !irHigh) civScore += 0.1;
    const t = ageAt(a.depthM);
    const w = 1.28 * t.sigma + (0.5 * L) / n1 / RATE;
    events.push({ id: `g${i}`, type, ageMinMa: Math.max(0, t.age - w), ageMaxMa: Math.min(D, t.age + w), exists: 0.5, causes: isEpisode(type) ? causes : {} });
  });
  return { pCivilization: clamp(0.18 + civScore, 0.05, 0.7), events };
}

export const greedyBot: Bot = (c) => greedyAnalysis(c);

export const informedBot: Bot = (c) => {
  const s = greedyAnalysis(c);
  const p = c.solv?.assessment.pCivilization;
  return p === undefined ? s : { ...s, pCivilization: clamp(p, 0.03, 0.97) };
};

export const idealBot: Bot = ({ world, solv, rng }) => {
  const audits = auditEvents(world);
  const SUB = new Set<string>(SUBMISSION_TYPES);
  const events: SubmittedEvent[] = [];
  world.catalog.forEach((e, k) => {
    if (!SUB.has(e.type) || audits[k].weight <= 0) return;
    const mid = 0.5 * (e.ageMa[0] + e.ageMa[1]);
    const sigma = 0.05 + 0.005 * mid; // dated-ash precision
    const jitter = rng.fork(`ideal${k}`).normal() * sigma;
    const type = e.type as SubmissionType;
    const causes: Partial<Record<CauseId, number>> = {};
    if (isEpisode(type)) for (const c of CAUSES) causes[c] = c === e.cause ? 0.6 : 0.4 / (CAUSES.length - 1);
    events.push({ id: `i${k}`, type, ageMinMa: mid + jitter - 1.28 * sigma - (e.ageMa[0] - e.ageMa[1]) / 2, ageMaxMa: mid + jitter + 1.28 * sigma + (e.ageMa[0] - e.ageMa[1]) / 2, exists: 0.85, causes });
  });
  return { pCivilization: clamp(solv?.assessment.pCivilization ?? PRIOR, 0.03, 0.97), events };
};

export const BOTS: Record<string, Bot> = { 'do-nothing': doNothing, random: randomBot, greedy: greedyBot, informed: informedBot, ideal: idealBot };
