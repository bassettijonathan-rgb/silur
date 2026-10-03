import tseslint from 'typescript-eslint';

// Editor-time guard for the three-layer rule. The authoritative checks are the tests in
// tests/architecture (import graph + bundle graph); this just gives early feedback.
const forbid = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'tools/**/*.ts', 'dev/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/game/**/*.ts', 'src/ui/**/*.ts', 'src/client/**/*.ts', 'src/main.ts'],
    rules: forbid([
      { group: ['**/truth/**', '**/observation/**', '**/worker/**'], message: 'Layer 3 must not import truth/observation/worker. Use src/shared or src/client.' },
    ]),
  },
  {
    files: ['src/truth/**/*.ts'],
    rules: forbid([
      { group: ['**/observation/**', '**/worker/**', '**/client/**', '**/game/**', '**/ui/**'], message: 'Truth may only import shared/ and truth/.' },
    ]),
  },
);
