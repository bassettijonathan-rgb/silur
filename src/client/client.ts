/** Main-thread proxy to the observation service. Knows the protocol, nothing about the world. */
import { WorldConfig } from '../shared/config';
import { Action, ClientMessage, ErrorCode, Measurement, PublicInfo, ServerMessage, Stage } from '../shared/protocol';

export interface Transport {
  post(m: ClientMessage): void;
  subscribe(cb: (m: ServerMessage) => void): void;
}

export class ActionError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); }
}

export class ObservationClient {
  private nextReq = 1;
  private readonly pending = new Map<number, { ok: (m: Measurement) => void; err: (e: ActionError) => void }>();
  private gen: { ok: (i: PublicInfo) => void; err: (e: ActionError) => void; onProgress?: (s: Stage, f: number) => void } | null = null;

  constructor(private readonly transport: Transport) {
    transport.subscribe((m) => this.onMessage(m));
  }

  private onMessage(m: ServerMessage): void {
    switch (m.kind) {
      case 'progress': this.gen?.onProgress?.(m.stage, m.frac); return;
      case 'ready': this.gen?.ok(m.info); this.gen = null; return;
      case 'result': { const p = this.pending.get(m.reqId); this.pending.delete(m.reqId); p?.ok(m.measurement); return; }
      case 'error': {
        const e = new ActionError(m.code, m.message);
        if (m.reqId === undefined) { this.gen?.err(e); this.gen = null; return; }
        const p = this.pending.get(m.reqId); this.pending.delete(m.reqId); p?.err(e);
        return;
      }
    }
  }

  generate(config: WorldConfig, onProgress?: (s: Stage, f: number) => void): Promise<PublicInfo> {
    return new Promise((ok, err) => {
      this.gen = { ok, err, onProgress };
      this.transport.post({ kind: 'generate', config });
    });
  }

  act(action: Action): Promise<Measurement> {
    return new Promise((ok, err) => {
      const reqId = this.nextReq++;
      this.pending.set(reqId, { ok, err });
      this.transport.post({ kind: 'act', reqId, action });
    });
  }

  submit(submission: unknown): Promise<Measurement> {
    return new Promise((ok, err) => {
      const reqId = this.nextReq++;
      this.pending.set(reqId, { ok, err });
      this.transport.post({ kind: 'submit', reqId, submission });
    });
  }
}
