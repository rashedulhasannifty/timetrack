# Slice 1 — Projects index page + nav (design)

Date: 2026-07-25
Branch: `feat/projects-index-nav`
Scope: `client` (dashboard) — one small `api` client fix, no API/contract/db change.

## Context

The dashboard has a stub `/projects/[projectId]/page.tsx` ("Scaffold for project {id}") and
**no** `/projects` index page and **no** Projects nav item (the Sidebar comment marks it as
intentionally omitted "until that route lands"). Meanwhile the backend for projects is already
built: `Project`/`Task` DB models (team-scoped, `archived` flag), a full projects API module,
per-project hours aggregation via `GET /reports/projects` (accepts a `projectId` filter), and
dashboard helpers `api.listProjects` / `api.projectSummary` plus `ProjectHoursChart` and
`toProjectBars`.

This slice is the first of four that build out the Projects surface (index → detail+deep-dive →
management+color-column → top-apps-spike). It ships the **index page + nav** using only existing
endpoints, so it has no db/contract/API-endpoint changes.

## Goal

A manager/admin can open **Projects** from the sidebar and see every team project with its total
tracked hours over a date range, active/archived status, and a color dot, and click through to a
(still-stubbed) detail page. Employees get the same "not permitted" treatment the Reports page
already uses.

## Non-goals (deferred to later slices)

- Real project **detail** page content and per-member/per-task breakdowns → Slice 2.
- **Creating / archiving** projects or tasks from the UI, and the persistent `Project.color`
  column + picker → Slice 3.
- **Top apps within a project** → Slice 4 (spike-gated).

## Design

### 1. Navigation

`components/ui/Sidebar.tsx` — add Projects to the `PRIMARY` array between Team and Reports:

```ts
{ href: '/projects', label: 'Projects', Icon: IconProjects },
```

`isActive` already matches a route's own subtree (`/projects` and `/projects/*`) for non-exact
items, so no change there. Remove the stale "intentionally omitted" comment.

`components/ui/icons.tsx` — add `IconProjects`, an inline SVG in the same style/stroke as the
existing 8 icons (a stacked-layers / folder glyph). Same `SVGProps<SVGSVGElement>` signature and
default 20×20 sizing as its siblings.

### 2. Deterministic project colors — `lib/project-color.ts`

`projectColor(id: string): string` returns a stable hex from a fixed, curated palette so a
project always renders the same dot color. This is needed **regardless** of Slice 3's color
column, because existing projects (and any created before the picker ships) have no stored color;
in Slice 3 this becomes the fallback used when `Project.color` is null.

- Palette: a small curated set (~8) of distinct, theme-safe hues seeded from the design token
  colors (accent, category-productive/neutral/unproductive) plus a few additional distinct hues.
  Values are plain hex constants (not CSS-var lookups) so they're usable in inline SVG fills and
  legible in both themes.
- Selection: a small deterministic hash of `id` modulo palette length. No randomness.
- `lib/project-color.spec.ts` (Vitest, no DB): same id → same color across calls; different ids
  spread across the palette (not all collapsing to one); output is always a valid palette member.

### 3. Index view transform — `lib/projects-index-view.ts`

A pure function that merges the two fetches into sorted rows, mirroring the existing `*-view.ts`
pattern (`reports-view.ts`, etc.). No I/O.

```ts
type ProjectIndexRow = {
  projectId: string; // real project id (links to detail)
  name: string;
  archived: boolean;
  trackedSeconds: number; // 0 if the project had no time in range
  color: string; // from projectColor(projectId)
};

// Inputs: Project[] (from listProjects, incl. archived when toggled) and
// ProjectSummaryRow[] (from projectSummary; may include a null-projectId "No project" bucket).
function toProjectIndexRows(
  projects: Project[],
  summaryRows: ProjectSummaryRow[],
): {
  rows: ProjectIndexRow[]; // real projects only, sorted by trackedSeconds desc, then name asc
  noProjectSeconds: number; // the null-id bucket total, for the muted footer row (0 if absent)
};
```

- Join `projectSummary` hours onto `listProjects` by id (left join on the project list — a project
  with no time in range shows 0h, and is still listed).
- The null-`projectId` summary row is **not** a project: its seconds are returned separately as
  `noProjectSeconds` for the footer, never as a clickable row.
