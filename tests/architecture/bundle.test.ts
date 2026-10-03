import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { build } from 'vite';
import type { Rollup } from 'vite';

type RollupOutput = Rollup.RollupOutput;
const root = path.resolve(__dirname, '../..');

interface Built { moduleIds: string[]; mainCode: string; workerCode: string }

async function bundle(entry: string): Promise<Built> {
  const out = (await build({
    root, configFile: false, logLevel: 'silent',
    build: { write: false, rollupOptions: { input: path.join(root, entry) }, minify: false },
  })) as RollupOutput | RollupOutput[];
  const b: Built = { moduleIds: [], mainCode: '', workerCode: '' };
  for (const o of Array.isArray(out) ? out : [out]) {
    for (const item of o.output) {
      if (item.type === 'chunk') { b.moduleIds.push(...Object.keys(item.modules)); b.mainCode += item.code; }
      else if (/worker/.test(item.fileName) && /\.js$/.test(item.fileName)) b.workerCode += typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString('utf8');
    }
  }
  return b;
}

// Strings that only exist in truth-layer code
const TRUTH_MARKERS = ['Rosenbrock2: too many substeps', 'calibrate: pelagic burial exceeds', 'lagerstatte', 'Berger'];

describe('layer boundaries (bundle graph)', () => {
  it('the main-thread bundle contains no truth, observation or worker modules — and no truth code', async () => {
    const b = await bundle('index.html');
    expect(b.moduleIds.some((id) => id.includes('/src/main.ts'))).toBe(true); // sanity: we really bundled the game
    expect(b.moduleIds.filter((id) => /\/src\/(truth|observation|worker)\//.test(id))).toEqual([]);
    for (const m of TRUTH_MARKERS) expect(b.mainCode).not.toContain(m);
  });

  it('control: the hidden world is bundled into the separate worker file', async () => {
    const b = await bundle('index.html');
    expect(b.workerCode.length).toBeGreaterThan(20_000);
    expect(b.workerCode).toContain('Rosenbrock2: too many substeps');
    expect(b.workerCode).toContain('insufficient_budget');
  });

  it('control: the same check does see truth modules in the developer-only debug pages', async () => {
    expect((await bundle('dev/earth.html')).moduleIds.some((id) => id.includes('/src/truth/earth/model.ts'))).toBe(true);
    expect((await bundle('dev/strat.html')).moduleIds.some((id) => id.includes('/src/truth/strat/simulate.ts'))).toBe(true);
  });
});
