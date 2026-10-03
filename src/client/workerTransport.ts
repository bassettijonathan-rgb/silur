/** The browser transport: a module Web Worker that holds the hidden world. */
import { ClientMessage, ServerMessage } from '../shared/protocol';
import { Transport } from './client';

export function workerTransport(): Transport {
  const worker = new Worker(new URL('../worker/worker.ts', import.meta.url), { type: 'module' });
  return {
    post: (m: ClientMessage) => worker.postMessage(m),
    subscribe: (cb: (m: ServerMessage) => void) => { worker.onmessage = (e: MessageEvent<ServerMessage>) => cb(e.data); },
  };
}
