import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers Slice 6: My Time reskin — timeline, activity, screenshots, idle tabs; week header; status badge.
 */
test.describe.skip('my time reskin', () => {
  test('header shows week label with hours and status badge', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: 'My time' })).toBeVisible();
    // Week label (e.g., "week of Jan 20–26")
    await expect(page.locator('text=/week of/i')).toBeVisible();
    // Hours display
    await expect(page.locator('text=/\\d+\\.?\\d* hours?/i')).toBeVisible();
    // Status badge (e.g., "On track", "Overtime")
    await expect(page.locator('[role="status"]')).toBeVisible();
  });

  test('tabs switch between Timeline, Activity, Screenshots, and Idle', async ({ page }) => {
    await page.goto('/me');
    // Timeline is default active
    await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // Activity tab
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // Screenshots tab
    await page.getByRole('tab', { name: 'Screenshots' }).click();
    await expect(page.getByRole('tab', { name: 'Screenshots' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // Idle tab
    await page.getByRole('tab', { name: 'Idle' }).click();
    await expect(page.getByRole('tab', { name: 'Idle' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('activity tab shows active minutes KPI and category mix', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('tab', { name: 'Activity' }).click();
    // Active minutes metric (e.g., "156 minutes")
    await expect(page.locator('text=/\\d+ minutes?/i')).toBeVisible();
    // Category mix label or legend
    await expect(page.locator('text=/categor/i')).toBeVisible();
  });

  test('screenshots tab shows a grid layout', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('tab', { name: 'Screenshots' }).click();
    // Grid container should be visible (use role or data-testid if available)
    const grid = page.locator('[role="grid"], [data-testid="screenshot-grid"]').first();
    await expect(grid).toBeVisible();
  });

  test('timeline tab renders entries', async ({ page }) => {
    await page.goto('/me');
    // Timeline should be active by default
    await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // At least one list item or entry row visible
    await expect(
      page.locator('[role="listitem"], article, li').first()
    ).toBeVisible();
  });

  test('idle tab shows idle time blocks', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('tab', { name: 'Idle' }).click();
    // Idle content indicator (e.g., "idle" text or a specific metric)
    await expect(page.locator('text=/idle/i')).toBeVisible();
  });
});
