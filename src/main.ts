/**
 * Main-thread entry point (Layer 3). Everything reachable from here must stay free of src/truth and
 * src/observation — the hidden world lives in the Web Worker (see tests/architecture).
 */
import { ObservationClient } from './client/client';
import { workerTransport } from './client/workerTransport';
import { Session } from './game/session';
import { App } from './ui/app';

const root = document.getElementById('app');
if (root) {
  const app = new App(root, new Session(new ObservationClient(workerTransport())));
  void app;
}
