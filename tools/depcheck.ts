/**
 * Import-graph checker for the three-layer rule (design §3.2).
 *
 * Layers (directories under src/):
 *   shared       pure types, RNG, protocol           — importable by everyone
 *   truth        Layer 1, runs in the worker only
 *   observation  Layer 2, runs in the worker only
 *   worker       worker entry (wires truth + observation to the protocol)
 *   client       main-thread proxy to the worker     — may import shared only (+ itself)
 *   game, ui     Layer 3 (main.ts counts as ui)      — may import shared, client (+ themselves)
 *
 * `analyzeSource` returns every module specifier found in a file — static imports, `export … from`,
 * `import type`, `import x = require()`, dynamic `import()` and `require()` — so a forbidden edge cannot
 * hide behind a dynamic import.
 */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

export type Layer = 'shared' | 'truth' | 'observation' | 'worker' | 'client' | 'game' | 'ui' | 'dev' | 'other';

export const ALLOWED: Record<Layer, Layer[]> = {
  shared: ['shared'],
  truth: ['shared', 'truth'],
  observation: ['shared', 'truth', 'observation'],
  worker: ['shared', 'truth', 'observation', 'worker'],
  client: ['shared', 'client'],
  game: ['shared', 'client', 'game'],
  ui: ['shared', 'client', 'game', 'ui'],
  // Developer-only debug pages live outside src/ and are never part of the shipped bundle.
  dev: ['shared', 'truth', 'observation', 'worker', 'dev'],
  other: ['shared', 'truth', 'observation', 'worker', 'client', 'game', 'ui', 'dev', 'other'],
};

export interface ImportRef {
  specifier: string;
  kind: 'static' | 'export-from' | 'dynamic' | 'require' | 'import-equals';
  typeOnly: boolean;
  line: number;
}

export function analyzeSource(text: string, fileName = 'x.ts'): ImportRef[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const refs: ImportRef[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({ specifier: node.moduleSpecifier.text, kind: 'static', typeOnly: !!node.importClause?.isTypeOnly, line: lineOf(node) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({ specifier: node.moduleSpecifier.text, kind: 'export-from', typeOnly: node.isTypeOnly, line: lineOf(node) });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      refs.push({ specifier: node.moduleReference.expression.text, kind: 'import-equals', typeOnly: node.isTypeOnly, line: lineOf(node) });
    } else if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        // import('./x') with a literal -> record it; non-literal dynamic imports are flagged as '<dynamic>'
        refs.push({ specifier: arg && ts.isStringLiteralLike(arg) ? arg.text : '<dynamic>', kind: 'dynamic', typeOnly: false, line: lineOf(node) });
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        refs.push({ specifier: arg && ts.isStringLiteralLike(arg) ? arg.text : '<dynamic>', kind: 'require', typeOnly: false, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

export function layerOf(relPath: string): Layer {
  const p = relPath.split(path.sep).join('/');
  if (p === 'src/main.ts') return 'ui';
  const m = /^src\/([^/]+)\//.exec(p);
  if (m) {
    const l = m[1];
    if (['shared', 'truth', 'observation', 'worker', 'client', 'game', 'ui'].includes(l)) return l as Layer;
    return 'other';
  }
  if (p.startsWith('dev/')) return 'dev';
  return 'other';
}

export interface Violation {
  file: string;
  line: number;
  specifier: string;
  fromLayer: Layer;
  toLayer: Layer | '<dynamic>';
  reason: string;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Check one file's source against the matrix. `resolve` maps (file, specifier) to a repo-relative path. */
export function checkFile(
  relPath: string,
  text: string,
  resolve: (spec: string) => string | null,
): Violation[] {
  const from = layerOf(relPath);
  const out: Violation[] = [];
  for (const ref of analyzeSource(text, relPath)) {
    if (ref.specifier === '<dynamic>') {
      if (from === 'ui' || from === 'game' || from === 'client') {
        out.push({ file: relPath, line: ref.line, specifier: ref.specifier, fromLayer: from, toLayer: '<dynamic>', reason: 'non-literal dynamic import/require could load anything' });
      }
      continue;
    }
    if (!ref.specifier.startsWith('.') && !ref.specifier.startsWith('/')) continue; // npm package
    const target = resolve(ref.specifier);
    if (!target) {
      out.push({ file: relPath, line: ref.line, specifier: ref.specifier, fromLayer: from, toLayer: 'other', reason: 'cannot resolve import' });
      continue;
    }
    const to = layerOf(target);
    if (!ALLOWED[from].includes(to)) {
      out.push({
        file: relPath, line: ref.line, specifier: ref.specifier, fromLayer: from, toLayer: to,
        reason: `${from} may not import ${to}${ref.typeOnly ? ' (type-only imports count too: take types from src/shared)' : ''}`,
      });
    }
  }
  return out;
}

export function listTs(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

export function checkProject(root: string): Violation[] {
  const files = [...listTs(path.join(root, 'src')), ...listTs(path.join(root, 'dev'))];
  const violations: Violation[] = [];
  for (const abs of files) {
    const rel = path.relative(root, abs);
    const text = fs.readFileSync(abs, 'utf8');
    violations.push(
      ...checkFile(rel, text, (spec) => {
        const r = resolveRelative(abs, spec);
        return r ? path.relative(root, r) : null;
      }),
    );
  }
  return violations;
}

// CLI: `npx tsx tools/depcheck.ts`
if (process.argv[1] && process.argv[1].endsWith('depcheck.ts')) {
  const v = checkProject(process.cwd());
  if (v.length) {
    for (const x of v) console.error(`${x.file}:${x.line}  ${x.specifier}  — ${x.reason}`);
    process.exit(1);
  }
  console.log('depcheck: layer boundaries OK');
}
