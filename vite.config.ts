import { defineConfig } from 'vitest/config';

// Main game entry is index.html -> src/main.ts. It must never pull in src/truth or
// src/observation (see tests/architecture/bundle.test.ts).
// dev/*.html are developer-only debug pages (they DO use the truth layer) and are
// built only when explicitly requested.
export default defineConfig({
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
