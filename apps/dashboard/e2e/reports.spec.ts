import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers Slice 3: reports reskin — by-person table, by-project bars, date range, CSV export.
 */
test.describe.skip('reports reskin', () => {
  test('by-person table renders and a header click toggles sort order', async ({ page }) => {
    await page.goto('/reports');
    const tableHeader = page.getByRole('columnheader', { name: /name|person/i });
    await expect(tableHeader).toBeVisible();
    const initialSortState = await tableHeader.getAttribute('aria-sort');
    await tableHeader.click();
    const newSortState = await tableHeader.getAttribute('aria-sort');
    expect(initialSortState).not.toBe(newSortState);
  });

  test('by-project bars render', async ({ page }) => {
    await page.goto('/reports');
    const chart = page.locator('[data-testid="by-project-chart"]');
    await expect(chart).toBeVisible();
    const bars = page.locator('[data-testid="project-bar"]');
    expect(await bars.count()).toBeGreaterThan(0);
  });

  test('Export CSV link is present', async ({ page }) => {
    await page.goto('/reports');
    const exportLink = page.getByRole('link', { name: /export|csv/i });
    await expect(exportLink).toBeVisible();
  });

  test('header shows the range + user/project counts', async ({ page }) => {
    await page.goto('/reports');
    const dateRange = page.getByText(/\d{1,2}.*\d{1,2}/);
    await expect(dateRange).toBeVisible();
    const userCount = page.getByText(/\d+\s+(?:user|person)/i);
    await expect(userCount).toBeVisible();
    const projectCount = page.getByText(/\d+\s+project/i);
    await expect(projectCount).toBeVisible();
  });
});
