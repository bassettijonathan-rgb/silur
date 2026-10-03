/**
 * Save files (pure, Layer 3). The world is not stored: it is regenerated from (config, modelVersion), and the
 * player's purchases are replayed from the action log. Observations are deterministic and order-independent,
 * so replay gives back exactly the same cores, assays, dates and fossils. Ties and the notebook are stored as is.
 */
import { MODEL_VERSION, WorldConfig } from '../shared/config';
import { Action } from '../shared/protocol';
import { Tie } from './correlation';
import { Hypothesis } from './notebook';

export const SAVE_VERSION = 1;

export interface SaveFile {
  format: 'silur-save';
  version: number;
  config: WorldConfig;
  /** Successful, de-duplicated actions in the order they were first taken. */
  actions: Action[];
  ties: Tie[];
  notebook: { items: Hypothesis[]; nextId: number };
  /** Next tie id counter. */
  nextTie: number;
  /** Cost/budget at save time: a replay must end here, otherwise the save belongs to a different model. */
  budgetLeft: number;
}

export function serialize(save: SaveFile): string { return JSON.stringify(save); }

export function parseSave(text: string): { save: SaveFile; warnings: string[] } {
  const d = JSON.parse(text) as Partial<SaveFile>;
  if (d.format !== 'silur-save' || !d.config || !Array.isArray(d.actions)) throw new Error('not a Silur save file');
  if ((d.version ?? 0) > SAVE_VERSION) throw new Error(`save file version ${d.version} is newer than this game understands`);
  const warnings: string[] = [];
  if (d.config.modelVersion !== MODEL_VERSION) warnings.push(`saved with model ${d.config.modelVersion}, this game runs ${MODEL_VERSION}: the world may differ`);
  return {
    save: {
      format: 'silur-save', version: d.version ?? SAVE_VERSION, config: d.config, actions: d.actions,
      ties: d.ties ?? [], notebook: d.notebook ?? { items: [], nextId: 1 }, nextTie: d.nextTie ?? 1, budgetLeft: d.budgetLeft ?? NaN,
    },
    warnings,
  };
}

/** Stable identity of an action, so asking twice does not clutter the log. */
export function actionKey(a: Action): string {
  switch (a.kind) {
    case 'drill': return `drill|${a.cell}|${a.depthM}`;
    case 'survey': return `survey|${a.cell}`;
    case 'assay': return `assay|${a.coreId}|${a.proxy}|${a.depthsM.join(',')}`;
    case 'date': return `date|${a.coreId}|${a.depthM}`;
    case 'fossils': return `fossils|${a.coreId}|${a.depthM}|${a.effort}`;
  }
}
