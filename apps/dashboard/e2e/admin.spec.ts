import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded ADMIN auth is wired, then run against a live dashboard.
 * Covers Slice 1.2: the admin users screen renders and the non-admin 403 view shows.
 */
test.skip('admin can view the users screen', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users & teams' })).toBeVisible();
});

test.skip('non-admin sees the forbidden view on an admin page', async ({ page }) => {
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'You can only see your own data' })).toBeVisible();
});
