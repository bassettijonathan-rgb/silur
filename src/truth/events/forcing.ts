/** Sum the rate-type effects of all forced events into one `Forcing` per plan step. */
import { Forcing, ForcingProvider, addForcing, zeroForcing } from '../../shared/forcing';
import { bolideForcing } from './bolide';
import { aridificationForcing } from './aridification';
import { clathrateForcing } from './clathrate';
import { lipForcing } from './lip';
import { supernovaForcing } from './supernova';
import { ForcedEvent } from './types';

export function eventForcing(events: ForcedEvent[]): ForcingProvider {
  return (a0: number, a1: number): Forcing => {
    let f = zeroForcing();
    for (const e of events) {
      // cheap reject: events are short compared with the record
      const reach = e.kind === 'lip' ? e.durationMyr + 0.5 : e.kind === 'aridification' ? e.durationKyr / 1000 + 0.1 : 1.2;
      if (a1 > e.ageMa || a0 < e.ageMa - reach) continue;
      switch (e.kind) {
        case 'lip': f = addForcing(f, lipForcing(e, a0, a1)); break;
        case 'bolide': f = addForcing(f, bolideForcing(e, a0, a1)); break;
        case 'clathrate': f = addForcing(f, clathrateForcing(e, a0, a1)); break;
        case 'supernova': f = addForcing(f, supernovaForcing(e, a0, a1)); break;
        case 'aridification': f = addForcing(f, aridificationForcing(e, a0, a1)); break;
      }
    }
    return f;
  };
}
