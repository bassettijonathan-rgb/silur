/** Player-side state: what has been bought, what has been inferred. Knows the protocol, never the world. */
import { ObservationClient } from '../client/client';
import { WorldConfig } from '../shared/config';
import {
  Action, AssayResult, AssaySample, CoreResult, DateResult, FossilResult, Measurement, PublicInfo, Stage,
} from '../shared/protocol';
import { ProxyId } from '../shared/proxies';
import { AgeModel, AgePoint } from './agemodel';
import { CoreAges, Tie, TieEnd, TieKind, makeTie, propagateAges } from './correlation';
import { RevealMessage } from '../shared/reveal';
import { Submission } from '../shared/submission';
import { emptyDraft } from './draft';
import { Notebook } from './notebook';
import { SAVE_VERSION, SaveFile, actionKey } from './save';

export class Session {
  info: PublicInfo | null = null;
  config: WorldConfig | null = null;
  budget = 0;
  readonly cores = new Map<string, CoreResult>();
  /** coreId → proxy → samples (merged by depth). */
  readonly assays = new Map<string, Map<ProxyId, AssaySample[]>>();
  /** coreId → radiometric dates (only successful ones carry an age). */
  readonly dates = new Map<string, DateResult[]>();
  /** Every fossil sample: key `${coreId}@${depth}x${effort}`. */
  readonly fossils = new Map<string, FossilResult>();
  ties: Tie[] = [];
  notebook = new Notebook();
  draft: Submission = emptyDraft();
  /** Set once the answer is in: the score and the revealed truth. The investigation is then closed. */
  result: RevealMessage | null = null;
  private nextTie = 1;
  private readonly log = new Map<string, Action>();

  constructor(private readonly client: ObservationClient) {}

  private reset(): void {
    this.cores.clear(); this.assays.clear(); this.dates.clear(); this.fossils.clear();
    this.ties = []; this.notebook = new Notebook(); this.nextTie = 1; this.log.clear();
    this.draft = emptyDraft(); this.result = null;
  }

  async start(config: WorldConfig, onProgress: (stage: Stage, frac: number) => void): Promise<PublicInfo> {
    this.reset();
    this.config = config;
    this.info = await this.client.generate(config, onProgress);
    this.budget = this.info.budget;
    return this.info;
  }

  get actionCount(): number { return this.log.size; }

  /** Send an action, record the result. Failed actions are not logged. */
  private async act(action: Action): Promise<Measurement> {
    const m = await this.client.act(action);
    this.log.set(actionKey(action), action);
    this.budget = m.budgetLeft;
    return m;
  }

  drillCostEstimate(cell: number, depthM: number): number {
    const i = this.info!;
    const offshore = i.elevationM[cell] < 0;
    return (i.drillCost.base + i.drillCost.perMeter * depthM) * (offshore ? i.drillCost.offshoreFactor : 1);
  }
  surveyCostEstimate(lengthM: number): number { return this.info!.costs.survey.base + this.info!.costs.survey.perMeter * lengthM; }

  private takeCore(m: Measurement): CoreResult {
    if (m.kind !== 'core') throw new Error('unexpected reply');
    // A repeat is free and identical: keep the first record (with its real cost).
    const known = this.cores.get(m.coreId);
    if (known) return known;
    this.cores.set(m.coreId, m);
    return m;
  }
  async drill(cell: number, depthM: number): Promise<CoreResult> { return this.takeCore(await this.act({ kind: 'drill', cell, depthM })); }
  /** Walk and measure the exposed rock at a land cell. */
  async survey(cell: number): Promise<CoreResult> { return this.takeCore(await this.act({ kind: 'survey', cell })); }

  async assay(coreId: string, proxy: ProxyId, depthsM: number[]): Promise<AssayResult> {
    const m = await this.act({ kind: 'assay', coreId, proxy, depthsM });
    if (m.kind !== 'assay') throw new Error('unexpected reply');
    let byProxy = this.assays.get(coreId);
    if (!byProxy) { byProxy = new Map(); this.assays.set(coreId, byProxy); }
    const merged = new Map<number, AssaySample>();
    for (const s of byProxy.get(proxy) ?? []) merged.set(s.depthM, s);
    for (const s of m.samples) merged.set(s.depthM, s);
    byProxy.set(proxy, [...merged.values()].sort((a, b) => a.depthM - b.depthM));
    return m;
  }

