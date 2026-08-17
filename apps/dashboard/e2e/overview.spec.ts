import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 */
test.skip('team overview renders', async ({ page }) => {
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'Team overview' })).toBeVisible();
});
