import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers Approvals — the status filter, the table, and the decision popover.
 */
test.describe.skip('approvals reskin', () => {
  test('table renders rows with status badges', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('[data-testid="status-badge"]').first()).toBeVisible();
  });

  test('clicking Decide opens a popover with Approve + Flag for payroll', async ({ page }) => {
    await page.goto('/approvals');
    await page.getByRole('button', { name: /decide/i }).click();
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /flag for payroll/i })).toBeVisible();
  });

  test('the intro line is present', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByText(/weekly timesheets awaiting a manager decision/i)).toBeVisible();
  });

  test('the status filter drives ?status= and defaults to pending', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByRole('link', { name: 'Pending' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByRole('link', { name: 'Flagged' }).click();
    await expect(page).toHaveURL(/status=FLAGGED/);

    // "All" is the absence of the parameter, which is how the API models it.
    await page.getByRole('link', { name: 'All' }).click();
    await expect(page).toHaveURL(/status=ALL/);
  });
});