  async date(coreId: string, depthM: number): Promise<DateResult> {
    const m = await this.act({ kind: 'date', coreId, depthM });
    if (m.kind !== 'date') throw new Error('unexpected reply');
    const list = this.dates.get(coreId) ?? [];
    if (!list.some((d) => d.depthM === m.depthM)) list.push(m);
    list.sort((a, b) => a.depthM - b.depthM);
    this.dates.set(coreId, list);
    return m;
  }

  async fossilSample(coreId: string, depthM: number, effort: number): Promise<FossilResult> {
    const m = await this.act({ kind: 'fossils', coreId, depthM, effort });
    if (m.kind !== 'fossils') throw new Error('unexpected reply');
    this.fossils.set(`${coreId}@${depthM}x${effort}`, m);
    return m;
  }

  fossilsFor(coreId: string): FossilResult[] {
    return [...this.fossils.values()].filter((f) => f.coreId === coreId).sort((a, b) => a.depthM - b.depthM);
  }

  // ---- inference (no budget involved) ----

  addTie(kind: TieKind, a: TieEnd, b: TieEnd, sigmaMa?: number, note?: string): Tie {
    if (a.coreId === b.coreId) throw new Error('a tie joins two different cores');
    const t = makeTie(`t${this.nextTie++}`, kind, a, b, sigmaMa, note);
    this.ties.push(t);
    return t;
  }
  removeTie(id: string): void { this.ties = this.ties.filter((t) => t.id !== id); }

  /** Radiometric points per core (successful dates only). */
  datePoints(): Map<string, AgePoint[]> {
    const out = new Map<string, AgePoint[]>();
    for (const [id, list] of this.dates) {
      out.set(id, list.filter((d) => d.ageMa !== null).map((d) => ({ depthM: d.depthM, ageMa: d.ageMa!, sigmaMa: d.sigmaMa, origin: 'date' as const })));
    }
    return out;
  }
  ages(): CoreAges { return propagateAges([...this.cores.keys()], this.datePoints(), this.ties); }
  ageModel(coreId: string): AgeModel | undefined { return this.ages().models.get(coreId); }

  async submit(): Promise<RevealMessage> {
    this.result = await this.client.submit(this.draft);
    return this.result;
  }

  // ---- save / load ----

  save(): SaveFile {
    if (!this.config) throw new Error('nothing to save');
    return {
      format: 'silur-save', version: SAVE_VERSION, config: this.config, actions: [...this.log.values()],
      ties: this.ties.map((t) => ({ ...t })), notebook: this.notebook.toJSON(), nextTie: this.nextTie, budgetLeft: this.budget,
      draft: this.draft, submitted: this.result !== null,
    };
  }

  /** Regenerate the world and replay the purchases. Throws if the replay does not reproduce the saved budget. */
  async restore(save: SaveFile, onProgress: (stage: Stage, frac: number) => void): Promise<string[]> {
    await this.start(save.config, onProgress);
    const warnings: string[] = [];
    for (const a of save.actions) {
      switch (a.kind) {
        case 'drill': await this.drill(a.cell, a.depthM); break;
        case 'survey': await this.survey(a.cell); break;
        case 'assay': await this.assay(a.coreId, a.proxy, a.depthsM); break;
        case 'date': await this.date(a.coreId, a.depthM); break;
        case 'fossils': await this.fossilSample(a.coreId, a.depthM, a.effort); break;
      }
    }
    this.ties = save.ties.map((t) => ({ ...t }));
    this.nextTie = save.nextTie;
    this.notebook = Notebook.fromJSON(save.notebook);
    if (save.draft) this.draft = save.draft;
    if (save.submitted) await this.submit();
    if (Number.isFinite(save.budgetLeft) && Math.abs(save.budgetLeft - this.budget) > 1e-6) {
      warnings.push(`replayed budget ${this.budget.toFixed(2)} differs from saved ${save.budgetLeft.toFixed(2)}: the world is not the one that was saved`);
    }
    return warnings;
  }
}
