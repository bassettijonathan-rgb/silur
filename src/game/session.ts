/** Player-side state: what has been bought so far. Knows the protocol, never the world. */
import { ObservationClient } from '../client/client';
import { makeConfig } from '../shared/config';
import { AssayResult, AssaySample, CoreResult, PublicInfo, Stage } from '../shared/protocol';
import { ProxyId } from '../shared/proxies';

export class Session {
  info: PublicInfo | null = null;
  budget = 0;
  readonly cores = new Map<string, CoreResult>();
  /** coreId → proxy → samples (merged by depth). */
  readonly assays = new Map<string, Map<ProxyId, AssaySample[]>>();

  constructor(private readonly client: ObservationClient) {}

  async start(seed: string, onProgress: (stage: Stage, frac: number) => void): Promise<PublicInfo> {
    this.cores.clear();
    this.assays.clear();
    this.info = await this.client.generate(makeConfig(seed, 'standard'), onProgress);
    this.budget = this.info.budget;
    return this.info;
  }

  drillCostEstimate(cell: number, depthM: number): number {
    const i = this.info!;
    const offshore = i.elevationM[cell] < 0;
    return (i.drillCost.base + i.drillCost.perMeter * depthM) * (offshore ? i.drillCost.offshoreFactor : 1);
  }

  async drill(cell: number, depthM: number): Promise<CoreResult> {
    const m = await this.client.act({ kind: 'drill', cell, depthM });
    if (m.kind !== 'core') throw new Error('unexpected reply');
    this.cores.set(m.coreId, m);
    this.budget = m.budgetLeft;
    return m;
  }

  async assay(coreId: string, proxy: ProxyId, depthsM: number[]): Promise<AssayResult> {
    const m = await this.client.act({ kind: 'assay', coreId, proxy, depthsM });
    if (m.kind !== 'assay') throw new Error('unexpected reply');
    this.budget = m.budgetLeft;
    let byProxy = this.assays.get(coreId);
    if (!byProxy) { byProxy = new Map(); this.assays.set(coreId, byProxy); }
    const merged = new Map<number, AssaySample>();
    for (const s of byProxy.get(proxy) ?? []) merged.set(s.depthM, s);
    for (const s of m.samples) merged.set(s.depthM, s);
    byProxy.set(proxy, [...merged.values()].sort((a, b) => a.depthM - b.depthM));
    return m;
  }
}
