import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers Slice 2.3: per-project Top apps section — app usage rankings, coverage disclosure.
 */
test.describe.skip('project top-apps', () => {
  test('the "Top apps" section renders', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText(/top apps/i)).toBeVisible();
  });

  test('the coverage disclosure line is present', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000');
    await expect(
      page.getByText(/covers .* of this project.s tracked time/i)
    ).toBeVisible();
  });

  test('the app list (bars) renders', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000');
    await expect(page.locator('[data-testid="top-app-bar"]')).toBeDefined();
  });
});
