/** The playable slice (M4): generate a world, pick a spot, drill, read the core, assay proxies. */
import { ActionError } from '../client/client';
import { Session } from '../game/session';
import { LITHOLOGIES } from '../shared/lithology';
import { Stage } from '../shared/protocol';
import { PROXIES, PROXY_IDS, ProxyId } from '../shared/proxies';
import { drawCore, legend } from './coreView';
import { el } from './dom';
import { MapLayer, cellAt, drawMap } from './mapView';

const STAGE_LABEL: Record<Stage, string> = {
  planet: 'sampling a planet and its history of catastrophes…', earth: 'running the carbon cycle and climate…',
  biosphere: 'evolving life…', strata: 'laying down the rocks…', catalog: 'cataloguing…',
};
const STAGE_START: Record<Stage, number> = { planet: 0, earth: 0.02, biosphere: 0.1, strata: 0.15, catalog: 0.98 };
const STAGE_SPAN: Record<Stage, number> = { planet: 0.02, earth: 0.08, biosphere: 0.05, strata: 0.83, catalog: 0.02 };

export class App {
  private selected = -1;
  private coreId: string | null = null;
  private layer: MapLayer = 'topography';
  private z0 = 0;
  private z1 = 100;

  private readonly seed = el('input', { value: 'alpha', size: '10' });
  private readonly go = el('button', {}, 'Generate world');
  private readonly budget = el('span', { class: 'budget' }, 'budget –');
  private readonly bar = el('div', { class: 'bar' }, el('div'));
  private readonly stage = el('span', { class: 'dim' });
  private readonly map = el('canvas', { width: '512', height: '512' });
  private readonly layerSel = el('select', {}, ...(['topography', 'rock', 'exposure'] as const).map((l) => el('option', { value: l }, l === 'rock' ? 'remote-sensed rock' : l)));
  private readonly cellInfo = el('div', { class: 'dim' }, 'click the map to choose a drill site');
  private readonly depth = el('input', { value: '200', size: '5' });
  private readonly drillBtn = el('button', {}, 'Drill');
  private readonly coreList = el('div', { class: 'cores' });
  private readonly core = el('canvas', { width: '760', height: '560' });
  private readonly zFrom = el('input', { value: '0', size: '6' });
  private readonly zTo = el('input', { value: '100', size: '6' });
  private readonly proxySel = el('select', {}, ...PROXY_IDS.map((p) => el('option', { value: p }, `${PROXIES[p].label} (${PROXIES[p].cost}/sample)`)));
  private readonly spacing = el('input', { value: '1', size: '5' });
  private readonly assayBtn = el('button', {}, 'Assay');
  private readonly assayInfo = el('span', { class: 'dim' });
  private readonly log = el('div', { class: 'log' });

  constructor(root: HTMLElement, private readonly session: Session) {
    const legendEl = el('div', { class: 'legend' });
    legendEl.innerHTML = legend();
    root.append(
      el('div', { class: 'top' }, el('b', {}, 'Silur'), ' seed ', this.seed, this.go, this.budget, this.bar, this.stage),
      el('div', { class: 'main' },
        el('div', {}, el('div', {}, 'map layer ', this.layerSel), this.map, this.cellInfo,
          el('div', {}, 'core depth (m) ', this.depth, this.drillBtn)),
        el('div', {}, el('div', {}, 'cores: ', this.coreList), this.core, legendEl,
          el('div', {}, 'depth window ', this.zFrom, '–', this.zTo, ' m   ·   proxy ', this.proxySel, ' every ', this.spacing, ' m ', this.assayBtn, this.assayInfo),
          this.log)),
    );
    this.go.addEventListener('click', () => void this.generate());
    this.layerSel.addEventListener('change', () => { this.layer = this.layerSel.value as MapLayer; this.redrawMap(); });
    this.map.addEventListener('click', (ev) => {
      if (!this.session.info) return;
      this.selected = cellAt(this.map, this.session.info, ev);
      this.describeCell();
      this.redrawMap();
    });
    this.depth.addEventListener('input', () => this.describeCell());
    this.drillBtn.addEventListener('click', () => void this.drill());
    this.assayBtn.addEventListener('click', () => void this.assay());
    for (const e of [this.zFrom, this.zTo, this.spacing, this.proxySel]) e.addEventListener('input', () => { this.readWindow(); this.redrawCore(); this.assayPreview(); });
    this.setEnabled(false);
  }

