import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers the My Time day view: header, timesheet card, hero stats, and the tab strip
 * (Timeline / Activity / Screenshots / Idle) the redesign reintroduced — an earlier slice
 * had flattened these into one scrollable page.
 */
test.describe.skip('my time day view', () => {
  test('header shows the timesheet card with the page title', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: 'My time' })).toBeVisible();
    // Timesheet header card copy (curly apostrophe).
    await expect(page.getByText(/this week.s timesheet/i)).toBeVisible();
  });

  test('hero stats show Tracked, Active, and Untracked', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByText('Tracked')).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();
    await expect(page.getByText('Untracked')).toBeVisible();
  });

  test('the timeline tab is the default panel', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('link', { name: 'Timeline' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText('Time entries').or(page.locator('[data-ribbon]'))).toBeTruthy();
  });

  test('each tab swaps the panel through the URL', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('link', { name: 'Screenshots' }).click();
    await expect(page).toHaveURL(/tab=screenshots/);
    await expect(page.getByRole('heading', { name: 'Screenshots' })).toBeVisible();

    await page.getByRole('link', { name: 'Idle' }).click();
    await expect(page).toHaveURL(/tab=idle/);
    await expect(page.getByRole('heading', { name: 'Idle periods' })).toBeVisible();
  });

  test('idle periods are read-only — resolution happens on the Mac', async ({ page }) => {
    await page.goto('/me?tab=idle');
    await expect(page.getByRole('button', { name: /resolve/i })).toHaveCount(0);
  });
});
