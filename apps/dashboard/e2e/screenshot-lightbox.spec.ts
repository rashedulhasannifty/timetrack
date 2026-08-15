import { test, expect } from '@playwright/test';

/**
 * Covers the two day-view fixes that only exist in the browser: opening a capture full size,
 * and jumping to a date instead of stepping one day at a time.
 *
 * Prerequisites (same harness as session.spec.ts):
 *   docker compose -f infra/docker-compose.yml up -d
 *   pnpm db:migrate && pnpm db:seed
 *   API + dashboard running; E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD match the seeded admin.
 * Also needs a day with at least one READY screenshot — set E2E_SHOT_USER_ID and
 * E2E_SHOT_DATE to point at it, otherwise these skip rather than fail on an empty day.
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'password12';
const USER_ID = process.env.E2E_SHOT_USER_ID;
const DATE = process.env.E2E_SHOT_DATE;

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/$/);
}

test.describe('day view — screenshots and date navigation', () => {
  test.skip(
    !USER_ID || !DATE,
    'set E2E_SHOT_USER_ID and E2E_SHOT_DATE to a day that has a READY screenshot',
  );

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`/people/${USER_ID}?date=${DATE}`);
  });

  test('thumbnails actually load — a presigned URL the browser can reach', async ({ page }) => {
    // The original bug rendered every tile broken: the URL was signed for the container-network
    // host. A non-zero naturalWidth is the only assertion that catches that; the element and its
    // src exist either way.
    const first = page.locator('img[alt^="Screenshot"]').first();
    await expect(first).toBeVisible();
    await expect
      .poll(() => first.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('clicking a capture opens it full size, pages, and closes on Escape', async ({ page }) => {
    await page
      .getByRole('button', { name: /View screenshot at .* full size/ })
      .first()
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const caption = await dialog.locator('span').first().innerText();
    expect(caption).toMatch(/\d{2}:\d{2} · 1 of \d+/);

    // The overlay shows the full-res object, not the thumbnail it was opened from.
    const img = dialog.locator('img');
    await expect
      .poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
    expect(await img.getAttribute('src')).toContain('/raw/');

    // Paging does not wrap: at the first shot the back button is disabled.
    await expect(dialog.getByRole('button', { name: 'Previous screenshot' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Next screenshot' }).click();
    await expect(dialog.locator('span').first()).toContainText('2 of');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the date picker jumps straight to another day', async ({ page }) => {
    const picker = page.getByLabel('Jump to date');
    await expect(picker).toHaveValue(DATE!);

    // A day the arrows would take many clicks to reach.
    await picker.fill('2026-07-01');
    await expect(page).toHaveURL(/date=2026-07-01/);
    await expect(picker).toHaveValue('2026-07-01');
  });

  test('the picker refuses a future day, like the next arrow does', async ({ page }) => {
    const today = new Date().toISOString().slice(0, 10);
    await expect(page.getByLabel('Jump to date')).toHaveAttribute('max', today);
  });
});
