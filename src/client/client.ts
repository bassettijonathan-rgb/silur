/** Main-thread proxy to the observation service. Knows the protocol, nothing about the world. */
import { WorldConfig } from '../shared/config';
import { Action, ClientMessage, ErrorCode, Measurement, PublicInfo, ServerMessage, Stage } from '../shared/protocol';
import { RevealMessage } from '../shared/reveal';
import { Submission } from '../shared/submission';

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
  private readonly pendingSubmit = new Map<number, { ok: (m: RevealMessage) => void; err: (e: ActionError) => void }>();
  private gen: { ok: (i: PublicInfo) => void; err: (e: ActionError) => void; onProgress?: (s: Stage, f: number, attempt?: number) => void } | null = null;

  constructor(private readonly transport: Transport) {
    transport.subscribe((m) => this.onMessage(m));
  }

  private onMessage(m: ServerMessage): void {
    switch (m.kind) {
      case 'progress': this.gen?.onProgress?.(m.stage, m.frac, m.attempt); return;
      case 'ready': this.gen?.ok(m.info); this.gen = null; return;
      case 'result': { const p = this.pending.get(m.reqId); this.pending.delete(m.reqId); p?.ok(m.measurement); return; }
      case 'revealed': { const p = this.pendingSubmit.get(m.reqId); this.pendingSubmit.delete(m.reqId); p?.ok({ score: m.score, reveal: m.reveal }); return; }
      case 'error': {
        const e = new ActionError(m.code, m.message);
        if (m.reqId === undefined) { this.gen?.err(e); this.gen = null; return; }
        const p = this.pending.get(m.reqId) ?? this.pendingSubmit.get(m.reqId);
        this.pending.delete(m.reqId); this.pendingSubmit.delete(m.reqId); p?.err(e);
        return;
      }
    }
  }

  generate(config: WorldConfig, onProgress?: (s: Stage, f: number, attempt?: number) => void): Promise<PublicInfo> {
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

  /** Hand in the final answer. Resolves with the score and the revealed truth; the investigation is then closed. */
  submit(submission: Submission): Promise<RevealMessage> {
    return new Promise((ok, err) => {
      const reqId = this.nextReq++;
      this.pendingSubmit.set(reqId, { ok, err });
      this.transport.post({ kind: 'submit', reqId, submission });
    });
  }
}