- Sort: `trackedSeconds` desc, then `name` asc (stable, matches the API's own ordering intent).
- `lib/projects-index-view.spec.ts`: join correctness, 0h for projects absent from the summary,
  archived projects included, null bucket routed to `noProjectSeconds`, sort order, empty inputs.

### 4. api-client fix — `lib/api-client.ts`

`listProjects` currently calls `GET /projects` with no query and so always returns active-only.
Add an optional `includeArchived` that forwards the query param the API + `ListProjectsQuerySchema`
already accept:

```ts
listProjects(token: string, opts?: { includeArchived?: boolean }): Promise<Project[]>
// → GET /projects?includeArchived=true when opts.includeArchived is set
```

Default behavior (no opts) is unchanged, so existing callers are unaffected.

### 5. The page — `app/(app)/projects/page.tsx`

Server Component, following `reports/page.tsx` structure exactly:

- `const session = await getSession(); if (!session) return null;`
- `const sp = await searchParams;` (Next 16 async searchParams). Read `includeArchived` (`'true'`)
  and the range params; compute the range via `defaultReportRange(new Date())` when absent.
- Reuse the existing **`ReportRangePicker`** client component for the date range, and add a small
  **archived toggle** (a link that flips `?includeArchived`), preserving the current range in both
  controls' hrefs.
- Fetch in parallel:
  ```ts
  const [projects, summary] = await Promise.all([
    api.listProjects(session.accessToken, { includeArchived }),
    api.projectSummary(session.accessToken, { from, to }),
  ]);
  ```
- **Authorization:** `projectSummary` (`GET /reports/projects`) is MANAGER/ADMIN only. Wrap the
  fetch in the same `try/catch` the Reports page uses: on `ApiError` with `status === 403`, render
  the "You're not permitted to view this" state (reuse `Forbidden`/the reports copy). The nav item
  stays visible to all, exactly like Reports today.
- Render with `toProjectIndexRows(...)`:
  - `PageHeader title="Projects"` with a range subtitle.
  - A card containing a list/table: **color dot · name · total hours (`.tt-numeric`, right-aligned)
    · active/archived badge**. Each real-project row is a `<Link href={`/projects/${projectId}`}>`.
  - If `noProjectSeconds > 0`, a muted, non-clickable footer row "No project · Xh Ym".
  - Empty state (`rows.length === 0`): "No projects yet." (creation lands in Slice 3).
- Distinct states, mirroring Reports: **loaded**, **empty**, **forbidden (403)**, **error**.

### Data flow

```
Sidebar "Projects" → /projects
  page.tsx (server)
    getSession → api.listProjects({includeArchived})     ┐
                 api.projectSummary({from,to})  (403→Forbidden)
    toProjectIndexRows(projects, summary.rows) → rows + noProjectSeconds
    render list (projectColor(id) per dot) → each row → /projects/[id] (stub, Slice 2 fills it)
```

## Testing

- **Unit (Vitest, no DB):**
  - `lib/project-color.spec.ts` — determinism, spread, valid-member.
  - `lib/projects-index-view.spec.ts` — join, 0h, archived, null-bucket→footer, sort, empty.
- **E2E (Playwright, `*.spec.ts` naming — NOT `*.e2e-spec.ts`, or it's silently skipped):**
  - Seed an admin + a team with ≥2 projects and some time entries.
  - Projects index renders seeded projects with tabular hours; sorted by hours.
  - Archived toggle reveals an archived project; default view hides it.
  - Clicking a row navigates to `/projects/<id>`.
  - An employee session sees the "not permitted" state.
- Run before claiming done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
  (dashboard e2e via its Playwright command).

## Risks / notes

- **Employee visibility:** decision is to match Reports (403 → forbidden state), not to show a
  hours-less list. Revisit only if product wants employees browsing projects.
- **Range semantics:** "total hours" is range-scoped (default last 30 days) — the subtitle must
  state the range so the number isn't read as all-time.
- **No API/contract/db change here** keeps the slice low-risk; the `includeArchived` forward is the
  only non-dashboard-view edit and is backward-compatible.
- **`ReportRangePicker` reuse:** verify it doesn't hardcode navigation to `/reports`. If it does,
  make it path-aware (accept the current pathname / a `basePath` prop, defaulting to today's
  behavior) rather than forking a second copy. This is a planning detail, flagged so it isn't a
  surprise mid-build.

## Definition of done

- Projects nav item + icon; `/projects` index renders real projects with range-scoped hours,
  archived toggle, color dots, links to detail; muted "No project" footer; empty + 403 + error
  states; `listProjects` forwards `includeArchived`.
- Unit + e2e tests above pass; lint/typecheck/test/build green.
- Committed on `feat/projects-index-nav` with a Conventional Commit, no AI attribution.
