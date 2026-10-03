import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { build } from 'vite';
import type { Rollup } from 'vite';
type RollupOutput = Rollup.RollupOutput;

const root = path.resolve(__dirname, '../..');

async function moduleIdsFor(entry: string): Promise<string[]> {
  const out = (await build({
    root,
    configFile: false,
    logLevel: 'silent',
    build: { write: false, rollupOptions: { input: path.join(root, entry) }, minify: false },
  })) as RollupOutput | RollupOutput[];
  const outputs = Array.isArray(out) ? out : [out];
  const ids: string[] = [];
  for (const o of outputs) for (const item of o.output) if (item.type === 'chunk') ids.push(...Object.keys(item.modules));
  return ids;
}

describe('layer boundaries (bundle graph)', () => {
  it('the shipped main-thread bundle contains no truth, observation or worker modules', async () => {
    const ids = await moduleIdsFor('index.html');
    expect(ids.some((id) => id.includes('/src/main.ts'))).toBe(true); // sanity: we really bundled the game
    const leaked = ids.filter((id) => /\/src\/(truth|observation|worker)\//.test(id));
    expect(leaked).toEqual([]);
  });

  it('control: the same check does see truth modules in the developer-only debug pages', async () => {
    expect((await moduleIdsFor('dev/earth.html')).some((id) => id.includes('/src/truth/earth/model.ts'))).toBe(true);
    expect((await moduleIdsFor('dev/strat.html')).some((id) => id.includes('/src/truth/strat/simulate.ts'))).toBe(true);
  });
});
