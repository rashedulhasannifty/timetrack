import { test, expect } from '@playwright/test';

/**
 * Prerequisites (see the slice's design doc, Verification section):
 *   docker compose -f infra/docker-compose.yml up -d
 *   pnpm db:migrate && SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… pnpm db:seed
 *   API running (pnpm --filter api dev) + dashboard running (pnpm --filter dashboard dev)
 *     with DASHBOARD_SESSION_SECRET set.
 * Then: E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD match the seeded admin.
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'password12';

test('unauthenticated visit to / settles on /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('login lands on the overview, logout returns to /login', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Team overview' })).toBeVisible();

  await page.click('button:has-text("Sign out")');
  await expect(page).toHaveURL(/\/login/);

  // The session is cleared: hitting / again bounces back to /login.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
