import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers Slice 6: My Time reskin — timeline, activity, screenshots, idle tabs; week header; status badge.
 */
test.describe.skip('my time reskin', () => {
  test('header shows the timesheet card with the page title', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: 'My time' })).toBeVisible();
    // Timesheet header card copy (curly apostrophe).
    await expect(page.getByText(/this week.s timesheet/i)).toBeVisible();
  });

  test('tabs switch between Timeline, Activity, Screenshots, and Idle', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const name of ['Activity', 'Screenshots', 'Idle']) {
      await page.getByRole('tab', { name }).click();
      await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    }
  });

  test('activity tab shows active minutes and category mix', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByText(/active minutes/i)).toBeVisible();
    await expect(page.getByText(/category mix/i)).toBeVisible();
  });

  test('screenshots tab renders its panel', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('tab', { name: 'Screenshots' }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });

  test('timeline tab renders its panel', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });

  test('idle tab renders its panel', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('tab', { name: 'Idle' }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });
});
