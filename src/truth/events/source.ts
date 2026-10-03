/**
 * Instantaneous deposits of events, as a StratSource: impact ejecta (clay with Ir, spherules, shocked quartz,
 * charcoal), tsunamites, ash beds and ⁶⁰Fe fallout. Concentrations are NOT set here — only extensive amounts
 * are added; dilution, condensation and bioturbation then act on them exactly as on any other sediment.
 */
import { FLAG } from '../strat/column';
import { StratCellCtx, StratSource } from '../strat/simulate';
import { T } from '../strat/tracers';
import { TimePlan, stepAtAge } from '../../shared/timeplan';
import { ashThickness } from './ash';
import { ejectaAt } from './bolide';
import { AshEvent, ForcedEvent } from './types';

type Instant = ForcedEvent & { kind: 'bolide' | 'supernova' } | AshEvent;

export class EventSource implements StratSource {
  private readonly byStep = new Map<number, Instant[]>();

  constructor(forced: ForcedEvent[], ashes: AshEvent[], plan: TimePlan) {
    const put = (e: Instant) => {
      const s = stepAtAge(plan, e.ageMa - 1e-7);
      const l = this.byStep.get(s);
      if (l) l.push(e); else this.byStep.set(s, [e]);
    };
    for (const e of forced) if (e.kind === 'bolide' || e.kind === 'supernova') put(e);
    for (const a of ashes) put(a);
  }

  add(step: number, _cell: number, _dtYr: number, _ageMa: number, tr: Float64Array, ctx: StratCellCtx): number {
    const list = this.byStep.get(step);
    if (!list) return 0;
    let flags = 0;
    for (const e of list) {
      if (e.kind === 'bolide') {
        const r = Math.hypot(ctx.x - e.xKm, ctx.y - e.yKm);
        const j = ejectaAt(e, r);
        tr[T.clastic] += j.clayM;
        tr[T.Ir] += j.irNg;
        tr[T.spherules] += j.spherules;
        tr[T.shockedQz] += j.quartz;
        tr[T.charcoal] += j.charcoalG;
        tr[T.persistOrg] += j.persist;
        flags |= FLAG.EVENT | FLAG.EJECTA;
        if (ctx.waterDepth > 0 && ctx.waterDepth < 200 && e.diameterKm >= 2) {
          const sand = 0.2 * (e.diameterKm / 10) ** 2 * Math.exp(-r / 1500);
          if (sand > 0.001) { tr[T.clastic] += sand; tr[T.sand] += sand; flags |= FLAG.TSUNAMI | FLAG.EVENT; }
        }
      } else if (e.kind === 'supernova') {
        tr[T.Fe60] += e.fe60;
      } else {
        const dx = ctx.x - e.xKm, dy = ctx.y - e.yKm;
        const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
        const h = ashThickness(e, Math.hypot(dx, dy), bearing);
        if (h > 0.001) { tr[T.ash] += h; tr[T.ashAge] += h * e.ageMa; flags |= FLAG.ASH; }
      }
    }
    return flags;
  }
}
