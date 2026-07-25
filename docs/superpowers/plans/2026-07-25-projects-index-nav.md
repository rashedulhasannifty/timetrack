# Projects Index Page + Nav — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/projects` index page and a Projects sidebar item so a manager/admin can see every team project with its range-scoped tracked hours, active/archived state, and a color dot, and click through to the (still-stubbed) detail page.

**Architecture:** Pure view/color helpers (unit-tested) + a Server Component page that mirrors the existing `reports/page.tsx` pattern (parallel fetch, 403→forbidden state), reusing existing endpoints (`listProjects`, `projectSummary`). One backward-compatible `api-client` change (`includeArchived`) and one shared-component change (`ReportRangePicker` gains an optional `basePath`). No DB migration, no contract change, no new API endpoint.

**Tech Stack:** Next.js 16 (App Router, React 19, Server Components), TypeScript, Tailwind v4 (design tokens in `globals.css`), Zod-inferred contract types from `@timetrack/contracts`, Vitest (unit), Playwright (e2e scaffold).

Spec: `docs/superpowers/specs/2026-07-25-projects-index-nav-design.md`

## Global Constraints

- Branch: `feat/projects-index-nav` (already created). Commit per task; Conventional Commits; scope `client`.
- **No AI attribution** in any commit/message/branch/trailer (CLAUDE.md §0). Author = repo's configured git user.
- **No new dependencies.** No icon library — icons are hand-rolled SVG in `components/ui/icons.tsx`.
- **Types come from `@timetrack/contracts`** — never hand-write a response interface.
- **Zod only** for any parsing; contract schemas already exist (`ProjectSchema`, `ProjectSummaryRowSchema`).
- Use **design tokens** (`text-text`, `bg-surface-raised`, `border-separator`, etc.); durations/percentages use the `.tt-numeric` class; no raw hex in JSX except the project dot color (which is data, from `projectColor`).
- **No `console.log`** (CLAUDE.md §4).
- **Dashboard e2e files must be `*.spec.ts`** (not `*.e2e-spec.ts`) or Playwright silently skips them.
- **Vitest does not typecheck specs** — `pnpm typecheck` (tsc) does, and `noUncheckedIndexedAccess` is on: guard every array index access (`arr[i]` is `T | undefined`).
- Run at the end: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green.

All commands run from the repo root `/Users/rashedulhasan/Development/personal/timetracker/timetrack`. Dashboard-scoped runs use `pnpm --filter @timetrack/dashboard <script>`.

---

### Task 1: Deterministic project color helper

**Files:**

- Create: `apps/dashboard/src/lib/project-color.ts`
- Test: `apps/dashboard/src/lib/project-color.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export const PROJECT_PALETTE: readonly string[]` — the curated hex palette.
  - `export function projectColor(id: string): string` — stable palette member for an id.

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/lib/project-color.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectColor, PROJECT_PALETTE } from './project-color';

