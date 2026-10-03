/** The investigation UI (M6): map, core viewer, correlation, age models, notebook, save/load. */
import { ActionError } from '../client/client';
import { TIE_SIGMA_MA, TieKind } from '../game/correlation';
import { EvidenceRef } from '../game/notebook';
import { parseSave, serialize } from '../game/save';
import { Session } from '../game/session';
import { PresetName, makeConfig } from '../shared/config';
import { LITHOLOGIES } from '../shared/lithology';
import { Stage } from '../shared/protocol';
import { PROXIES, PROXY_IDS, ProxyId } from '../shared/proxies';
import { drawAgeDepth, rangeTable, segmentTable } from './ageView';
import { canvasWidthFor, correlationHit, drawCorrelation, TIE_COLORS } from './correlationView';
import { coreDepthAt, drawCore, legend } from './coreView';
import { el } from './dom';
import { MapLayer, cellAt, drawMap } from './mapView';
import { renderNotebook } from './notebookView';
import { renderReveal } from './revealView';
import { renderSubmit } from './submitView';
import { recordGame, loadHistory } from '../game/history';

const STAGE_LABEL: Record<Stage, string> = {
  planet: 'sampling a planet and its history of catastrophes…', earth: 'running the carbon cycle and climate…',
  biosphere: 'evolving life…', strata: 'laying down the rocks…', catalog: 'cataloguing…', solvability: 'checking that the puzzle is fair…',
};
const STAGE_START: Record<Stage, number> = { planet: 0, earth: 0.02, biosphere: 0.1, strata: 0.15, catalog: 0.88, solvability: 0.9 };
const STAGE_SPAN: Record<Stage, number> = { planet: 0.02, earth: 0.08, biosphere: 0.05, strata: 0.73, catalog: 0.02, solvability: 0.1 };
const AUTOSAVE_KEY = 'silur-autosave';
type Tab = 'core' | 'correlate' | 'age' | 'notebook' | 'submit' | 'reveal';

export class App {
  private selected = -1;
  private coreId: string | null = null;
  private layer: MapLayer = 'topography';
  private tab: Tab = 'core';
  private z0 = 0;
  private z1 = 100;
  private picked: number | null = null;
  private pendingTie: { coreId: string; depthM: number } | null = null;

  private readonly seed = el('input', { value: 'alpha', size: '10' });
  private readonly preset = el('select', {}, ...(['standard', 'dev'] as PresetName[]).map((p) => el('option', { value: p }, p)));
  private readonly go = el('button', {}, 'Generate world');
  private readonly saveBtn = el('button', {}, 'Save');
  private readonly loadBtn = el('button', {}, 'Load');
  private readonly exportBtn = el('button', {}, 'Export…');
  private readonly importInput = el('input', { type: 'file', accept: '.json,application/json' });
  private readonly budget = el('span', { class: 'budget' }, 'budget –');
  private readonly bar = el('div', { class: 'bar' }, el('div'));
  private readonly stage = el('span', { class: 'dim' });
  private readonly map = el('canvas', { width: '512', height: '512' });
  private readonly layerSel = el('select', {}, ...(['topography', 'rock', 'exposure'] as const).map((l) => el('option', { value: l }, l === 'rock' ? 'remote-sensed rock' : l)));
  private readonly cellInfo = el('div', { class: 'dim' }, 'click the map to choose a site');
  private readonly depth = el('input', { value: '200', size: '5' });
  private readonly drillBtn = el('button', {}, 'Drill');
  private readonly surveyBtn = el('button', {}, 'Survey outcrop');
  private readonly coreList = el('div', { class: 'cores' });

  private readonly tabs = (['core', 'correlate', 'age', 'notebook', 'submit', 'reveal'] as Tab[]).map((t) => {
    const b = el('button', { class: 'tab' }, { core: 'Core', correlate: 'Correlate', age: 'Age model', notebook: 'Notebook', submit: 'Submit', reveal: 'Reveal' }[t]);
    b.addEventListener('click', () => { this.tab = t; this.render(); });
    return [t, b] as const;
  });
  private readonly panels: Record<Tab, HTMLElement> = { core: el('div'), correlate: el('div'), age: el('div'), notebook: el('div'), submit: el('div'), reveal: el('div') };

