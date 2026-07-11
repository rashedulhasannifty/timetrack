import { defineConfig } from '@playwright/test';

/**
 * PRD §9 — Playwright E2E on seeded data. Run `pnpm exec playwright install` once to
 * fetch browsers, then `pnpm --filter @timetrack/dashboard test:e2e` against a running app.
 */
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  },
});
