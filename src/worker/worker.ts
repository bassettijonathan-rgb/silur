/** Web Worker entry: all hidden state lives in this thread (design D1). */
import { ClientMessage } from '../shared/protocol';
import { WorkerHost } from './host';

const host = new WorkerHost();
const scope = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: { data: ClientMessage }) => void) | null };
scope.onmessage = (e) => host.handle(e.data, (m) => scope.postMessage(m));
