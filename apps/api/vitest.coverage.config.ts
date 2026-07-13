import { defineConfig } from 'vitest/config';

/**
 * Coverage config for the Phase-1 gate.
 *
 * The api splits its tests deliberately (CLAUDE.md §5): business logic is unit-
 * tested with mocked repositories, while repositories, guards, filters and app
 * bootstrap are exercised only by the Testcontainers e2e suite. Measuring either
 * half alone understates real coverage, so this config runs BOTH in one pass and
 * reports a single merged number against the 80% gate.
 *
 * Requires `RUN_E2E=1` and a Docker daemon (Testcontainers). This is the config
 * CI runs for the coverage gate; the fast `pnpm test` run stays config-free.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    environment: 'node',
    hookTimeout: 180_000,
    testTimeout: 120_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/**/*.spec.ts',
        // Bootstrap entrypoint — wiring only, exercised by process start, not unit-testable.
        'src/main.ts',
        // Phase-2 storage adapter (MinIO). Unbuilt in Phase 1; Slice 2.2 wires it into the
        // screenshot pipeline and MUST remove this exclusion so the gate covers it then.
        'src/infra/storage/**',
      ],
      reporter: ['text-summary'],
      // Phase-1 DoD (docs/ROADMAP.md): ≥80% on apps/api. Measured across the combined
      // unit + e2e run above. All four metrics currently clear this with margin
      // (functions is the tightest, ~84%).
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
