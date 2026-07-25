import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers Slice 2.5: chart kit — donut, line, gauge, and category-mix bar charts.
 */
test.describe.skip('chart kit', () => {
  test('donut chart renders its segments and the centered value/label', async ({ page }) => {
    await page.goto('/');
    const donutChart = page.locator('[data-testid="donut-chart"]');
    await expect(donutChart).toBeVisible();
    // Segments should be rendered
    const segments = page.locator('[data-testid="donut-segment"]');
    await expect(segments.first()).toBeVisible();
    // Center label showing value and label should be visible
    await expect(page.locator('[data-testid="donut-center-value"]')).toBeVisible();
    await expect(page.locator('[data-testid="donut-center-label"]')).toBeVisible();
  });

  test('hovering the line chart shows a tooltip with a date + value', async ({ page }) => {
    await page.goto('/');
    const lineChart = page.locator('[data-testid="line-chart"]');
    await expect(lineChart).toBeVisible();
    // Hover over a data point
    const dataPoint = page.locator('[data-testid="line-chart-point"]').first();
    await dataPoint.hover();
    // Tooltip should appear with date and value
    const tooltip = page.locator('[data-testid="chart-tooltip"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('[data-testid="tooltip-date"]')).toBeVisible();
    await expect(tooltip.locator('[data-testid="tooltip-value"]')).toBeVisible();
  });

  test('gauge shows its percentage', async ({ page }) => {
    await page.goto('/');
    const gauge = page.locator('[data-testid="gauge-chart"]');
    await expect(gauge).toBeVisible();
    // Percentage display should be visible
    const percentage = page.locator('[data-testid="gauge-percentage"]');
    await expect(percentage).toBeVisible();
    // Verify the percentage is a valid number
    const percentageText = await percentage.textContent();
    expect(percentageText).toMatch(/^\d+%$/);
  });

  test('category-mix bar shows productive/neutral/unproductive segments', async ({ page }) => {
    await page.goto('/');
    const barChart = page.locator('[data-testid="category-mix-bar"]');
    await expect(barChart).toBeVisible();
    // Check for productive segment
    await expect(page.locator('[data-testid="bar-segment-productive"]')).toBeVisible();
    // Check for neutral segment
    await expect(page.locator('[data-testid="bar-segment-neutral"]')).toBeVisible();
    // Check for unproductive segment
    await expect(page.locator('[data-testid="bar-segment-unproductive"]')).toBeVisible();
  });
});
