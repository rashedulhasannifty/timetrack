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

    // Files run concurrently, bounded. Serially this step was ~196s of CI, and most of it
    // was setup, not assertions: startTestDb() gives every e2e file its own Postgres
    // container and shells out to `prisma migrate deploy` for it, so a file with three
    // tests still costs ~5s. There are 19 of them.
    //
    // Concurrency is safe because each file already owns its own containers and vitest's
    // default pool is `forks` — a separate child process per file, so db-harness assigning
    // process.env.DATABASE_URL cannot leak across files. (Verified: a probe spec reports
    // isMainThread=true under the default pool, i.e. a process, not a worker_thread. Do not
    // switch this to pool:'threads' — that sharing WOULD make the harness cross-contaminate.)
    //
    // maxWorkers is the real constraint, and it is tuned for CI, not for a laptop. Four
    // workers measured ~2x faster locally (8 cores) but 33s SLOWER on a 2-core runner:
    // per-file setup is CPU-bound — each file spawns a full pnpm+prisma CLI for `migrate
    // deploy` — so oversubscribing cores makes the setup contend instead of overlap.
    // Two matches the runner. Raising this because it is faster on your machine is the
    // trap; measure on CI.
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/**/*.spec.ts',
        // Bootstrap entrypoint — wiring only, exercised by process start, not unit-testable.
        'src/main.ts',
      ],
      reporter: ['text-summary'],
      // Phase-1 DoD (docs/ROADMAP.md): ≥80% on apps/api. Measured across the combined
      // unit + e2e run above. All four metrics currently clear this with margin
      // (functions is the tightest, ~84%).
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
