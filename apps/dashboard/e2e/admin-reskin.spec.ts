import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers Slice 5.1: admin reskin — tabbed navigation, policy cards, users table.
 */
test.describe.skip('admin reskin', () => {
  test('AdminTabs shows Settings / Users / Audit and highlights the active tab', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit' })).toBeVisible();
    // Settings tab is active on its own route.
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('settings shows the monitoring-policy card and the effective-policy card', async ({
    page,
  }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: /monitoring policy/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /effective policy/i })).toBeVisible();
  });

  test('users table renders with role + status', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /role/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /status/i })).toBeVisible();
  });
});
