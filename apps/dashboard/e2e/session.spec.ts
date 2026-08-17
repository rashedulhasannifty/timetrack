import { test, expect, type Page } from '@playwright/test';

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

const HOME_HEADING = 'Time tracking your team can audit.';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/overview$/);
}

test('unauthenticated visit to / renders the public home page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible();
});

test('the sign-in card links back to the home and install pages', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Install guide' }).click();
  await expect(page).toHaveURL(/\/install$/);

  await page.goto('/login');
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('login lands on the overview, logout returns to /login', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Account' }).click();
  await page.click('button:has-text("Sign out")');
  await expect(page).toHaveURL(/\/login/);

  // The session is cleared, so / falls back to the signed-out chrome.
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});

/**
 * Regression: a session used to bounce / straight to /overview, which left the two public
 * pages unreachable for anyone who already had an account. They stay reachable now, and the
 * public chrome offers a one-click route back into the app.
 */
test('a signed-in person can still read the home and install pages', async ({ page }) => {
  await signIn(page);

  await page.getByRole('link', { name: 'Install the Mac app' }).click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByRole('heading', { name: 'Installing Nifty Timer' })).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: HOME_HEADING })).toBeVisible();

  // The signed-out "Sign in" link is replaced by the way back into the dashboard.
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open dashboard' }).first().click();
  await expect(page).toHaveURL(/\/overview$/);
});
