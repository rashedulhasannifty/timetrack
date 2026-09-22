import { test, expect, type Page } from '@playwright/test';

/**
 * A person's day opens in a drawer when you click through from Overview (Next parallel +
 * intercepting routes), while a DIRECT load of the same URL renders the full page. Intercepting
 * routes silently break the second half, so it is pinned here — along with the case that bit us
 * in design: navigating WITHIN a hard-loaded person page (a tab, a date) must not suddenly open
 * a drawer over it. Project detail has no drawer (Next's Next-Url prefix match cannot tell the
 * Projects index from a project page — see ProjectDetailContent); a test below pins that a
 * project click is a plain navigation.
 *
 * Prerequisites (same harness as session.spec.ts): seeded DB with at least one person on
 * Overview and one project on the Projects index; API + dashboard running;
 * E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD match the seeded admin.
 */
const EMAIL = process.env.E2E_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL!);
  await page.fill('input[name="password"]', PASSWORD!);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/overview$/);
  await hydrated(page);
}

/**
 * Wait until the client router has taken over. A Link clicked before hydration is a plain
 * browser navigation — a HARD load — which renders the full page instead of the drawer, and
 * would make the "directly loaded page" tests pass for the wrong reason.
 */
async function hydrated(page: Page) {
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for the drawer's real content, not loading.tsx's shell — that is also a dialog, and a
 * key pressed while the shell is being swapped for the day view lands wherever focus is then.
 */
async function drawerLoaded(page: Page) {
  await expect(
    page.getByRole('dialog').getByRole('navigation', { name: 'Day navigation' }),
  ).toBeVisible();
}

/** The first person link on Overview — its href and visible name. */
async function firstPerson(page: Page) {
  const link = page.locator('main a[href^="/people/"]').first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;
  return { link, href };
}

test.describe('person detail drawer', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('a direct load renders the full page, not a drawer', async ({ page }) => {
    const { href } = await firstPerson(page);
    await page.goto(href);

    await hydrated(page);
    await expect(page.getByRole('link', { name: '← Back' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Day navigation' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('tabs and dates on a directly loaded page never open a drawer over it', async ({ page }) => {
    const { href } = await firstPerson(page);
    await page.goto(href);

    await hydrated(page);
    await expect(page.getByRole('link', { name: '← Back' })).toBeVisible();

    await page.getByRole('link', { name: 'Activity' }).click();
    await expect(page).toHaveURL(/panel=activity/);
    await expect(page.getByRole('link', { name: '← Back' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('link', { name: 'Previous day' }).click();
    await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole('link', { name: '← Back' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('clicking a person on Overview opens the drawer and changes the URL', async ({ page }) => {
    const { link, href } = await firstPerson(page);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('navigation', { name: 'Day navigation' })).toBeVisible();
    // The drawer has its own close; the full page's Back link and title are not repeated.
    await expect(dialog.getByRole('link', { name: '← Back' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
  });

  test('the loading shell hands over to the day view without a second dialog', async ({ page }) => {
    // Count dialogs on every DOM change: loading.tsx renders its own RouteDrawer, and the real
    // one must REPLACE it (one Suspense boundary), never stack on top of it.
    await page.evaluate(() => {
      const w = window as unknown as { __maxDialogs: number };
      w.__maxDialogs = 0;
      new MutationObserver(() => {
        const n = document.querySelectorAll('[role="dialog"]').length;
        w.__maxDialogs = Math.max(w.__maxDialogs, n);
      }).observe(document.body, { subtree: true, childList: true });
    });
    const { link } = await firstPerson(page);
    // The link holds the avatar initials and the name; the name is its last line.
    const name = (await link.innerText()).trim().split('\n').pop()!.trim();
    await link.click();
    await expect(page.getByRole('dialog', { name })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(
      await page.evaluate(() => (window as unknown as { __maxDialogs: number }).__maxDialogs),
    ).toBe(1);
  });

  test('returning to Overview shows one loading skeleton, not one per slot', async ({ page }) => {
    // overview/loading.tsx used to sit beside the @drawer slot, and Next applies a segment's
    // loading/error files to EVERY slot of its layout — so a soft nav into Overview stacked two
    // PageSkeletons. They now live in overview/(board)/, scoped to the children slot alone.
    const { href } = await firstPerson(page);
    await page.goto(href);
    await hydrated(page);
    // Slow the RSC responses so the loading state is actually rendered.
    await page.route('**/*', async (route) => {
      if (route.request().headers()['rsc']) await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.evaluate(() => {
      const w = window as unknown as { __maxSkeletons: number };
      w.__maxSkeletons = 0;
      new MutationObserver(() => {
        const n = document.querySelectorAll('table[aria-hidden="true"]').length;
        w.__maxSkeletons = Math.max(w.__maxSkeletons, n);
      }).observe(document.body, { subtree: true, childList: true });
    });
    await page.getByRole('link', { name: '← Back' }).click();
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.locator('main a[href^="/people/"]').first()).toBeVisible({ timeout: 15000 });
    expect(
      await page.evaluate(() => (window as unknown as { __maxSkeletons: number }).__maxSkeletons),
    ).toBe(1);
  });

  test('tabs and dates inside the drawer keep the drawer', async ({ page }) => {
    const { link, href } = await firstPerson(page);
    await link.click();
    await drawerLoaded(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('link', { name: 'Activity' }).click();
    await expect(page).toHaveURL(new RegExp(`${href}\\?.*panel=activity`));
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');

    await dialog.getByRole('link', { name: 'Previous day' }).click();
    await expect(page).toHaveURL(new RegExp(`${href}\\?date=\\d{4}-\\d{2}-\\d{2}$`));
    await expect(dialog).toBeVisible();
  });

  test('after tab and date changes inside the drawer, one close still lands on Overview', async ({
    page,
  }) => {
    const { link } = await firstPerson(page);
    await link.click();
    await drawerLoaded(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('link', { name: 'Activity' }).click();
    await expect(page).toHaveURL(/panel=activity/);
    await dialog.getByRole('link', { name: 'Previous day' }).click();
    await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}$/);
    await dialog.getByRole('link', { name: 'Screenshots' }).click();
    await expect(page).toHaveURL(/panel=screenshots/);
    await dialog.getByRole('link', { name: 'Previous day' }).click();
    await expect(page).not.toHaveURL(/panel=/);

    await dialog.getByRole('button', { name: 'Close panel' }).click();
    await expect(page).toHaveURL(/\/overview$/);
    await expect(dialog).toHaveCount(0);
  });

  test('tabs and dates on the full page still push history', async ({ page }) => {
    const { href } = await firstPerson(page);
    await page.goto(href);

    await hydrated(page);
    await page.getByRole('link', { name: 'Activity' }).click();
    await expect(page).toHaveURL(/panel=activity/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });

  test('the close button returns to Overview and gives focus back to the link', async ({
    page,
  }) => {
    const { link } = await firstPerson(page);
    await link.click();
    await drawerLoaded(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Close panel' }).click();
    await expect(page).toHaveURL(/\/overview$/);
    await expect(dialog).toHaveCount(0);
    await expect(link).toBeFocused();
  });

  test('Tab and Shift+Tab stay inside the drawer', async ({ page }) => {
    const { link } = await firstPerson(page);
    await link.click();
    await drawerLoaded(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();

    const inside = () => dialog.evaluate((el) => el.contains(document.activeElement));
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      expect(await inside()).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await inside()).toBe(true);
    }
  });

  test('Escape collapses an open Add time form without closing the drawer', async ({ page }) => {
    const { link } = await firstPerson(page);
    await link.click();
    await drawerLoaded(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const url = page.url();

    // Nothing is submitted — the form is only opened and dismissed, so no DB write.
    await dialog.getByRole('button', { name: 'Add time' }).click();
    await expect(dialog.getByRole('button', { name: 'Add entry' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: 'Add entry' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add time' })).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(page.url()).toBe(url);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/overview$/);
  });

  test('Escape collapses an open entry edit or delete-confirm without closing the drawer', async ({
    page,
  }) => {
    const { link } = await firstPerson(page);
    await link.click();
    await drawerLoaded(page);
    const dialog = page.getByRole('dialog');
    const url = page.url();
    // Nothing is submitted — the forms are only opened and dismissed, so no DB write.
    const edit = dialog.getByRole('button', { name: 'Edit', exact: true }).first();
    test.skip((await edit.count()) === 0, 'the first person has no closed entry today');

    await edit.click();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(page.url()).toBe(url);

    await dialog.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await expect(dialog.getByRole('button', { name: 'Yes, delete' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('button', { name: 'Yes, delete' })).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(page.url()).toBe(url);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/overview$/);
  });

  test('on the full page, Escape collapses an open entry edit', async ({ page }) => {
    const { href } = await firstPerson(page);
    await page.goto(href);
    await hydrated(page);
    const edit = page.getByRole('button', { name: 'Edit', exact: true }).first();
    test.skip((await edit.count()) === 0, 'the first person has no closed entry today');
    await edit.click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Escape closes the drawer back to Overview', async ({ page }) => {
    const { link } = await firstPerson(page);
    await link.click();
    await drawerLoaded(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('soft-navigating away with the drawer open closes it', async ({ page }) => {
    const { link } = await firstPerson(page);
    await link.click();
    await drawerLoaded(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    // The backdrop covers the sidebar, so a pointer can't reach it; dispatch the click on the
    // link directly — this is the soft navigation (Link, not a reload) being asserted.
    await page
      .locator('aside a[href="/overview"], nav a[href="/overview"]')
      .first()
      .dispatchEvent('click');
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await link.click();
    await drawerLoaded(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .locator('aside a[href="/projects"], nav a[href="/projects"]')
      .first()
      .dispatchEvent('click');
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

/**
 * A dialog inside the drawer: the person day's screenshot lightbox renders INSIDE the drawer
 * panel, and both listen for keys on the window. Needs a person/day with at least one READY
 * screenshot (same env as screenshot-lightbox.spec.ts), and that person listed on Overview.
 */
const SHOT_USER_ID = process.env.E2E_SHOT_USER_ID;
const SHOT_DATE = process.env.E2E_SHOT_DATE;

test.describe('a dialog inside the person drawer', () => {
  test.skip(
    !EMAIL || !PASSWORD || !SHOT_USER_ID || !SHOT_DATE,
    'set E2E_ADMIN_*, and E2E_SHOT_USER_ID / E2E_SHOT_DATE to a day with a READY screenshot',
  );

  const drawer = (page: Page) => page.locator('aside[role="dialog"]');
  const lightbox = (page: Page) => page.getByRole('dialog', { name: /^Screenshot at / });

  /** Opens the drawer from Overview, then moves it (in place) to the screenshots of SHOT_DATE. */
  async function openShotsInDrawer(page: Page) {
    await login(page);
    const link = page.locator(`main a[href="/people/${SHOT_USER_ID}"]`).first();
    await link.click();
    await drawerLoaded(page);
    await expect(drawer(page)).toBeVisible();
    // When SHOT_DATE is today the picker already holds it: filling the same value fires no
    // change, so only fill a different day. The controlled input settles on the value after the
    // server render; the Screenshots tab's href then carries that date.
    const picker = drawer(page).getByLabel('Jump to date');
    if ((await picker.inputValue()) !== SHOT_DATE) await picker.fill(SHOT_DATE!);
    await expect(picker).toHaveValue(SHOT_DATE!);
    await drawer(page).getByRole('link', { name: 'Screenshots' }).click();
    await expect(page).toHaveURL(/panel=screenshots/);
    await expect(drawer(page)).toBeVisible();
    return { link };
  }

  /** Whether focus currently sits inside the element the locator points at. */
  const holdsFocus = (loc: ReturnType<Page['locator']>) =>
    loc.evaluate((el) => el.contains(document.activeElement));

  test('Escape closes only the lightbox; the drawer and its URL stay', async ({ page }) => {
    await openShotsInDrawer(page);
    const url = page.url();

    await drawer(page)
      .getByRole('button', { name: /View screenshot at .* full size/ })
      .first()
      .click();
    await expect(lightbox(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(lightbox(page)).toHaveCount(0);
    await expect(drawer(page)).toBeVisible();
    expect(page.url()).toBe(url);

    // With the lightbox gone the drawer owns Escape again — and because the date and tab
    // changes above replaced history rather than pushing, one step back is Overview.
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/overview$/);
  });

  test('Tab stays inside the open lightbox, then inside the drawer once it closes', async ({
    page,
  }) => {
    await openShotsInDrawer(page);
    await drawer(page)
      .getByRole('button', { name: /View screenshot at .* full size/ })
      .first()
      .click();
    await expect(lightbox(page)).toBeVisible();

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
      expect(await holdsFocus(lightbox(page))).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await holdsFocus(lightbox(page))).toBe(true);
    }

    await lightbox(page).getByRole('button', { name: 'Close' }).click();
    await expect(lightbox(page)).toHaveCount(0);
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await holdsFocus(drawer(page))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await holdsFocus(drawer(page))).toBe(true);
  });
});

/**
 * The project drawer was descoped: Next matches interception on the referrer path, and any slot
 * that can sit over the Projects index yields `/projects(?:/.*)?`, which also matches a
 * directly loaded `/projects/<id>` — so its own range picker would open a drawer over it. Pin
 * today's behaviour instead: a project click is a plain navigation to the full page.
 */
test.describe('project detail', () => {
  test.skip(!EMAIL || !PASSWORD, 'set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');

  test('clicking a project on the index opens the full page, not a drawer', async ({ page }) => {
    await login(page);
    await page.goto('/projects');

    await hydrated(page);
    const link = page.locator('main a[href^="/projects/"]').first();
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href'))!;

    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('link', { name: '← Projects' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hours over time' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
