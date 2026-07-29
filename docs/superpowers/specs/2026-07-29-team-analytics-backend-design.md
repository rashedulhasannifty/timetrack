# Design — Team analytics backend (manager dashboard, sub-project A)

Date: 2026-07-29
Status: approved (pending spec review)

## 1. Problem

The manager dashboard redesign (`docs/dashboard-redesign-prompt.md`) targets a far richer Overview
than what ships today: hours-tracked and productivity-per-day **trend charts**, productive /
unproductive / idle **leaderboards**, and a team-wide **website/app usage** breakdown. The current
Overview page renders only what the API can already produce — tracked time, activity %, per-project
time, who's tracking now, who hasn't tracked today — and ends with an honest note: _"Meeting-time,
app-usage and trend widgets appear once their data sources are connected."_

Those richer widgets are blocked on **team-level aggregation endpoints that do not exist yet**. The
raw data, however, already exists: `activity_daily_summaries` (per user/day: `avgActivityPct`,
`activeMinutes`, `byApp` JSON, `byCategory` JSON), `activity_samples` (per-60s: `appName`,
`category`, `activityPct` — partitioned), `idle_events`, and `time_entries`. This sub-project adds
the aggregation layer that unblocks the flagship Overview (sub-project B).

This is **sub-project A** of a three-part redesign:

- **A — Team analytics backend** (this spec): new team-scoped read endpoints in the `reports` module.
- **B — Overview flagship reskin + wire** (later spec): rebuild `/` on A's endpoints + existing data.
- **C — Reports / Approvals / Admin reskin** (later spec): visual alignment; optional Reports enrichment.

## 2. Goals / non-goals

**Goals**

- Add three team-scoped, range-based read endpoints to `apps/api`'s existing `reports` module:
  `GET /reports/trends`, `GET /reports/team-activity`, `GET /reports/app-usage`.
- Add their request/response Zod schemas to `packages/contracts/src/reports.ts`; types inferred.
- Compute everything from data that already exists — no schema change, no worker, no new module.
- Enforce team scoping and role gating exactly like the existing reports endpoints; test the 403
  case per endpoint, not just the 200.

**Non-goals**

- No dashboard rendering — every widget/chart wiring is sub-project B.
- No meeting-time or mobile-time metric (no product concept — the client is macOS-only and has no
  "meeting" notion; both are dropped from the prompt).
- No schema/migration change, no new worker processor, no raw-sample re-partitioning.
- No changes to the existing `overview` / `team-summary` / `projects` / `export.csv` endpoints.

## 3. Key decisions

- **Extend `reports`, don't add a module.** All three endpoints are team-scoped reads that belong to
  the reporting domain; they reuse `ReportRangeQuerySchema`, `resolveScope()`, and `scopeSql()`.
- **`unrated → NEUTRAL`.** TimeTrack categories are `PRODUCTIVE | NEUTRAL | UNPRODUCTIVE`. The
  prompt's "unrated" bucket maps to `NEUTRAL`; there is no fourth category.
- **Per-day source for trends = `activity_daily_summaries`.** It is already keyed by `day`, so
  category series need no cross-midnight splitting. `trackedSeconds` per day comes from `time_entries`
  clamped to each day's `[00:00, 24:00)` bounds (same clamp idiom the module already uses).
- **`byCategory` / `byApp` are in MINUTES, and partial.** The worker rollup writes `byCategory` as a
  sample-count-per-minute map (`{ PRODUCTIVE: 2, NEUTRAL: 1 }` = 2 min productive, 1 min neutral;
  interval is 60s so 1 sample = 1 min), and **omits** zero categories. Every JSON extraction is
  therefore `COALESCE((byCategory->>'…')::int, 0)`, and category **seconds** = `minutes × 60`. The
  contract's `…Seconds` fields are populated in seconds for unit-consistency with `trackedSeconds`.
- **App category from raw samples.** `byApp` (in the daily summary) carries no category, so the
  dominant category per app is derived from `activity_samples` grouped by `(appName, category)` —
  mirroring the existing `getProjectTopApps` precedent. Total seconds per app can come from the same
  grouped query.
- **Fan-out safety is mandatory.** `idle_events` and `activity_daily_summaries` are both one-to-many
  on `userId`; each is pre-aggregated in its own CTE keyed by `userId` before joining onto the scoped
  user set — identical discipline to the current `teamSummary` query (a naive double join would
  Cartesian-product and inflate every metric).
- **Scope is actor-derived, never client-widened.** The service resolves + authorizes scope; the
  repo only translates it to SQL via `scopeSql`. A client `teamId`/`userId` can only _narrow_ within
  what the actor may see, and an unauthorized value throws 403 before any query runs.

## 4. Endpoints & contracts

All three reuse `ReportRangeQuerySchema` (`from`, `to`, optional `userId`, optional `teamId`).
`app-usage` additionally accepts an optional `limit` (default 10). Added to
`packages/contracts/src/reports.ts`; every response is `Schema.parse(...)`-validated in the service
before return.

### `GET /reports/trends` → `TeamTrends`

Daily series for the "Hours tracked" line and "Productivity % per day" stacked bars.

```ts
TeamTrendDaySchema = z.object({
  day: z.iso.date(), // 'YYYY-MM-DD'
  trackedSeconds: z.number().int().nonnegative(), // time_entries clamped to the day
  productiveSeconds: z.number().int().nonnegative(), // Σ byCategory.PRODUCTIVE (min) × 60, that day
  neutralSeconds: z.number().int().nonnegative(),
  unproductiveSeconds: z.number().int().nonnegative(),
});
TeamTrendsSchema = z.object({ from, to, days: z.array(TeamTrendDaySchema) });
```

Days with no data are still emitted with zeros so the chart x-axis is continuous across the range.