  // core tab
  private readonly core = el('canvas', { width: '860', height: '560' });
  private readonly zFrom = el('input', { value: '0', size: '6' });
  private readonly zTo = el('input', { value: '100', size: '6' });
  private readonly proxySel = el('select', {}, ...PROXY_IDS.map((p) => el('option', { value: p }, `${PROXIES[p].label} (${PROXIES[p].cost}/sample)`)));
  private readonly spacing = el('input', { value: '1', size: '5' });
  private readonly assayBtn = el('button', {}, 'Assay');
  private readonly assayInfo = el('span', { class: 'dim' });
  private readonly pickInfo = el('span', { class: 'dim' }, 'click the core to pick a depth');
  private readonly dateBtn = el('button', {}, 'Date here');
  private readonly effort = el('select', {}, ...[1, 2, 3, 4].map((e) => el('option', { value: String(e) }, `effort ${e}`)));
  private readonly fossilBtn = el('button', {}, 'Collect fossils here');
  private readonly fossilOut = el('div', { class: 'dim' });

  // correlate tab
  private readonly corrCanvas = el('canvas', { width: '860', height: '560' });
  private readonly tieKind = el('select', {}, ...(['ash', 'excursion', 'fossil', 'manual'] as TieKind[]).map((k) => el('option', { value: k }, `${k} (±${TIE_SIGMA_MA[k]} Myr)`)));
  private readonly corrProxy = el('select', {}, el('option', { value: '' }, 'no curve'), ...PROXY_IDS.map((p) => el('option', { value: p }, PROXIES[p].label)));
  private readonly tieList = el('div');
  private readonly corrHint = el('div', { class: 'dim' }, 'click a depth in one core, then a depth in another, to draw a tie');

  // age tab
  private readonly ageCanvas = el('canvas', { width: '700', height: '380' });
  private readonly ageBody = el('div');

  private readonly log = el('div', { class: 'log' });

  constructor(root: HTMLElement, private readonly session: Session) {
    const legendEl = el('div', { class: 'legend' });
    legendEl.innerHTML = legend();
    this.panels.core.append(
      el('div', {}, el('div', { class: 'cores-row' }, 'cores: ', this.coreList), this.core, legendEl,
        el('div', {}, 'depth window ', this.zFrom, '–', this.zTo, ' m   ·   proxy ', this.proxySel, ' every ', this.spacing, ' m ', this.assayBtn, this.assayInfo),
        el('div', {}, this.pickInfo, ' ', this.dateBtn, ' ', this.effort, ' ', this.fossilBtn), this.fossilOut));
    this.panels.correlate.append(
      el('div', {}, 'tie kind ', this.tieKind, ' · curve ', this.corrProxy), this.corrHint, el('div', { class: 'scroll' }, this.corrCanvas), this.tieList);
    this.panels.age.append(this.ageCanvas, this.ageBody);

    root.append(
      el('div', { class: 'top' }, el('b', {}, 'Silur'), ' seed ', this.seed, this.preset, this.go, this.saveBtn, this.loadBtn, this.exportBtn, this.importInput, this.budget, this.bar, this.stage),
      el('div', { class: 'main' },
        el('div', {}, el('div', {}, 'map layer ', this.layerSel), this.map, this.cellInfo,
          el('div', {}, 'core depth (m) ', this.depth, this.drillBtn, ' ', this.surveyBtn), this.log),
        el('div', { class: 'right' }, el('div', { class: 'tabs' }, ...this.tabs.map(([, b]) => b)), ...Object.values(this.panels))),
    );
    this.go.addEventListener('click', () => void this.generate());
    this.saveBtn.addEventListener('click', () => this.saveLocal());
    this.loadBtn.addEventListener('click', () => void this.loadLocal());
    this.exportBtn.addEventListener('click', () => this.exportFile());
    this.importInput.addEventListener('change', () => void this.importFile());
    this.layerSel.addEventListener('change', () => { this.layer = this.layerSel.value as MapLayer; this.redrawMap(); });
    this.map.addEventListener('click', (ev) => {
      if (!this.session.info) return;
      this.selected = cellAt(this.map, this.session.info, ev);
      this.describeCell();
      this.redrawMap();
    });
    this.depth.addEventListener('input', () => this.describeCell());
    this.drillBtn.addEventListener('click', () => void this.drill());
    this.surveyBtn.addEventListener('click', () => void this.survey());
    this.assayBtn.addEventListener('click', () => void this.assay());
    this.dateBtn.addEventListener('click', () => void this.date());
    this.fossilBtn.addEventListener('click', () => void this.fossils());
    for (const e of [this.zFrom, this.zTo, this.spacing, this.proxySel]) e.addEventListener('input', () => { this.readWindow(); this.redrawCore(); this.assayPreview(); });
    this.core.addEventListener('click', (ev) => {
      if (!this.coreId) return;
      this.picked = +Math.max(0.1, coreDepthAt(this.core, ev, this.z0, this.z1)).toFixed(2);
      this.pickInfo.textContent = `picked ${this.picked} m · date ${this.session.info!.costs.date} · fossils ${this.session.info!.costs.fossilsPerEffort}/effort`;
      this.redrawCore();
    });
    this.corrCanvas.addEventListener('click', (ev) => this.corrClick(ev));
    this.corrProxy.addEventListener('change', () => this.redrawCorr());
    this.setEnabled(false);
    this.render();
  }

