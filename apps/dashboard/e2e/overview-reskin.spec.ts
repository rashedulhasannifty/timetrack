import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 * Covers Slice 8: Overview reskin — KPI cards, top projects, haven't tracked, top users.
 */
test.describe.skip('overview reskin', () => {
  test('KPI cards render time tracked and active users', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/time tracked/i)).toBeVisible();
    await expect(page.getByText(/active users/i)).toBeVisible();
  });

  test('top projects section is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/top projects/i)).toBeVisible();
  });

  test("haven't tracked section is present", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/haven't tracked/i)).toBeVisible();
  });

  test('top users section is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/top users/i)).toBeVisible();
  });
});
