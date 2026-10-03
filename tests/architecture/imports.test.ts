import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { analyzeSource, checkFile, checkProject, layerOf } from '../../tools/depcheck';

const root = path.resolve(__dirname, '../..');

describe('layer boundaries (import graph)', () => {
  it('the real project has no forbidden imports', () => {
    const v = checkProject(root);
    expect(v.map((x) => `${x.file}:${x.line} ${x.specifier} — ${x.reason}`)).toEqual([]);
  });

  it('classifies files into layers', () => {
    expect(layerOf('src/truth/earth/model.ts')).toBe('truth');
    expect(layerOf('src/observation/service.ts')).toBe('observation');
    expect(layerOf('src/ui/map.ts')).toBe('ui');
    expect(layerOf('src/main.ts')).toBe('ui');
    expect(layerOf('dev/earth.ts')).toBe('dev');
  });
});

// The checker itself must catch every way of smuggling truth into the game.
describe('depcheck catches violations', () => {
  const resolveTruth = () => 'src/truth/world.ts';
  const run = (src: string, file = 'src/ui/panel.ts') => checkFile(file, src, resolveTruth);

  it('static import', () => expect(run(`import { generate } from '../truth/world';`)).toHaveLength(1));
  it('type-only import', () => expect(run(`import type { World } from '../truth/world';`)).toHaveLength(1));
  it('export … from', () => expect(run(`export { generate } from '../truth/world';`)).toHaveLength(1));
  it('dynamic import()', () => expect(run(`const m = await import('../truth/world');`)).toHaveLength(1));
  it('require()', () => expect(run(`const m = require('../truth/world');`)).toHaveLength(1));
  it('import x = require()', () => expect(run(`import w = require('../truth/world');`)).toHaveLength(1));
  it('non-literal dynamic import in layer 3', () => expect(run(`const p = '../tru' + 'th/world'; await import(p);`)).toHaveLength(1));
  it('game and client are also fenced', () => {
    expect(run(`import '../truth/world';`, 'src/game/state.ts')).toHaveLength(1);
    expect(run(`import '../truth/world';`, 'src/client/proxy.ts')).toHaveLength(1);
  });
  it('observation may import truth, truth may not import observation', () => {
    expect(run(`import '../truth/world';`, 'src/observation/service.ts')).toHaveLength(0);
    expect(checkFile('src/truth/x.ts', `import '../observation/service';`, () => 'src/observation/service.ts')).toHaveLength(1);
  });
  it('npm packages and shared are fine', () => {
    expect(run(`import ts from 'typescript'; `)).toHaveLength(0);
    expect(checkFile('src/ui/a.ts', `import { Rng } from '../shared/rng';`, () => 'src/shared/rng.ts')).toHaveLength(0);
  });
  it('parses all import forms', () => {
    const refs = analyzeSource(`import a from 'a'; import type {B} from 'b'; export * from 'c'; const d = import('d'); const e = require('e');`);
    expect(refs.map((r) => r.specifier).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
