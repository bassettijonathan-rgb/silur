/**
 * Main-thread entry point (Layer 3). This file and everything it imports must stay free of
 * src/truth and src/observation — see tests/architecture. The playable game arrives at M4.
 */
import { MODEL_VERSION } from './shared/config';

const app = document.getElementById('app');
if (app) {
  app.textContent = `Silur ${MODEL_VERSION} — the field season has not started yet.`;
}
