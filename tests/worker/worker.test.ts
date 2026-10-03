import { describe, expect, it } from 'vitest';
import { ActionError } from '../../src/client/client';
import { makeConfig } from '../../src/shared/config';
import { CoreResult, Stage } from '../../src/shared/protocol';
import { loopback } from './loopback';

const config = (() => {
  const c = makeConfig('worker-test', 'dev', { budget: 100 });
  c.grid = { nx: 12, ny: 12, cellKm: 8 };
  c.durationMyr = 30;
  return c;
})();

describe('worker host + client', () => {
  it('generates a world with ordered progress, then serves drills and assays', async () => {
    const { client, log } = loopback();
    const stages: Stage[] = [];
    const info = await client.generate(config, (s) => { if (stages[stages.length - 1] !== s) stages.push(s); });
    expect(stages).toEqual(['planet', 'earth', 'biosphere', 'strata', 'catalog']);
    expect(info.nx).toBe(12);
    expect(info.budget).toBe(100);

    const core = (await client.act({ kind: 'drill', cell: 60, depthM: 100 })) as CoreResult;
    expect(core.kind).toBe('core');
    expect(core.budgetLeft).toBeLessThan(100);
    const assay = await client.act({ kind: 'assay', coreId: core.coreId, proxy: 'toc', depthsM: [1, 2, 3] });
    expect(assay.kind).toBe('assay');

    // every message is a plain, cloneable data record of a known kind
    for (const m of log) expect(['progress', 'ready', 'result', 'error']).toContain(m.kind);
  });

  it('refuses actions before a world exists, bad requests, overspending and the sealed reveal', async () => {
    const { client } = loopback();
    await expect(client.act({ kind: 'drill', cell: 0, depthM: 10 })).rejects.toMatchObject({ code: 'not_ready' });
    await client.generate({ ...config, difficulty: { ...config.difficulty, budget: 8 } });
    await expect(client.act({ kind: 'drill', cell: 9999, depthM: 10 })).rejects.toMatchObject({ code: 'out_of_range' });
    await expect(client.act({ kind: 'drill', cell: 10, depthM: 1000 })).rejects.toBeInstanceOf(ActionError);
    await expect(client.submit({ events: [] })).rejects.toMatchObject({ code: 'sealed' });
  });

  it('the same seed gives the same map and the same core through the protocol', async () => {
    const a = loopback(), b = loopback();
    const ia = await a.client.generate(config), ib = await b.client.generate(config);
    expect(Array.from(ia.elevationM)).toEqual(Array.from(ib.elevationM));
    expect(Array.from(ia.surfaceClass)).toEqual(Array.from(ib.surfaceClass));
    const ca = await a.client.act({ kind: 'drill', cell: 40, depthM: 200 }), cb = await b.client.act({ kind: 'drill', cell: 40, depthM: 200 });
    expect(ca).toEqual(cb);
  });

  it('a failing world factory is reported, not thrown', async () => {
    const { client } = loopback(() => { throw new Error('boom'); });
    await expect(client.generate(config)).rejects.toMatchObject({ code: 'bad_request' });
  });
});
