import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers the day-view Person screen (`PersonDayView`) — header, the inline back link,
 * and the day sections. `/me` composes the same leaf panels behind its own tabs.
 */
test.describe.skip('person day view', () => {
  test('the back link names where the row was opened from', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('link', { name: '← People' })).toBeVisible();
  });

  test('person header renders above the day view sections', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    // The back link sits inline with the name; the day sections are below.
    await expect(page.getByRole('link', { name: '← People' })).toBeVisible();
    await expect(page.getByText('The day')).toBeVisible();
  });

  test('the day ribbon section is present', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText('The day')).toBeVisible();
  });

  test('activity section is present', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText('Activity per hour')).toBeVisible();
  });
});
