import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers the day-view Person screen — header, back link, and the panels it shares with the
 * `/me` self-view via `DayTabs` + `DayPanels`. Both surfaces render the same four panels; the
 * manager's differs only in what it may do (no screenshot redaction, no idle resolve).
 * Only the ACTIVE panel is in the DOM, so select one with `?panel=` before asserting.
 */
test.describe.skip('person day view', () => {
  test('back link is present', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByRole('link', { name: /back/i })).toBeVisible();
  });

  test('person header renders above the day view sections', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    // Header row carries the Back link; the day-view sections sit below it.
    await expect(page.getByRole('link', { name: /back/i })).toBeVisible();
    await expect(page.getByText('Your day')).toBeVisible();
  });

  test('"Your day" section is present', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText('Your day')).toBeVisible();
  });

  test('activity section is present', async ({ page }) => {
    await page.goto('/people/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText('Activity')).toBeVisible();
  });
});
