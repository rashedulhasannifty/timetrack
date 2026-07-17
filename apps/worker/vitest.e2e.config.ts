import { defineConfig } from 'vitest/config';

/** E2E/integration runs against a REAL Postgres + MinIO via Testcontainers (never mocked). */
export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    hookTimeout: 180_000,
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
