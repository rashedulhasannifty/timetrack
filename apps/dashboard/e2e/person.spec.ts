import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers the reskinned Person screen — header, back link, timeline, and activity sections.
 */
test.describe.skip('person reskin', () => {
  test('back link is present', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('link', { name: /back/i })).toBeVisible();
  });

  test('person header shows a name heading and an avatar', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('heading')).toBeVisible();
    await expect(page.locator('[data-testid="avatar"]')).toBeVisible();
  });

  test('timeline section is present', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText(/timeline · today/i)).toBeVisible();
  });

  test('activity section is present', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText(/activity · last 7 days/i)).toBeVisible();
  });
});
