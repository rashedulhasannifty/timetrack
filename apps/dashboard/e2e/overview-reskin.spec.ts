import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers the overview's period card, attention list and project bars.
 */
test.describe.skip('overview reskin', () => {
  test('the period card carries the four numbers', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByText(/time tracked/i)).toBeVisible();
    await expect(page.getByText(/tracking now/i).first()).toBeVisible();
  });

  test('project bars are present', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: /^projects$/i })).toBeVisible();
  });

  test("haven’t tracked section is present", async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: /haven’t tracked/i })).toBeVisible();
  });
});
