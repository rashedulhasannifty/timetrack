import { defineConfig } from 'vitest/config';

/**
 * PRD §9 — E2E/integration runs against a REAL Postgres + Redis via Testcontainers,
 * never a mocked Prisma. These specs are slow (they spin containers), so they live in
 * a separate config from the fast unit run and are not part of the default `pnpm test`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.e2e-spec.ts', 'test/**/*.e2e-spec.ts'],
    environment: 'node',
    hookTimeout: 180_000,
    testTimeout: 120_000,
    fileParallelism: false,
    // One shared Postgres for the run, migrated once — see test/global-setup.ts.
    globalSetup: ['test/global-setup.ts'],
  },
});