describe('projectColor', () => {
  it('is deterministic: same id → same color', () => {
    const a = projectColor('018f9c1e-0000-7000-8000-000000000001');
    const b = projectColor('018f9c1e-0000-7000-8000-000000000001');
    expect(a).toBe(b);
  });

  it('always returns a palette member', () => {
    for (let i = 0; i < 50; i++) {
      expect(PROJECT_PALETTE).toContain(projectColor(`id-${i}`));
    }
  });

  it('spreads across the palette (not all one color)', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `project-${i}`);
    const distinct = new Set(ids.map(projectColor));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('handles the empty string without throwing', () => {
    expect(PROJECT_PALETTE).toContain(projectColor(''));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/project-color.spec.ts`
Expected: FAIL — cannot resolve `./project-color` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/lib/project-color.ts`:

```ts
/**
 * Deterministic project → dot color. Projects have no stored color yet (Slice 3 adds the
 * Project.color column + picker); this maps a project id to a stable hue so the same project
 * always renders the same dot. When the column lands it becomes the fallback for a null color.
 * Values are Apple-system hues chosen to read on both the light (#fff) and dark (#2c2c2e) card.
 */
export const PROJECT_PALETTE = [
  '#007aff', // blue
  '#5e5ce6', // indigo
  '#30b0c7', // teal
  '#34c759', // green
  '#ff9500', // orange
  '#ff2d55', // pink
  '#af52de', // purple
  '#ffcc00', // yellow
] as const;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function projectColor(id: string): string {
  const idx = hashString(id) % PROJECT_PALETTE.length;
  // Index is always in range; the `?? [0]` satisfies noUncheckedIndexedAccess.
  return PROJECT_PALETTE[idx] ?? PROJECT_PALETTE[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/project-color.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/project-color.ts apps/dashboard/src/lib/project-color.spec.ts
git commit -m "feat(client): deterministic project color helper"
```

---

### Task 2: Projects index view transform

**Files:**

- Create: `apps/dashboard/src/lib/projects-index-view.ts`
- Test: `apps/dashboard/src/lib/projects-index-view.spec.ts`

**Interfaces:**

- Consumes: `projectColor` (Task 1); `Project`, `ProjectSummaryRow` from `@timetrack/contracts`.
- Produces:
  - `export type ProjectIndexRow = { projectId: string; name: string; archived: boolean; trackedSeconds: number; color: string }`
  - `export function toProjectIndexRows(projects: Project[], summaryRows: ProjectSummaryRow[]): { rows: ProjectIndexRow[]; noProjectSeconds: number }`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/lib/projects-index-view.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toProjectIndexRows } from './projects-index-view';
import { projectColor } from './project-color';
import type { Project, ProjectSummaryRow } from '@timetrack/contracts';

const P = (id: string, name: string, archived = false): Project => ({
  id,
  teamId: '018f9c1e-0000-7000-8000-0000000000aa',
  name,
  archived,
});

describe('toProjectIndexRows', () => {
  it('joins summary hours onto projects by id and attaches a color', () => {
    const projects = [P('p1', 'Alpha'), P('p2', 'Beta')];
    const summary: ProjectSummaryRow[] = [
      { projectId: 'p1', name: 'Alpha', trackedSeconds: 3600 },
      { projectId: 'p2', name: 'Beta', trackedSeconds: 7200 },
    ];
    const { rows } = toProjectIndexRows(projects, summary);
    expect(rows).toEqual([
      {
        projectId: 'p2',
        name: 'Beta',
        archived: false,
        trackedSeconds: 7200,
        color: projectColor('p2'),
      },
      {
        projectId: 'p1',
        name: 'Alpha',
        archived: false,
        trackedSeconds: 3600,
        color: projectColor('p1'),
      },
    ]);
  });

  it('shows 0 seconds for a project absent from the summary and still lists it', () => {
    const { rows } = toProjectIndexRows([P('p1', 'Alpha')], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.trackedSeconds).toBe(0);
  });

  it('routes the null-projectId bucket to noProjectSeconds, never to rows', () => {
    const summary: ProjectSummaryRow[] = [
      { projectId: null, name: 'No project', trackedSeconds: 1800 },
      { projectId: 'p1', name: 'Alpha', trackedSeconds: 600 },
    ];
    const { rows, noProjectSeconds } = toProjectIndexRows([P('p1', 'Alpha')], summary);
    expect(noProjectSeconds).toBe(1800);
    expect(rows.every((r) => r.projectId !== null)).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('includes archived projects (caller decides whether to fetch them)', () => {
    const { rows } = toProjectIndexRows([P('p1', 'Old', true)], []);
    expect(rows[0]?.archived).toBe(true);
  });

  it('sorts by trackedSeconds desc, then name asc', () => {
    const projects = [P('p1', 'Bravo'), P('p2', 'Alpha'), P('p3', 'Charlie')];
    const summary: ProjectSummaryRow[] = [
      { projectId: 'p1', name: 'Bravo', trackedSeconds: 100 },
      { projectId: 'p2', name: 'Alpha', trackedSeconds: 100 },
      { projectId: 'p3', name: 'Charlie', trackedSeconds: 500 },
    ];
    const { rows } = toProjectIndexRows(projects, summary);
    expect(rows.map((r) => r.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  it('returns empty rows and zero bucket for empty inputs', () => {
    expect(toProjectIndexRows([], [])).toEqual({ rows: [], noProjectSeconds: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/projects-index-view.spec.ts`
Expected: FAIL — cannot resolve `./projects-index-view`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/dashboard/src/lib/projects-index-view.ts`:

```ts
import type { Project, ProjectSummaryRow } from '@timetrack/contracts';
import { projectColor } from './project-color';

export type ProjectIndexRow = {
  projectId: string;
  name: string;
  archived: boolean;
  trackedSeconds: number;
  color: string;
};

/**
 * Merge the project list (names, archived) with per-project hours (from /reports/projects) into
 * sorted index rows. The null-projectId "No project" bucket is not a project — its seconds are
 * returned separately for a muted footer row. Pure; unit-tested. No I/O.
 */
export function toProjectIndexRows(
  projects: Project[],
  summaryRows: ProjectSummaryRow[],
): { rows: ProjectIndexRow[]; noProjectSeconds: number } {
  const secondsById = new Map<string, number>();
  let noProjectSeconds = 0;
  for (const r of summaryRows) {
    if (r.projectId === null) noProjectSeconds += r.trackedSeconds;
    else secondsById.set(r.projectId, r.trackedSeconds);
  }

  const rows: ProjectIndexRow[] = projects.map((p) => ({
    projectId: p.id,
    name: p.name,
    archived: p.archived,
    trackedSeconds: secondsById.get(p.id) ?? 0,
    color: projectColor(p.id),
  }));

  rows.sort((a, b) => b.trackedSeconds - a.trackedSeconds || a.name.localeCompare(b.name));
  return { rows, noProjectSeconds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/projects-index-view.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/projects-index-view.ts apps/dashboard/src/lib/projects-index-view.spec.ts
git commit -m "feat(client): projects index view transform"
```

---

### Task 3: api-client forwards `includeArchived`

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts:187-188` (the `listProjects` entry).

**Interfaces:**

- Consumes: existing `get`, `ProjectSchema`.
- Produces: `listProjects(token: string, opts?: { includeArchived?: boolean }): Promise<Project[]>` — appends `?includeArchived=true` when requested; unchanged when called with no `opts`.

There is no unit spec for `api-client.ts` in this codebase (it's a thin fetch/parse layer verified by typecheck + the pages that use it), so this task has no separate test file; it is verified by `typecheck` and by Task 5's page compiling against the new signature.

- [ ] **Step 1: Make the change**

In `apps/dashboard/src/lib/api-client.ts`, replace the `listProjects` entry:

```ts
  listProjects: (token: string): Promise<Project[]> =>
    get('/projects', z.array(ProjectSchema), token),
```

with:

```ts
  listProjects: (token: string, opts?: { includeArchived?: boolean }): Promise<Project[]> =>
    get(
      `/projects${opts?.includeArchived ? '?includeArchived=true' : ''}`,
      z.array(ProjectSchema),
      token,
    ),
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @timetrack/dashboard typecheck`
Expected: PASS (no errors). Existing callers pass no `opts`, so they're unaffected.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/lib/api-client.ts
git commit -m "feat(client): listProjects forwards includeArchived"
```

---

### Task 4: `ReportRangePicker` gains an optional `basePath`

**Files:**

- Modify: `apps/dashboard/src/components/reports/ReportRangePicker.tsx`

**Interfaces:**

- Produces: `ReportRangePicker({ from, to, basePath }: { from: string; to: string; basePath?: string })` — pushes to `${basePath}?…`, defaulting to `/reports` so the existing Reports page caller is unchanged.

Verified by typecheck/build; the Reports page keeps working because `basePath` defaults to `/reports`.

- [ ] **Step 1: Make the change**

In `apps/dashboard/src/components/reports/ReportRangePicker.tsx`, change the signature and the push target:

```ts
export function ReportRangePicker({
  from,
  to,
  basePath = '/reports',
}: {
  from: string;
  to: string;
  basePath?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: 'from' | 'to', dateOnly: string) {
    const iso = key === 'from' ? `${dateOnly}T00:00:00.000Z` : `${dateOnly}T23:59:59.999Z`;
    const next = new URLSearchParams(params.toString());
    next.set(key, iso);
    router.push(`${basePath}?${next.toString()}`);
  }
```

(Leave the rest of the component — the two date inputs — unchanged.)

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @timetrack/dashboard typecheck`
Expected: PASS. The Reports page call `<ReportRangePicker from={from} to={to} />` still compiles (basePath defaults).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/reports/ReportRangePicker.tsx
git commit -m "refactor(client): make ReportRangePicker path-aware via basePath"
```

---

### Task 5: The `/projects` index page

**Files:**

- Create: `apps/dashboard/src/app/(app)/projects/page.tsx`

**Interfaces:**

- Consumes: `toProjectIndexRows` (Task 2), `api.listProjects` new signature (Task 3), `ReportRangePicker` `basePath` (Task 4), `api.projectSummary`, `ApiError`, `getSession`, `defaultReportRange`, `formatDuration`, `PageHeader`.
- Produces: the default export page component at route `/projects`.

This is a Server Component with no unit test (matches the other pages in this app, which are verified by typecheck/build + the e2e scaffold in Task 7). Verify it via typecheck + build + lint.

- [ ] **Step 1: Create the page**

Create `apps/dashboard/src/app/(app)/projects/page.tsx`:

```tsx
import Link from 'next/link';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { defaultReportRange } from '../../../lib/reports-view';
import { toProjectIndexRows } from '../../../lib/projects-index-view';
import { formatDuration } from '../../../lib/format';
import type { Project, ProjectSummary } from '@timetrack/contracts';

// Next 16 — searchParams is async. Projects index: per-project tracked hours over a range.
// Hours come from /reports/projects (MANAGER/ADMIN); a 403 becomes the not-permitted state,
// exactly like the Reports page. The nav item stays visible to everyone.
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; includeArchived?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const fallback = defaultReportRange(new Date());
  const from = sp.from ?? fallback.from;
  const to = sp.to ?? fallback.to;
  const includeArchived = sp.includeArchived === 'true';

  let projectList: Project[] | null = null;
  let summary: ProjectSummary | null = null;
  let forbidden = false;
  try {
    [projectList, summary] = await Promise.all([
      api.listProjects(session.accessToken, { includeArchived }),
      api.projectSummary(session.accessToken, new URLSearchParams({ from, to })),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden = true;
    projectList = null;
    summary = null;
  }

  const view = projectList && summary ? toProjectIndexRows(projectList, summary.rows) : null;

  // "Show/Hide archived" toggle preserves the current range and flips includeArchived.
  const toggle = new URLSearchParams({ from, to });
  if (!includeArchived) toggle.set('includeArchived', 'true');
  const toggleHref = `/projects?${toggle.toString()}`;

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={`Tracked hours · ${from.slice(0, 10)} – ${to.slice(0, 10)}`}
      />
      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view projects.</p>
      ) : view === null ? (
        <p className="text-text-secondary text-body">
          Something went wrong loading projects. Please try again.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <ReportRangePicker from={from} to={to} basePath="/projects" />
            <Link
              href={toggleHref}
              className="border-separator text-text hover:bg-surface inline-flex items-center rounded-md border px-3 py-1.5 text-label font-medium transition-colors"
            >
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </Link>
          </div>

          {view.rows.length === 0 ? (
            <p className="text-text-secondary text-body">No projects yet.</p>
          ) : (
            <ul className="bg-surface-raised border-separator divide-separator divide-y rounded-lg border shadow-e1">
              {view.rows.map((row) => (
                <li key={row.projectId}>
                  <Link
                    href={`/projects/${row.projectId}`}
                    className="hover:bg-surface flex items-center justify-between gap-4 px-4 py-3 transition-colors"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      />
                      <span className="text-text truncate font-medium">{row.name}</span>
                      {row.archived && (
                        <span className="text-text-secondary border-separator text-caption rounded-full border px-2 py-0.5">
                          Archived
                        </span>
                      )}
                    </span>
                    <span className="tt-numeric text-text-secondary text-label shrink-0">
                      {formatDuration(row.trackedSeconds)}
                    </span>
                  </Link>
                </li>
              ))}
              {view.noProjectSeconds > 0 && (
                <li className="text-text-secondary flex items-center justify-between gap-4 px-4 py-3">
                  <span className="flex items-center gap-3">
                    <span
                      className="bg-separator inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      aria-hidden="true"
                    />
                    <span>No project</span>
                  </span>
                  <span className="tt-numeric text-label shrink-0">
                    {formatDuration(view.noProjectSeconds)}
                  </span>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify typecheck + lint pass**

Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint`
Expected: PASS (no type errors, no lint errors).

- [ ] **Step 3: Verify the build compiles the route**

Run: `pnpm --filter @timetrack/dashboard build`
Expected: PASS; the build output lists a `/projects` route. (The page is dynamic — it reads cookies/searchParams — so it is not statically prerendered and the build does not call the API.)

- [ ] **Step 4: Commit**

```bash
git add "apps/dashboard/src/app/(app)/projects/page.tsx"
git commit -m "feat(client): projects index page with range, archived toggle, colors"
```

---

### Task 6: Projects nav item + icon

**Files:**

- Modify: `apps/dashboard/src/components/ui/icons.tsx` (add `IconProjects`)
- Modify: `apps/dashboard/src/components/ui/Sidebar.tsx` (import + add nav item, remove stale comment)

**Interfaces:**

- Consumes: `Base` icon wrapper (existing, in icons.tsx).
- Produces: `export const IconProjects` (same `SVGProps<SVGSVGElement>` signature as siblings); a Projects entry in the Sidebar `PRIMARY` array.

- [ ] **Step 1: Add the icon**

In `apps/dashboard/src/components/ui/icons.tsx`, append after `IconAdmin` (a stacked-layers glyph, matching the 24-viewBox / 1.6-stroke `Base` style):

```tsx
export const IconProjects = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3.5 20 7.5 12 11.5 4 7.5Z" />
    <path d="M4 12l8 4 8-4" />
    <path d="M4 16.5l8 4 8-4" />
  </Base>
);
```

- [ ] **Step 2: Add the nav item**

In `apps/dashboard/src/components/ui/Sidebar.tsx`:

Update the import to include `IconProjects`:

```ts
import { IconClock, IconTeam, IconProjects, IconReports, IconApprovals, IconAdmin } from './icons';
```

Replace the `PRIMARY` array (and its stale comment) with:

```ts
const PRIMARY: Item[] = [
  { href: '/', label: 'Team', Icon: IconTeam, exact: true },
  { href: '/projects', label: 'Projects', Icon: IconProjects },
  { href: '/reports', label: 'Reports', Icon: IconReports },
  { href: '/approvals', label: 'Approvals', Icon: IconApprovals },
  { href: '/admin/settings', label: 'Admin', Icon: IconAdmin },
];
```

(`isActive` already matches a route's own subtree for non-exact items, so `/projects` and `/projects/:id` both highlight the item — no change needed there.)

- [ ] **Step 3: Verify typecheck + lint + build**

Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint && pnpm --filter @timetrack/dashboard build`
Expected: PASS. The Projects item appears in the sidebar and links to `/projects`.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/ui/icons.tsx apps/dashboard/src/components/ui/Sidebar.tsx
git commit -m "feat(client): add Projects nav item and icon"
```

---

### Task 7: E2E scaffold spec

**Files:**

- Create: `apps/dashboard/e2e/projects.spec.ts`

**Interfaces:** none (test-only).

This mirrors the existing dashboard e2e convention: the current specs (`overview.spec.ts`, `admin.spec.ts`, …) are **skipped scaffolds** that document intended assertions and let `test:e2e` pass without a browser install or a running app. This slice adds the same for `/projects`; the assertions are un-skipped when a seeded live-dashboard e2e environment is wired (a cross-cutting effort, out of scope for this slice). The running verification for this slice is the Task 1 & 2 Vitest suites + typecheck/lint/build.

- [ ] **Step 1: Create the scaffold spec**

Create `apps/dashboard/e2e/projects.spec.ts`:

```ts
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
    await expect(page.getByText('You’re not permitted to view projects.')).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify the e2e suite still passes (all skipped)**

Run: `pnpm --filter @timetrack/dashboard test:e2e`
Expected: PASS with the new tests reported as skipped (no browser download needed for skipped tests).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/e2e/projects.spec.ts
git commit -m "test(client): scaffold projects index e2e spec"
```

---

### Final verification (after all tasks)

- [ ] **Run the full gate from the repo root:**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. The two new Vitest suites (`project-color`, `projects-index-view`) pass; typecheck/lint/build clean across the workspace.

- [ ] **Manual smoke (optional, needs the stack up):** with `docker compose -f infra/docker-compose.yml up -d`, `pnpm db:seed`, and `pnpm --filter dashboard dev` + API running, sign in as a manager/admin and open **Projects** from the sidebar: projects list with hours, "Show archived" reveals archived ones, rows link to `/projects/:id`, and the range picker updates the URL under `/projects` (not `/reports`).

## Notes / risks (carry into review)

- **No DB/contract/API-endpoint change** — the only non-view edits are the backward-compatible `listProjects` opts (Task 3) and the `ReportRangePicker` `basePath` default (Task 4). Confirm the Reports page still updates its URL under `/reports`.
- **Employee visibility** is intentionally the Reports-style 403 state, not a hours-less list (spec decision).
- **Range is 7 days** by default (reusing `defaultReportRange`); the subtitle prints the actual from–to so the number isn't read as all-time.
- **`noUncheckedIndexedAccess`**: Task 1 guards the palette index; Task 2 uses `.get() ?? 0` and map/spread (no bare index). Keep any new array access guarded.

```

```
