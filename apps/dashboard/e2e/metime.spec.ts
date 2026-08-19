import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers the My Time day view (`DayHeader` + `DayStats` + `DayTabs` + `DayPanels`): hero
 * stats, the "The day" ribbon, activity breakdown, time entries, screenshots and idle.
 *
 * The Timeline / Activity / Screenshots / Idle tabs were reinstated in Aug 2026 to match the
 * Nifty Timer redesign, after a spell as one scrollable view (an earlier version of this
 * comment still recorded the removal, which is how the redesign nearly skipped them).
 * Only the ACTIVE panel is in the DOM — the rest live in the RSC flight payload — so assert
 * against a panel by navigating to its `?panel=` first.
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

  test('"Your day" ribbon section renders', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByText('Your day')).toBeVisible();
  });

  test('activity section renders', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByText('Activity')).toBeVisible();
  });

  test('screenshots section renders', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByText('Screenshots')).toBeVisible();
  });

  test('time entries section renders', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByText('Time entries')).toBeVisible();
  });
});
