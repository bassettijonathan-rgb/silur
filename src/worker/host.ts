/**
 * WorkerHost: owns the hidden World and the observation service and speaks the protocol. It is a plain class
 * so tests can drive it in-process; `worker.ts` is the thin Web Worker wrapper around it.
 */
import { WorldConfig } from '../shared/config';
import { ClientMessage, ServerMessage } from '../shared/protocol';
import { ObservationService } from '../observation/service';
import { generateSolvableWorld, Solvability } from '../observation/solvability/gate';
import { Progress, World } from '../truth/world';

export type WorldFactory = (config: WorldConfig, progress: Progress) => World;

/** The real factory: draw a world and make sure the ideal observer finds the puzzle fair (redrawing up to maxTries times). */
export function solvableFactory(host: { lastSolvability: Solvability | null }): WorldFactory {
  return (config, progress) => {
    const { world, solvability } = generateSolvableWorld(config, progress);
    host.lastSolvability = solvability;
    return world;
  };
}

export class WorkerHost {
  private service: ObservationService | null = null;
  /** Sealed until the reveal (M7). */
  lastSolvability: Solvability | null = null;
  private readonly makeWorld: WorldFactory;

  constructor(makeWorld?: WorldFactory) {
    this.makeWorld = makeWorld ?? solvableFactory(this);
  }

  handle(msg: ClientMessage, send: (m: ServerMessage) => void): void {
    switch (msg.kind) {
      case 'generate': {
        this.service = null;
        try {
          let last = -1;
          const world = this.makeWorld(msg.config, (stage, frac) => {
            const q = Math.round(frac * 20); // at most ~20 messages per stage
            if (q !== last || frac === 0) { last = q; send({ kind: 'progress', stage, frac }); }
          });
          this.service = new ObservationService(world);
          send({ kind: 'ready', info: this.service.publicInfo() });
        } catch (e) {
          send({ kind: 'error', code: 'bad_request', message: `world generation failed: ${(e as Error).message}` });
        }
        return;
      }
      case 'act': {
        if (!this.service) { send({ kind: 'error', reqId: msg.reqId, code: 'not_ready', message: 'no world yet' }); return; }
        const r = this.service.execute(msg.action);
        if (r.ok) send({ kind: 'result', reqId: msg.reqId, measurement: r.measurement });
        else send({ kind: 'error', reqId: msg.reqId, code: r.code, message: r.message });
        return;
      }
      case 'submit':
        // Scoring and the reveal arrive in M7; until then the truth stays sealed.
        send({ kind: 'error', reqId: msg.reqId, code: 'sealed', message: 'submission and reveal are not available yet' });
        return;
    }
  }
}
