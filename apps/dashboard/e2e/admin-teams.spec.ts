import { test, expect, type Page } from '@playwright/test';

/**
 * Prerequisites are the same as session.spec.ts: Docker compose up, migrated + seeded DB,
 * API and dashboard running, E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD matching the seeded admin.
 *
 * Covers the Teams admin surface. The property that matters is the one that was broken: a
 * team the admin is NOT a member of must be creatable, renameable, and — the part that had no
 * route at all — have its monitoring policy edited. Before this, every settings write resolved
 * the admin's own team, so a second team was frozen on its creation defaults.
 *
 * NOT IDEMPOTENT — read before running. Each pass creates three teams, and the product ships
 * no delete (see the page copy), so they accumulate in whatever database you point this at and
 * cannot be removed through the UI. Run it against a scratch DB you are willing to re-seed
 * (`pnpm db:migrate && pnpm db:seed`), never a shared or production one. The names are
 * suffixed per run so repeated passes at least do not collide with each other.
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'password12';

async function signInAsAdmin(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/overview$/);
}

/** A name unique to this run, so repeated runs against one seeded DB don't collide. */
function uniqueTeamName(prefix: string): string {
  return `${prefix} ${process.env.E2E_RUN_ID ?? String(process.pid)}`;
}

test('the Teams tab is reachable from the admin nav', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/settings');
  await page.getByRole('link', { name: 'Teams' }).click();
  await expect(page).toHaveURL(/\/admin\/teams$/);
  await expect(page.getByRole('columnheader', { name: 'Members' })).toBeVisible();
});

test('an admin can create a team and it appears with a zero member count', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/teams');

  const name = uniqueTeamName('Support');
  await page.fill('input[name="name"]', name);
  await page.getByRole('button', { name: 'Create team' }).click();

  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell', { name: '0', exact: true })).toBeVisible();
});

/**
 * The regression test for this slice. A second team's policy was previously uneditable: the
 * settings page always rendered — and wrote — the admin's own team.
 */
test('an admin can edit a second team’s policy without touching their own', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/teams');

  const name = uniqueTeamName('Policy');
  await page.fill('input[name="name"]', name);
  await page.getByRole('button', { name: 'Create team' }).click();

  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Edit policy' }).click();

  // The settings page must be scoped to the team we arrived from, not the admin's own.
  await expect(page).toHaveURL(/\/admin\/settings\?teamId=/);
  const teamId = new URL(page.url()).searchParams.get('teamId');
  expect(teamId).toBeTruthy();
  await expect(page.locator('input[name="teamId"]')).toHaveValue(teamId!);

  await page.fill('input[name="screenshotIntervalMinutes"]', '25');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  // The new value belongs to the new team only.
  await page.goto('/admin/teams');
  await expect(
    page.getByRole('row').filter({ hasText: name }).getByText('Every 25 min'),
  ).toBeVisible();
});

test('an admin can rename a team', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin/teams');

  const original = uniqueTeamName('Suport');
  await page.fill('input[name="name"]', original);
  await page.getByRole('button', { name: 'Create team' }).click();

  const row = page.getByRole('row').filter({ hasText: original });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Rename' }).click();

  const renamed = uniqueTeamName('Customer Support');
  await row.getByRole('textbox', { name: `New name for ${original}` }).fill(renamed);
  await row.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('row').filter({ hasText: renamed })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: original })).toHaveCount(0);
});
