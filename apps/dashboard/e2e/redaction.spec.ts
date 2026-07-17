import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped like the other data-bearing e2e specs — the dashboard e2e harness has
 * no seeded employee auth + READY screenshot yet. Un-skip once that seed harness lands.
 * Flow: employee opens /me → Screenshots tab → Redact → enter reason → Confirm → tombstone.
 * Selectors are best-effort; verify them against the live UI when un-skipping (the tab
 * control is a button rendered by MeTabs).
 */
test.skip('employee redacts a screenshot and sees a tombstone', async ({ page }) => {
  await page.goto('/me');
  await page.getByRole('button', { name: 'Screenshots' }).click();
  await page.getByRole('button', { name: 'Redact' }).first().click();
  await page.getByLabel('Redaction reason').fill('personal message visible');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Redacted').first()).toBeVisible();
  await expect(page.getByText('personal message visible')).toBeVisible();
});