### `GET /reports/team-activity` → `TeamActivity`

Per-person rollup over the range — powers the productive / unproductive / idle leaderboards.

```ts
TeamActivityRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  activeMinutes: z.number().int().nonnegative(),
  productivePct: z.number().int().min(0).max(100), // of categorized seconds
  neutralPct: z.number().int().min(0).max(100),
  unproductivePct: z.number().int().min(0).max(100),
  idleMinutes: z.number().int().nonnegative(),
  idlePct: z.number().int().min(0).max(100), // idle / (idle + active)
});
TeamActivitySchema = z.object({ from, to, rows: z.array(TeamActivityRowSchema) });
```

Category %s are of _categorized_ seconds (Σ byCategory), so the three sum to ~100 (rounding aside).
A user with no activity in range is omitted (consistent with `teamSummary`'s scoped-user filter).

### `GET /reports/app-usage` → `TeamAppUsage`

Team-wide website/app usage; generalizes per-project `topApps` to team scope.

```ts
TeamAppUsageRowSchema = z.object({
  appName: z.string(),
  seconds: z.number().int().nonnegative(),
  category: Category, // dominant PRODUCTIVE | NEUTRAL | UNPRODUCTIVE, from raw samples
});
TeamAppUsageSchema = z.object({ from, to, rows: z.array(TeamAppUsageRowSchema) });
```

Rows are ordered by `seconds` DESC and truncated to `limit`. `category` is the category with the most
sample-seconds for that app (tie-break `UNPRODUCTIVE > NEUTRAL > PRODUCTIVE`, matching the day-view
ribbon's dominance rule).

## 5. Aggregation (repository)

New `ReportsRepository` methods, each `$queryRaw` with `scopeSql(scope, col)` and CTEs:

- **`trends(scope, from, to)`** — a `generate_series` (or day-bucketed CTE) over the range; LEFT JOIN
  a per-day category CTE (`SUM(COALESCE((ads."byCategory"->>'PRODUCTIVE')::int, 0)) * 60` etc.,
  grouped by `ads.day` — minutes → seconds) and a per-day tracked-seconds CTE (time_entries clamped to
  each day). Zero-filled days survive.
- **`teamActivity(scope, from, to)`** — three CTEs keyed by `userId`: category sums from
  `activity_daily_summaries`, active minutes from the same, idle seconds from `idle_events`
  (`SUM(EXTRACT(EPOCH FROM (endTime - startTime)))`). Joined onto the scoped user set; percentages
  computed in SQL with `NULLIF` guards (no divide-by-zero).
- **`appUsage(scope, from, to, limit)`** — from `activity_samples`: `GROUP BY appName, category` to get
  seconds per (app, category); then per app, total seconds and the dominant category; `ORDER BY total
DESC LIMIT limit`. Sample-seconds = `count × ACTIVITY_SAMPLE_INTERVAL_SECONDS`.

Service methods (`trends`, `teamActivity`, `appUsage`) each call `resolveScope(query, user)` first
(throws 403 before any query), then parse the repo result through the response schema.

## 6. Auth, validation, testing

- Controller inherits the class-level `@Roles('MANAGER', 'ADMIN')`; each handler validates its query
  with `@Query(new ZodValidationPipe(...))` scoped to the parameter (never method-level `@UsePipes`).
- **403 tests per endpoint** (integration, Testcontainers, real PG — no mocked Prisma):
  - EMPLOYEE → any of the three endpoints → 403.
  - MANAGER passing another team's `teamId` → 403; MANAGER sees only their own team's rows.
  - ADMIN sees all teams; MANAGER `teamId === own` is allowed.
- **200 correctness**: seeded `activity_daily_summaries` / `idle_events` / `activity_samples` /
  `time_entries` assert: zero-filled trend days, category %s summing to ~100, idlePct math, dominant
  category selection + tie-break, `limit` truncation, empty-range → empty rows / zero-filled days.
- Keeps the `apps/api` + `packages/contracts` 80% coverage gate green (unit for any pure helpers,
  integration for the queries).

## 7. Files

**Add / edit**

- `packages/contracts/src/reports.ts` — the six new schemas + inferred types (import `Category`
  from `enums.ts`). Export from `index.ts` if not via barrel.
- `packages/contracts/src/reports.spec.ts` — schema parse/round-trip tests (bounds, category enum).
- `apps/api/src/modules/reports/reports.controller.ts` — three `@Get` handlers.
- `apps/api/src/modules/reports/reports.service.ts` — three service methods (scope → repo → parse).
- `apps/api/src/modules/reports/reports.repository.ts` — `trends`, `teamActivity`, `appUsage`.
- `apps/api/src/modules/reports/reports.service.spec.ts` — unit (scope resolution, 403 paths).
- `apps/api/src/modules/reports/reports.e2e-spec.ts` — integration (200 correctness + 403 per route).

**No change**: schema.prisma, worker, logger redact list (no new sensitive field — `appName` is
already returned by `getProjectTopApps`; `windowTitle` is never selected here), `.env`.

## 8. Risks / open items

- **`trends` per-day tracked-seconds clamp** is the one non-trivial query (an entry spanning midnight
  contributes to both days). The plan will pin the exact `generate_series` + clamp SQL; category
  series are trivial since summaries are already per-day.
- **`app-usage` reads the partitioned `activity_samples`.** Bounded by `[from, to]` and `limit`; the
  `(userId, timestamp)` index covers the scan. If range-wide app rollups prove heavy at scale, a
  future daily `byApp`-with-category rollup could replace it — out of scope here.
- **`byCategory` JSON keys** are assumed to be exactly the `Category` enum values. The plan verifies
  the writer (worker rollup) emits those keys before relying on `->>'PRODUCTIVE'`.
