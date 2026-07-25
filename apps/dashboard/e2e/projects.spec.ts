import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app
 * (matches overview.spec.ts / admin.spec.ts). Un-skip once seeded data + auth are wired.
 * Intended assertions for the Projects index (Slice 1):
 */
test.describe('projects index', () => {
  test.skip('lists team projects with tracked hours, sorted by hours desc', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    // Seeded: two projects with time entries; the higher-hours project appears first.
  });

  test.skip('archived toggle reveals archived projects; default hides them', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByText('Archived')).toHaveCount(0);
    await page.getByRole('link', { name: 'Show archived' }).click();
    await expect(page.getByText('Archived').first()).toBeVisible();
  });

  test.skip('a project row links to its detail page', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link').filter({ hasText: /./ }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);
  });

  test.skip('an employee sees the not-permitted state', async ({ page }) => {
    // With an EMPLOYEE session, /reports/projects 403s → the not-permitted copy renders.
    await page.goto('/projects');
    await expect(page.getByText("You’re not permitted to view projects.")).toBeVisible();
  });
});

test.describe('project detail', () => {
  test.skip('renders header, three sections, and a back link', async ({ page }) => {
    await page.goto('/projects/some-project-id');
    await expect(page.getByRole('heading', { name: 'Hours over time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By member' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By task' })).toBeVisible();
    await expect(page.getByRole('link', { name: '← Projects' })).toBeVisible();
  });

  test.skip('shows not-found copy for a missing project', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText('Project not found.')).toBeVisible();
  });

  test.skip('an employee sees the not-permitted state', async ({ page }) => {
    await page.goto('/projects/some-project-id');
    await expect(page.getByText("You’re not permitted to view this project.")).toBeVisible();
  });
});

test.describe('project management', () => {
  test.skip('create a project with a name and color', async ({ page }) => {
    await page.goto('/projects');
    await page.getByPlaceholder('New project').fill('Launch');
    await page.getByRole('radio', { name: '#5e5ce6' }).click();
    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page.getByText('Launch')).toBeVisible();
  });

  test.skip('archive a project from the index', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'Archive' }).first().click();
    // The index hides archived rows by default; reveal them to see the badge.
    await page.getByRole('link', { name: 'Show archived' }).click();
    await expect(page.getByText('Archived').first()).toBeVisible();
  });

  test.skip('recolor a project from the detail page', async ({ page }) => {
    await page.goto('/projects/some-project-id');
    await page.getByRole('radio', { name: '#ff2d55' }).click();
    await page.getByRole('button', { name: 'Save color' }).click();
    await expect(page.getByRole('button', { name: 'Save color' })).toBeVisible();
  });
});