  private setEnabled(on: boolean): void {
    for (const b of [this.drillBtn, this.surveyBtn, this.assayBtn, this.dateBtn, this.fossilBtn, this.saveBtn, this.exportBtn]) b.disabled = !on;
  }
  private say(msg: string, bad = false): void {
    this.log.prepend(el('div', bad ? { class: 'bad' } : {}, msg));
  }

  // ---------- world lifecycle ----------

  private progress = (stage: Stage, frac: number): void => {
    const total = STAGE_START[stage] + STAGE_SPAN[stage] * frac;
    (this.bar.firstElementChild as HTMLElement).style.width = `${Math.round(total * 100)}%`;
    this.stage.textContent = STAGE_LABEL[stage];
  };

  private resetView(): void {
    this.coreId = null; this.selected = -1; this.picked = null; this.pendingTie = null;
    this.coreList.replaceChildren(); this.log.replaceChildren(); this.fossilOut.replaceChildren();
  }

  private async withBusy(work: () => Promise<void>): Promise<void> {
    this.go.disabled = this.loadBtn.disabled = true; this.setEnabled(false);
    const t0 = performance.now();
    try {
      await work();
      this.stage.textContent = `ready (${((performance.now() - t0) / 1000).toFixed(1)} s)`;
      (this.bar.firstElementChild as HTMLElement).style.width = '100%';
      this.setEnabled(true);
      this.afterChange();
    } catch (e) {
      this.stage.textContent = `failed: ${(e as Error).message}`;
    } finally { this.go.disabled = this.loadBtn.disabled = false; }
  }

  async generate(): Promise<void> {
    this.resetView();
    await this.withBusy(async () => {
      await this.session.start(makeConfig(this.seed.value || 'alpha', this.preset.value as PresetName), this.progress);
      this.say('A new field area. Choose a site on the map: drill a core, or survey an outcrop on land.');
    });
  }

  // ---------- save / load ----------

