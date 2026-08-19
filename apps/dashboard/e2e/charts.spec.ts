import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 *
 * Covers what is left of the chart kit after the redesign. The donut, gauge and
 * category-mix bar it also used to cover were removed with the overview's widget grid:
 * the project donut became a bar list and the per-user gauges became columns of the
 * people table, so there is nothing left on the page for those cases to assert.
 */
test.describe.skip('chart kit', () => {
  test('the hours line renders inside the period card', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.locator('[data-testid="line-chart"]')).toBeVisible();
  });

  test('hovering the line chart shows a tooltip with a date + value', async ({ page }) => {
    await page.goto('/overview');
    const dataPoint = page.locator('[data-testid="line-chart-point"]').first();
    await dataPoint.hover();
    const tooltip = page.locator('[data-testid="chart-tooltip"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('[data-testid="tooltip-date"]')).toBeVisible();
    await expect(tooltip.locator('[data-testid="tooltip-value"]')).toBeVisible();
  });

  test('the project bars carry each project’s own colour', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: /^projects$/i })).toBeVisible();
  });
});