  private setEnabled(on: boolean): void { this.drillBtn.disabled = !on; this.assayBtn.disabled = !on; }
  private say(msg: string, bad = false): void {
    const d = el('div', bad ? { class: 'bad' } : {}, msg);
    this.log.prepend(d);
  }

  async generate(): Promise<void> {
    this.go.disabled = true; this.setEnabled(false);
    this.coreId = null; this.selected = -1; this.coreList.replaceChildren(); this.log.replaceChildren();
    const t0 = performance.now();
    try {
      await this.session.start(this.seed.value || 'alpha', (stage, frac) => {
        const total = STAGE_START[stage] + STAGE_SPAN[stage] * frac;
        (this.bar.firstElementChild as HTMLElement).style.width = `${Math.round(total * 100)}%`;
        this.stage.textContent = STAGE_LABEL[stage];
      });
      this.stage.textContent = `ready (${((performance.now() - t0) / 1000).toFixed(1)} s)`;
      (this.bar.firstElementChild as HTMLElement).style.width = '100%';
      this.say('A new field area. Choose a site on the map and drill.');
      this.setEnabled(true);
      this.redrawMap(); this.updateBudget(); this.redrawCore();
    } catch (e) {
      this.stage.textContent = `failed: ${(e as Error).message}`;
    } finally { this.go.disabled = false; }
  }

  private updateBudget(): void { this.budget.textContent = `budget ${this.session.budget.toFixed(1)}`; }
  private redrawMap(): void {
    if (this.session.info) drawMap(this.map, this.session.info, this.layer, this.selected, new Set([...this.session.cores.values()].map((c) => c.cell)));
  }

  private describeCell(): void {
    const info = this.session.info;
    if (!info || this.selected < 0) return;
    const c = this.selected, d = Number(this.depth.value) || 0;
    this.cellInfo.textContent = `cell ${c % info.nx},${Math.floor(c / info.nx)} · ${info.elevationM[c].toFixed(0)} m · remote sensing says ${LITHOLOGIES[info.surfaceClass[c]]} · exposure ${info.exposure[c]} % · ≤ ${this.session.drillCostEstimate(c, d).toFixed(1)} to drill ${d} m`;
  }

  private async drill(): Promise<void> {
    if (this.selected < 0 || !this.session.info) { this.say('Choose a site first.', true); return; }
    try {
      const core = await this.session.drill(this.selected, Math.max(1, Number(this.depth.value) || 100));
      this.coreId = core.coreId;
      this.z0 = 0; this.z1 = Math.max(core.lengthM, 1);
      this.zFrom.value = '0'; this.zTo.value = core.lengthM.toFixed(0);
      this.say(core.cost > 0 ? `Drilled ${core.lengthM.toFixed(0)} m for ${core.cost.toFixed(1)}.` : 'Already drilled — free.');
      this.afterChange();
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

  private afterChange(): void {
    this.updateBudget(); this.redrawMap(); this.redrawCore(); this.assayPreview();
    this.coreList.replaceChildren(...[...this.session.cores.values()].map((c) => {
      const b = el('button', c.coreId === this.coreId ? { class: 'sel' } : {}, `${c.cell % this.session.info!.nx},${Math.floor(c.cell / this.session.info!.nx)} (${c.lengthM.toFixed(0)} m)`);
      b.addEventListener('click', () => { this.coreId = c.coreId; this.z0 = 0; this.z1 = c.lengthM; this.zFrom.value = '0'; this.zTo.value = c.lengthM.toFixed(0); this.afterChange(); });
      return b;
    }));
  }

  private redrawCore(): void {
    const g = this.core.getContext('2d')!;
    const core = this.coreId ? this.session.cores.get(this.coreId) : undefined;
    if (!core) { g.clearRect(0, 0, this.core.width, this.core.height); g.fillStyle = '#789'; g.fillText('no core selected', 20, 30); return; }
    drawCore(this.core, core, this.session.assays.get(core.coreId), this.z0, this.z1);
  }
}

function msg(e: unknown): string {
  return e instanceof ActionError ? `${e.code}: ${e.message}` : (e as Error).message;
}