  private saveLocal(): void {
    try { localStorage.setItem(AUTOSAVE_KEY, serialize(this.session.save())); this.say('Saved in this browser.'); }
    catch (e) { this.say(`could not save: ${(e as Error).message}`, true); }
  }
  private autosave(): void {
    try { if (this.session.config) localStorage.setItem(AUTOSAVE_KEY, serialize(this.session.save())); } catch { /* storage may be unavailable */ }
  }
  private async loadLocal(): Promise<void> {
    let text: string | null = null;
    try { text = localStorage.getItem(AUTOSAVE_KEY); } catch { /* ignore */ }
    if (!text) { this.say('No saved game in this browser.', true); return; }
    await this.restore(text);
  }
  private exportFile(): void {
    const blob = new Blob([serialize(this.session.save())], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `silur-${this.session.config!.seed}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  }
  private async importFile(): Promise<void> {
    const f = this.importInput.files?.[0];
    if (f) await this.restore(await f.text());
    this.importInput.value = '';
  }
  private async restore(text: string): Promise<void> {
    try {
      const { save, warnings } = parseSave(text);
      this.resetView();
      this.seed.value = save.config.seed;
      await this.withBusy(async () => {
        warnings.push(...await this.session.restore(save, this.progress));
        const first = [...this.session.cores.keys()][0];
        if (first) this.selectCore(first);
      });
      for (const w of warnings) this.say(w, true);
      const r = this.session.result;
      if (r) recordGame(storage(), { seed: r.reveal.seed, at: r.reveal.worldHash, total: r.score.totals.total, headlineBits: r.score.totals.headline, statements: r.score.calibration });
      this.say('Game restored.');
    } catch (e) { this.say(`could not load: ${(e as Error).message}`, true); }
  }

  // ---------- actions ----------

  private updateBudget(): void { this.budget.textContent = `budget ${this.session.budget.toFixed(1)}`; }
  private redrawMap(): void {
    if (!this.session.info) return;
    const marks = new Map<number, 'core' | 'outcrop'>();
    for (const c of this.session.cores.values()) marks.set(c.cell, c.source);
    drawMap(this.map, this.session.info, this.layer, this.selected, marks);
  }

  private describeCell(): void {
    const info = this.session.info;
    if (!info || this.selected < 0) return;
    const c = this.selected, d = Number(this.depth.value) || 0, land = info.elevationM[c] >= 0;
    this.cellInfo.textContent = `cell ${c % info.nx},${Math.floor(c / info.nx)} · ${info.elevationM[c].toFixed(0)} m · remote sensing says ${LITHOLOGIES[info.surfaceClass[c]]} · exposure ${info.exposure[c]} % · ≤ ${this.session.drillCostEstimate(c, d).toFixed(1)} to drill ${d} m` +
      (land ? ` · outcrop survey ≈ ${this.session.surveyCostEstimate(50).toFixed(1)}+` : ' · offshore: no outcrop');
  }

  private selectCore(id: string): void {
    const c = this.session.cores.get(id);
    if (!c) return;
    this.coreId = id; this.picked = null;
    this.z0 = 0; this.z1 = Math.max(c.lengthM, 1);
    this.zFrom.value = '0'; this.zTo.value = c.lengthM.toFixed(0);
  }

  private async drill(): Promise<void> {
    if (this.selected < 0 || !this.session.info) { this.say('Choose a site first.', true); return; }
    try {
      const core = await this.session.drill(this.selected, Math.max(1, Number(this.depth.value) || 100));
      this.selectCore(core.coreId);
      this.say(core.cost > 0 ? `Drilled ${core.lengthM.toFixed(0)} m for ${core.cost.toFixed(1)}.` : 'Already drilled — free.');
      this.tab = 'core'; this.afterChange();
    } catch (e) { this.say(msg(e), true); }
  }

  private async survey(): Promise<void> {
    if (this.selected < 0) { this.say('Choose a site first.', true); return; }
    try {
      const sec = await this.session.survey(this.selected);
      this.selectCore(sec.coreId);
      this.say(sec.cost > 0 ? `Measured a ${sec.lengthM.toFixed(0)} m outcrop section for ${sec.cost.toFixed(1)}. Outcrops are weathered and partly covered.` : 'Already surveyed — free.');
      this.tab = 'core'; this.afterChange();
    } catch (e) { this.say(msg(e), true); }
  }

  private readWindow(): void {
    const a = Number(this.zFrom.value), b = Number(this.zTo.value);
    if (a >= 0 && b > a) { this.z0 = a; this.z1 = b; }
  }

  private samplesRequested(): number[] {
    const step = Math.max(0.05, Number(this.spacing.value) || 1);
    const out: number[] = [];
    for (let z = Math.max(this.z0, 0.1); z <= this.z1 && out.length < 400; z += step) out.push(+z.toFixed(2));
    return out;
  }
  private assayPreview(): void {
    const n = this.samplesRequested().length, p = PROXIES[this.proxySel.value as ProxyId];
    this.assayInfo.textContent = ` ${n} samples · cost ${n * p.cost}`;
  }

  private async assay(): Promise<void> {
    if (!this.coreId) { this.say('Drill a core first.', true); return; }
    const proxy = this.proxySel.value as ProxyId;
    const depths = this.samplesRequested();
    try {
      const r = await this.session.assay(this.coreId, proxy, depths);
      const got = r.samples.filter((s) => s.value !== null).length;
      this.say(`${PROXIES[proxy].label}: ${got}/${depths.length} measured for ${r.cost}.`);
      this.afterChange();
    } catch (e) { this.say(msg(e), true); }
  }

  private async date(): Promise<void> {
    if (!this.coreId || this.picked === null) { this.say('Click the core to pick a depth first.', true); return; }
    try {
      const r = await this.session.date(this.coreId, this.picked);
      this.say(r.ageMa === null ? `No date at ${r.depthM} m: ${r.note ?? 'failed'} (cost ${r.cost}).` : `${r.depthM} m: ${r.ageMa.toFixed(3)} ± ${r.sigmaMa.toFixed(3)} Ma (cost ${r.cost}).`, r.ageMa === null);
      this.afterChange();
    } catch (e) { this.say(msg(e), true); }
  }

  private async fossils(): Promise<void> {
    if (!this.coreId || this.picked === null) { this.say('Click the core to pick a depth first.', true); return; }
    try {
      const r = await this.session.fossilSample(this.coreId, this.picked, Number(this.effort.value));
      this.say(`Fossils at ${r.depthM} m: ${r.found.length} forms (cost ${r.cost}).${r.note ? ' ' + r.note : ''}`);
      this.afterChange();
    } catch (e) { this.say(msg(e), true); }
  }

  // ---------- submission ----------

  private async submit(): Promise<void> {
    try {
      const r = await this.session.submit();
      recordGame(storage(), {
        seed: r.reveal.seed, at: r.reveal.worldHash, total: r.score.totals.total, headlineBits: r.score.totals.headline,
        statements: r.score.calibration,
      });
      this.say(`Submitted: ${r.score.totals.total.toFixed(1)} bits.`);
      this.tab = 'reveal';
      this.afterChange();
    } catch (e) { this.say(msg(e), true); }
  }

  // ---------- correlation ----------

  private corrClick(ev: MouseEvent): void {
    const hit = correlationHit(this.corrCanvas, [...this.session.cores.values()], ev);
    if (!hit) return;
    if (!this.pendingTie || this.pendingTie.coreId === hit.coreId) { this.pendingTie = hit; this.corrHint.textContent = `marked ${hit.depthM} m — now click a depth in another core`; }
    else {
      this.session.addTie(this.tieKind.value as TieKind, this.pendingTie, hit);
      this.pendingTie = null; this.corrHint.textContent = 'tie added.';
      this.autosave();
    }
    this.render();
  }

  private redrawCorr(): void {
    const cores = [...this.session.cores.values()];
    this.corrCanvas.width = canvasWidthFor(cores.length);
    drawCorrelation(this.corrCanvas, {
      cores, assays: this.session.assays, ties: this.session.ties, proxy: (this.corrProxy.value || null) as ProxyId | null, pending: this.pendingTie,
    });
    this.tieList.replaceChildren(...this.session.ties.map((t) => {
      const rm = el('button', {}, '✕');
      rm.addEventListener('click', () => { this.session.removeTie(t.id); this.autosave(); this.render(); });
      return el('div', {}, el('span', { style: `color:${TIE_COLORS[t.kind]}` }, `${t.kind} `), `${t.a.coreId} @ ${t.a.depthM} m ↔ ${t.b.coreId} @ ${t.b.depthM} m (±${t.sigmaMa} Myr) `, rm);
    }));
  }

  // ---------- age tab ----------

  private redrawAge(): void {
    const core = this.coreId ? this.session.cores.get(this.coreId) : undefined;
    const model = core ? this.session.ageModel(core.coreId) : undefined;
    drawAgeDepth(this.ageCanvas, model, core?.lengthM ?? 1);
    this.ageBody.replaceChildren(segmentTable(model), rangeTable(core ? this.session.fossilsFor(core.coreId) : [], model));
  }

  // ---------- rendering ----------

  private afterChange(): void {
    this.updateBudget();
    this.coreList.replaceChildren(...[...this.session.cores.values()].map((c) => {
      const nx = this.session.info!.nx;
      const b = el('button', c.coreId === this.coreId ? { class: 'sel' } : {}, `${c.source === 'outcrop' ? '▫ ' : ''}${c.cell % nx},${Math.floor(c.cell / nx)} (${c.lengthM.toFixed(0)} m)`);
      b.addEventListener('click', () => { this.selectCore(c.coreId); this.afterChange(); });
      return b;
    }));
    this.assayPreview();
    this.autosave();
    this.render();
  }

  private render(): void {
    const closed = this.session.result !== null;
    for (const [t, b] of this.tabs) { b.classList.toggle('sel', t === this.tab); if (t === 'reveal') b.style.display = closed ? '' : 'none'; }
    if (closed) for (const b of [this.drillBtn, this.surveyBtn, this.assayBtn, this.dateBtn, this.fossilBtn]) b.disabled = true;
    for (const [t, p] of Object.entries(this.panels)) p.style.display = t === this.tab ? '' : 'none';
    this.redrawMap();
    if (!this.session.info) return;
    if (this.tab === 'core') { this.redrawCore(); this.renderFossilList(); }
    else if (this.tab === 'correlate') this.redrawCorr();
    else if (this.tab === 'age') this.redrawAge();
    else if (this.tab === 'submit') {
      if (closed) this.panels.submit.replaceChildren(el('div', { class: 'dim' }, 'Submitted. See the Reveal tab.'));
      else renderSubmit(this.panels.submit, {
        draft: () => this.session.draft, durationMyr: () => this.session.config!.durationMyr, budgetLeft: () => this.session.budget,
        changed: () => { this.autosave(); this.render(); }, submit: () => void this.submit(),
      });
    } else if (this.tab === 'reveal') {
      if (this.session.result) renderReveal(this.panels.reveal, this.session.result, this.session.draft, loadHistory(storage()));
    } else renderNotebook(this.panels.notebook, {
      notebook: () => this.session.notebook,
      actionCount: () => this.session.actionCount,
      candidateEvidence: () => this.evidenceCandidates(),
      changed: () => { this.autosave(); this.render(); },
    });
  }

  private evidenceCandidates(): EvidenceRef[] {
    const out: EvidenceRef[] = [];
    if (this.coreId) {
      const c = this.session.cores.get(this.coreId)!;
      out.push({ kind: 'core', ref: c.coreId, label: `${c.source} ${c.coreId}` });
      for (const proxy of this.session.assays.get(this.coreId)?.keys() ?? []) out.push({ kind: 'assay', ref: `${c.coreId}/${proxy}`, label: `${PROXIES[proxy].label} in ${c.coreId}` });
      for (const d of this.session.dates.get(this.coreId) ?? []) if (d.ageMa !== null) out.push({ kind: 'date', ref: `${c.coreId}@${d.depthM}`, label: `${d.ageMa.toFixed(2)} Ma at ${d.depthM} m in ${c.coreId}` });
    }
    for (const t of this.session.ties) out.push({ kind: 'tie', ref: t.id, label: `${t.kind} tie ${t.a.coreId}↔${t.b.coreId}` });
    return out;
  }

  private redrawCore(): void {
    const g = this.core.getContext('2d')!;
    const core = this.coreId ? this.session.cores.get(this.coreId) : undefined;
    if (!core) { g.clearRect(0, 0, this.core.width, this.core.height); g.fillStyle = '#789'; g.fillText('no core selected', 20, 30); return; }
    drawCore(this.core, core, this.session.assays.get(core.coreId), this.z0, this.z1, {
      dates: this.session.dates.get(core.coreId) ?? [], fossils: this.session.fossilsFor(core.coreId), pickedM: this.picked,
    });
  }

  private renderFossilList(): void {
    const fs = this.coreId ? this.session.fossilsFor(this.coreId) : [];
    this.fossilOut.replaceChildren(...fs.map((f) => el('div', {}, `${f.depthM} m (effort ${f.effort}): ` +
      (f.found.length ? f.found.map((m) => `${m.name} ×${m.count} [${m.habit}, ${m.size}]`).join(', ') : f.note ?? 'nothing recognisable'))));
  }
}

function storage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null {
  try { return localStorage; } catch { return null; }
}

function msg(e: unknown): string {
  return e instanceof ActionError ? `${e.code}: ${e.message}` : (e as Error).message;
}
