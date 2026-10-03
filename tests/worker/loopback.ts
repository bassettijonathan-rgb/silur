import { ObservationClient, Transport } from '../../src/client/client';
import { ClientMessage, ServerMessage } from '../../src/shared/protocol';
import { WorkerHost, WorldFactory } from '../../src/worker/host';

/** Wire a client to a host in the same thread, structured-cloning every message like postMessage does. */
export function loopback(factory?: WorldFactory): { client: ObservationClient; log: ServerMessage[]; sent: ClientMessage[] } {
  const host = new WorkerHost(factory);
  const log: ServerMessage[] = [];
  const sent: ClientMessage[] = [];
  let cb: (m: ServerMessage) => void = () => undefined;
  const transport: Transport = {
    post(m) {
      const msg = structuredClone(m);
      sent.push(msg);
      host.handle(msg, (r) => { const c = structuredClone(r); log.push(c); queueMicrotask(() => cb(c)); });
    },
    subscribe(f) { cb = f; },
  };
  return { client: new ObservationClient(transport), log, sent };
}
