import { defineConfig } from 'vitest/config';

/**
 * Contracts are pure Zod schemas + inferred types; the spec exercises every schema.
 * The coverage block (used with `--coverage`, i.e. `pnpm test:coverage`) enforces the
 * Phase-1 DoD gate (docs/ROADMAP.md): ≥80% on packages/contracts. The plain `test`
 * run stays coverage-free and fast.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reporter: ['text-summary'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
