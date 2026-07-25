# Dashboard Redesign — Slice 8: Overview reskin (Implementation Plan)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Reskin the dashboard home (`/`) from the bare member-card list to the mockup's Overview,
building ONLY the widgets backed by existing endpoints: a KPI row, an hours-by-project **donut**, a
**haven't-tracked** card, and **top-users** (by tracked hours + activity %). Compose the Slice-1 kit

- Slice-2 charts. Defer the rest with explicit notes.

**Architecture:** `apps/dashboard` only. Server page with a range (`searchParams` + `ReportRangePicker`,
like Reports) driving `teamSummary`/`projectSummary`; `teamOverview` (today) for tracking/haven't-
tracked. New tested pure transforms in `lib/overview-view.ts`. Uses `StatCard`, `SectionHeader`,
`Card`, `DonutChart`, `Gauge`/`BarMeter`, `Avatar`, `projectColor`.

## Global Constraints

- `dashboard` scope only. **No api/contracts/db change** (that's the whole point of "data-backed
  now" — anything needing a new endpoint is deferred). No new dependency. No console.log.
- **Data sources (confirmed):** `teamSummary.rows = {userId,name,trackedSeconds,activityPct}` (range);
  `projectSummary.rows = {projectId,name,trackedSeconds}` (range); `teamOverview = {date, rows:
{userId,name,tracking,trackedSecondsToday}}` (today). MANAGER/ADMIN-scoped; 403 → not-permitted.
- **Widget scope — BUILD (backed):**
  - KPI row: **Time tracked** (Σ teamSummary.trackedSeconds), **Active users** (count of rows with
    trackedSeconds > 0), **Currently tracking** (count teamOverview rows where tracking) — 3 StatCards.
  - **Top projects donut** (`DonutChart` from projectSummary, colors via `projectColor(projectId)`;
    center = total hours) + a legend.
  - **Haven't tracked** card: teamOverview rows with `trackedSecondsToday === 0` (today) — list with
    Avatar + name + "Never tracked today"; link to Users. (Uses today's data; honest + backed.)
  - **Top users** section: two `Card`s — "Tracked most hours" (teamSummary sorted by trackedSeconds
    desc, top 5, `BarMeter` normalized) and "Highest activity %" (sorted by activityPct desc, top 6,
    `Gauge` dials) — both with `Avatar`.
- **Widget scope — DEFER (note in the page as omitted; do NOT fabricate):** meeting-time / manual-
  time / mobile-time / unproductive-usage KPIs (need calendar or new source-split/category
  aggregations); daily **Trends** (no daily-team-series endpoint); team-wide **sites & apps** +
  **activity-level pills** + **category mix** (no team-activity-aggregation endpoint — only per-user
  `listActivitySummaries` exists); **WLB issues** (rules engine); **idle** top-users; **unrated
  sites**; the **sample-data banner** (no sample-data concept); **per-project app usage** (un-cut, but
  it's a PROJECT-DETAIL feature → its own full-stack slice, NOT Overview).
- Range: `searchParams {from,to}` with `defaultReportRange`; render `ReportRangePicker basePath="/"`.
  Title → header via `SetPageTitle title="Overview"`; remove `PageHeader`. Server Component.
- Commits `feat(dashboard)`/`test` ≤72, NO AI attribution, author = repo git user. Stay on
  `feat/ds-11-overview`; verify branch; never main.

## Mockup reference

`/private/tmp/.../scratchpad/TimeTrack.dc.html` Overview L139–457 (KPI grid L159–182; top-projects
donut L188–215; haven't-tracked L217–231; top-users L294–422; sites&apps L424–456 → DEFERRED).

---

### Task 1: `lib/overview-view.ts` transforms + tests

**Files:** Create `apps/dashboard/src/lib/overview-view.ts` + `.spec.ts`.
**Produces (pure, tested):**

- `overviewKpis(team: TeamSummaryRow[], overview: TeamOverviewRow[]): { totalSeconds; activeUsers; tracking }`.
- `topByHours(team: TeamSummaryRow[], n=5): {userId;name;trackedSeconds;pct}[]` (pct normalized to max).
- `topByActivity(team: TeamSummaryRow[], n=6): {userId;name;activityPct}[]` (sorted desc).
- `haventTracked(overview: TeamOverviewRow[]): TeamOverviewRow[]` (trackedSecondsToday === 0).
- `donutFromProjects(projects: ProjectSummaryRow[]): {label;value;color;display}[]` (color via
  `projectColor(projectId ?? 'none')`, display via `formatDuration`; drop zero rows) + a `totalHours`.
- [ ] TDD: tests for each (sums, sort order, normalization, empty inputs). Run fail→pass; typecheck.
      Commit `feat(dashboard): add overview view transforms + tests`.

### Task 2: Reskin the Overview page (`/`)

**Files:** Modify `apps/dashboard/src/app/(app)/page.tsx`.

- [ ] Read it first. Change to a ranged server page: `searchParams: Promise<{from?;to?}>`, session
      guard, `defaultReportRange`, build `params`, `Promise.all([teamSummary, projectSummary])` (catch
      403 → forbidden state "You’re not permitted to view the team overview." curly ’) + `teamOverview`
      (guarded, today). Render `<SetPageTitle title="Overview" />` (remove `PageHeader`); a header row
      with `<ReportRangePicker from to basePath="/" />`; then the sections built from `overview-view`:
  - `<SectionHeader label="Overview" />` + a KPI grid (`grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]`) of 3 `<StatCard>` (Time tracked = `formatDuration(totalSeconds)`, Active users, Currently tracking).
  - `<SectionHeader label="Latest data" />` + a grid with the `<DonutChart>` "Top projects" `Card` and the "Haven’t tracked" `Card`.
  - `<SectionHeader label="Top users" />` + a grid with "Tracked most hours" (`BarMeter` rows) and "Highest activity %" (`Gauge` dials), each in a `Card`, rows using `Avatar`.
  - A short muted note that meeting/app-usage/trend widgets are coming once their data lands (one line; honest, no fake widgets).
  - Keep the empty state (no rows) + forbidden state. Page stays a Server Component.
- [ ] typecheck+lint+build clean. Commit `feat(dashboard): reskin overview home to mockup`.

### Task 3: e2e scaffold

**Files:** Create `apps/dashboard/e2e/overview-reskin.spec.ts` (NOTE: `overview.spec.ts` exists — use
this distinct name; append-only NEW file). Cases: KPI cards render; top-projects donut present;
haven’t-tracked list; top-users sections. Skipped; realistic selectors; curly ’.
Commit `test(dashboard): scaffold overview reskin e2e cases`.

---

## Final verification

`pnpm lint && typecheck && test && build` green. Final whole-branch review (opus). Visual = user
eyeball (relaunch dev server; localhost:3000/). Blast radius: `/` page + `overview-view` + new e2e.
NEXT SLICE (separate, full-stack): un-cut per-project app usage on `/projects/[projectId]` (range
join + `time_entries(projectId)` index + coverage-% caveat) — revives the Slice-4 spike feature.
