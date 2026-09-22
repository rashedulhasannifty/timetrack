import { test, expect, type Page } from '@playwright/test';

/**
 * The presentational drawers: page-local detail panels over data the page already loaded
 * (Approvals week, Projects quick look, a time entry), plus Reports as a second source that
 * intercepts `/people/<id>` into the person drawer.
 *
 * Nothing here writes: decide controls, archive toggles and entry edits are never submitted.
 *
 * Prerequisites (same harness as detail-drawer.spec.ts): seeded DB and a running API +
 * dashboard; E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD match the seeded admin; E2E_SHOT_USER_ID /
 * E2E_SHOT_DATE name a person listed on Overview with at least one closed time entry that day.
 * Every date-dependent view is pinned to E2E_SHOT_DATE, never to today.
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const SHOT_USER_ID = process.env.E2E_SHOT_USER_ID;
const SHOT_DATE = process.env.E2E_SHOT_DATE;

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL!);
  await page.fill('input[name="password"]', PASSWORD!);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/overview$/);
  await hydrated(page);
}

/**
 * Wait until the client router has taken over: a click before hydration is a hard load (no
 * drawer), or a button with no handler yet.
 */
async function hydrated(page: Page) {
  await page.waitForLoadState('networkidle');
}

/**
 * A `from`/`to` query for the seven Dhaka days ending on SHOT_DATE — the same shape
 * ReportRangePicker writes — so ranged pages never depend on today's date.
 */
function rangeEndingOnShotDate(): string {
  const dayStart = new Date(`${SHOT_DATE}T00:00:00+06:00`).getTime();
  const DAY = 24 * 60 * 60 * 1000;
  const from = new Date(dayStart - 6 * DAY).toISOString();
  const to = new Date(dayStart + DAY - 1).toISOString();
  return new URLSearchParams({ from, to }).toString();
}

/** The label button of the first entry on the day that has row actions (i.e. a closed entry). */
function firstEntryButton(scope: ReturnType<Page['locator']>) {
  return scope
    .locator('li')
    .filter({ has: scope.page().getByRole('button', { name: 'Edit', exact: true }) })
    .first()
    .getByRole('button')
    .first();
}

/** Whether focus currently sits inside the element the locator points at. */
const holdsFocus = (loc: ReturnType<Page['locator']>) =>
  loc.evaluate((el) => el.contains(document.activeElement));

test.describe('presentational drawers', () => {
  test.skip(
    !EMAIL || !PASSWORD || !SHOT_USER_ID || !SHOT_DATE,
    'set E2E_ADMIN_*, and E2E_SHOT_USER_ID / E2E_SHOT_DATE to a day with closed entries',
  );

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Approvals: a name opens that row’s week, and Escape closes it', async ({ page }) => {
    await page.goto('/approvals?status=all');
    await hydrated(page);

    const row = page.locator('main tbody tr').first();
    await expect(row).toBeVisible();
    const name = (await row.locator('td').nth(0).getByRole('button').innerText()).trim();
    const week = (await row.locator('td').nth(1).innerText()).trim();

    await row.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(week);
    await expect(
      dialog.getByRole('link', { name: `Open ${name.split(' ')[0]}’s week` }),
    ).toBeVisible();
    const url = page.url();

    // Close without deciding — a decision is a write.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url()).toBe(url);
  });

  test('Projects: quick look opens a drawer; the name still navigates', async ({ page }) => {
    await page.goto(`/projects?${rangeEndingOnShotDate()}`);
    await hydrated(page);

    const quickLook = page.getByRole('button', { name: /^Quick look at / }).first();
    await expect(quickLook).toBeVisible();
    const name = (await quickLook.getAttribute('aria-label'))!.replace(/^Quick look at /, '');

    await quickLook.click();
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Open project' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const link = page.locator('main a[href^="/projects/"]', { hasText: name }).first();
    const href = (await link.getAttribute('href'))!;
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('link', { name: '← Projects' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a person’s day: clicking an entry opens its detail drawer', async ({ page }) => {
    await page.goto(`/people/${SHOT_USER_ID}?date=${SHOT_DATE}`);
    await hydrated(page);
    await expect(page.getByRole('link', { name: '← Back' })).toBeVisible();

    const entry = firstEntryButton(page.locator('main'));
    await expect(entry).toBeVisible();
    const label = (await entry.innerText()).trim();

    await entry.click();
    const dialog = page.getByRole('dialog', { name: label });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('During this entry')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('an entry drawer nested in the person drawer closes one level at a time', async ({
    page,
  }) => {
    await page.locator(`main a[href="/people/${SHOT_USER_ID}"]`).first().click();
    const person = page.locator('aside[role="dialog"]').first();
    await expect(person.getByRole('navigation', { name: 'Day navigation' })).toBeVisible();
    // Move the drawer (in place) to SHOT_DATE; when that is already the picker's day, filling
    // the same value fires no change, so only fill a different one.
    const picker = person.getByLabel('Jump to date');
    if ((await picker.inputValue()) !== SHOT_DATE) await picker.fill(SHOT_DATE!);
    await expect(picker).toHaveValue(SHOT_DATE!);

    const entryButton = firstEntryButton(person);
    await expect(entryButton).toBeVisible();
    const label = (await entryButton.innerText()).trim();
    await entryButton.click();

    const entry = page.getByRole('dialog', { name: label });
    await expect(entry).toBeVisible();
    await expect(entry.getByText('During this entry')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(2);
    const url = page.url();

    // Tab stays inside the inner drawer, not merely inside the outer one.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await holdsFocus(entry)).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(entry).toHaveCount(0);
    await expect(person).toBeVisible();
    expect(page.url()).toBe(url);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/overview$/);
  });

  test('Reports: a person opens in the drawer at /people/<id>; a reload is the full page', async ({
    page,
  }) => {
    await page.goto(`/reports?${rangeEndingOnShotDate()}`);
    await hydrated(page);

    const link = page.locator('main a[href^="/people/"]').first();
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href'))!;
    const name = (await link.innerText()).trim();

    await link.click();
    // The URL changes only once the intercepted route's payload arrives; under `next dev` the
    // first visit also compiles it, which can outlast the default 5s.
    await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 15000 });
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('navigation', { name: 'Day navigation' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: '← Back' })).toHaveCount(0);

    await page.reload();
    await hydrated(page);
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('link', { name: '← Back' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Day navigation' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
