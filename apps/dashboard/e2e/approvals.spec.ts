import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers Slice 4: Approvals reskin — time entry approval workflow with decision popover.
 */
test.describe.skip('approvals reskin', () => {
  test('table renders rows with status badges', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('[data-testid="status-badge"]')).toHaveCount(1);
  });

  test('clicking Decide opens a popover with Approve + Flag for payroll', async ({ page }) => {
    await page.goto('/approvals');
    await page.getByRole('button', { name: /decide/i }).click();
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /flag for payroll/i })).toBeVisible();
  });

  test('the intro line is present', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByText(/team\'s time entries awaiting your review/i)).toBeVisible();
  });
});
