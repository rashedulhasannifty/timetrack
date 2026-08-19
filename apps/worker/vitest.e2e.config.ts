import { defineConfig } from 'vitest/config';

/** E2E/integration runs against a REAL Postgres + MinIO via Testcontainers (never mocked). */
export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    hookTimeout: 180_000,
    testTimeout: 120_000,
    fileParallelism: false,
    // Runs before each spec's imports, so loadEnv() never falls through to the repo-root
    // `.env`. Wired here rather than imported per-spec (the api's pattern) so a new spec
    // cannot forget it and silently depend on a developer's local file.
    setupFiles: ['test/test-env.ts'],
  },
});
