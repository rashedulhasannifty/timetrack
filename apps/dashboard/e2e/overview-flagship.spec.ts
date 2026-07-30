import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 */
test.describe.skip('overview flagship', () => {
  test('renders the new sections', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/productivity % per day/i)).toBeVisible();
    await expect(page.getByText(/highest idle %/i)).toBeVisible();
    await expect(page.getByText(/websites & applications/i)).toBeVisible();
  });

  test('widgets drawer toggles a card and persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /widgets/i }).click();
    await page.getByLabel(/highest idle %/i).uncheck();
    await expect(page.getByRole('heading', { name: /highest idle %/i })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: /highest idle %/i })).toBeHidden();
  });
});
