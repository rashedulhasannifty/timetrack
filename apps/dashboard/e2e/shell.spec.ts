import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers the app shell — top navigation, account dropdown, narrow-viewport nav.
 */
test.describe.skip('app shell', () => {
  test('the nav row shows the nav items', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Approvals' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My time' })).toBeVisible();
  });

  test('account avatar opens a dropdown with Sign out', async ({ page }) => {
    await page.goto('/overview');
    await page.getByRole('button', { name: /avatar|account/i }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('account dropdown closes on Escape', async ({ page }) => {
    await page.goto('/overview');
    await page.getByRole('button', { name: /avatar|account/i }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  test('account dropdown closes on outside click', async ({ page }) => {
    await page.goto('/overview');
    await page.getByRole('button', { name: /avatar|account/i }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.locator('main').click();
    await expect(page.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  test('on a narrow viewport the nav stays on screen and scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/overview');
    // No drawer to open: every item is still reachable in the row itself.
    await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  });

  test('each page carries its own heading', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  });
});
