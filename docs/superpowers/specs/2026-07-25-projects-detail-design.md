# Slice 2 — Project detail page + deep-dive (design)

Date: 2026-07-25
Branch: `feat/projects-detail`
Scope: `contracts` + `api` + `dashboard`. No db migration, no new dependency.

## Context

Slice 1 shipped the `/projects` index (list + hours + nav) and left `/projects/[projectId]`
a stub ("Scaffold for project {id}"). This slice makes the detail page real: for one project
over a date range it shows total tracked hours, an hours-over-time trend, a per-member breakdown,
and a per-task breakdown.

The backend idioms already exist to copy:

- Team-scoped authz (`ProjectsService.findForActor` → 404 missing / 403 cross-team).
- The window-clamp per-hours SQL (`ReportsRepository.projects/teamSummary/streamEntries`:
  `GREATEST(EXTRACT(EPOCH FROM (LEAST(COALESCE(endTime,now()),to) - GREATEST(startTime,from))),0)`,
  overlap filter `startTime < to AND COALESCE(endTime,now()) > from`, `FLOOR(SUM(...))::int`).
- The `LEFT JOIN tasks`/`LEFT JOIN projects` name idiom (`streamEntries`).
- The horizontal-bar `ProjectHoursChart` ({name, hours}) and the daily-bar `ActivityDailyChart`.
- Page structure from `projects/page.tsx` and `people/[userId]/page.tsx` (async params, getSession,
  `Promise.all`, `ApiError` 403 handling, `ReportRangePicker` with a `basePath`, `defaultReportRange`).

This is the 2nd of 4 Projects slices (index → **detail+deep-dive** → management+color-column →
top-apps-spike).

## Decisions (from brainstorming)

- **One endpoint**: `GET /projects/:id/detail?from&to` returns the whole payload
  (`{from, to, projectId, name, archived, totalSeconds, trend[], members[], tasks[]}`) — one
  round-trip, one authz check, one contract schema.
- **Visibility**: `@Roles('MANAGER','ADMIN')` + own-team (404 missing / 403 cross-team). Consistent
  with Slice 1, where employees got the forbidden state on the list's hours. ADMIN is **not** given
  cross-team access here — the projects list is own-team, so an admin can't reach other teams'
  projects anyway.
- **Trend bucketing**: attribute each entry's clamped duration to its **start day**
  (`GROUP BY date_trunc('day', startTime)`) — simple, one GROUP BY. An entry crossing UTC midnight
  counts on its start day (documented approximation; acceptable for an hours-tracked trend).

## Non-goals (later slices)

- `Project.color` column, color picker, and any create/edit/archive UI → Slice 3.
- Top apps/websites within a project → Slice 4 (spike-gated).
- Per-day midnight-split exact attribution — explicitly rejected in favor of start-day bucketing.

## Design

### 1. Contracts — `packages/contracts/src/projects.ts` (re-exported via `index.ts` already)

Add, using Zod 4 helpers (`z.uuid()`, `z.iso.date()`, `z.iso.datetime()`), types inferred:

```ts
export const ProjectHoursTrendRowSchema = z.object({
  day: z.iso.date(), // 'YYYY-MM-DD' (UTC start-day bucket)
  trackedSeconds: z.number().int().nonnegative(),
});
export const ProjectMemberRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});
export const ProjectTaskRowSchema = z.object({
  taskId: z.uuid().nullable(), // null → the "No task" bucket
  name: z.string(), // task name, or "No task"
  trackedSeconds: z.number().int().nonnegative(),
});
export const ProjectDetailSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  projectId: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  totalSeconds: z.number().int().nonnegative(),
  trend: z.array(ProjectHoursTrendRowSchema),
  members: z.array(ProjectMemberRowSchema),
  tasks: z.array(ProjectTaskRowSchema),
});
export const ProjectDetailQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});
// + inferred types for each.
```

### 2. API — projects module

**Controller** (`projects.controller.ts`) — add a detail route (no `@ResourceScope`; team authz is
in the service, matching the rest of this controller):

```ts
@Get(':id/detail')
@Roles('MANAGER', 'ADMIN')
detail(
  @Param('id') id: string,
  @Query(new ZodValidationPipe(ProjectDetailQuerySchema)) query: ProjectDetailQuery,
  @CurrentUser() user: SessionUser,
): Promise<ProjectDetail> {
  return this.service.detail(id, query, user);
}
```

Route note: `@Get(':id/detail')` does not collide with the existing `@Patch(':id')` (different
verb) and is more specific than any bare `:id` GET (there is none). Keep the Zod pipe scoped to the
`@Query` param only (not method-level `@UsePipes`).

**Service** (`projects.service.ts`) — `detail(id, query, actor)`:

1. `const project = await this.repo.findForActor(id)` — extend `findForActor`'s select to include
   `name` (it currently returns `{id, teamId, archived}`; `archive()` ignores the extra field).
2. `if (!project) throw this.notFound();` → RFC-9457 404.
3. `if (project.teamId !== actor.teamId) throw this.forbidden();` → RFC-9457 403.
4. Run the three aggregations concurrently:
   `const [trend, members, tasks] = await Promise.all([repo.hoursByDay(id, from, to),
 repo.membersForProject(id, from, to), repo.tasksForProject(id, from, to)]);`
   (`from`/`to` are `new Date(query.from|to)`.)
5. `const totalSeconds = members.reduce((s, m) => s + m.trackedSeconds, 0);` (every entry has a
   user, so summing members == the project's total clamped seconds; avoids a 4th query).
6. Return `ProjectDetailSchema.parse({ from: query.from, to: query.to, projectId: id,
name: project.name, archived: project.archived, totalSeconds, trend, members, tasks })`
   (re-validate on the way out, mirroring `ReportsService`).

**Repository** (`projects.repository.ts`) — three new raw-SQL reads (no `$transaction`; reads only).
Each replicates the window-clamp idiom and filters `te."projectId" = ${projectId}`; each returns
`Number(...)` on the `::int` seconds. Shapes:

```ts
// per start-day
hoursByDay(projectId, from, to): Promise<{ day: string; trackedSeconds: number }[]>
//   SELECT to_char(date_trunc('day', te."startTime"), 'YYYY-MM-DD') AS day,
//          FLOOR(SUM(<clamp>))::int AS "trackedSeconds"
//   FROM time_entries te
//   WHERE te."projectId" = ${projectId} AND <overlap>
//   GROUP BY 1 ORDER BY 1 ASC

// per member
membersForProject(projectId, from, to): Promise<{ userId; name; trackedSeconds }[]>
//   SELECT te."userId", u.name, FLOOR(SUM(<clamp>))::int AS "trackedSeconds"
//   FROM time_entries te JOIN users u ON u.id = te."userId"
//   WHERE te."projectId" = ${projectId} AND <overlap>
//   GROUP BY te."userId", u.name ORDER BY "trackedSeconds" DESC, u.name ASC

// per task (null taskId → "No task")
tasksForProject(projectId, from, to): Promise<{ taskId: string|null; name; trackedSeconds }[]>
//   SELECT te."taskId", COALESCE(t.name, 'No task') AS name, FLOOR(SUM(<clamp>))::int AS "trackedSeconds"
//   FROM time_entries te LEFT JOIN tasks t ON t.id = te."taskId"
//   WHERE te."projectId" = ${projectId} AND <overlap>
//   GROUP BY te."taskId", t.name ORDER BY "trackedSeconds" DESC, "taskId" ASC NULLS LAST
```

where `<clamp>` = `GREATEST(EXTRACT(EPOCH FROM (LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz)

- GREATEST(te."startTime", ${from}::timestamptz))), 0)` and `<overlap>` =
`te."startTime" < ${to}::timestamptz AND COALESCE(te."endTime", now()) > ${from}::timestamptz`.

Authorization note: the aggregations filter by `projectId` only. The project is already confirmed
own-team in the service, and these queries return exactly the hours logged against THIS project, so
no additional user-team scope clause is needed (or wanted).

Perf note: no index on `time_entries."projectId"` — these scan by the existing `(userId, startTime)`
index. Fine at current scale; flag for a future index if projects grow large.

### 3. Dashboard

**api-client** (`lib/api-client.ts`) — one getter:

```ts
getProjectDetail: (token: string, id: string, params: URLSearchParams): Promise<ProjectDetail> =>
  get(`/projects/${id}/detail?${params}`, ProjectDetailSchema, token),
```

**New chart** `components/charts/ProjectHoursTrendChart.tsx` — a small clone of
`ActivityDailyChart`: `{ data: { label: string; hours: number }[] }`, a vertical Recharts
`BarChart` (one bar/day, `XAxis dataKey="label"`, `YAxis` with NO fixed domain), bar fill
`var(--color-accent)`, and an empty state ("No time in this range."). Client component.

**View helper** `lib/project-detail-view.ts` (+ `.spec.ts`) — pure, no I/O:

- `toTrendBars(trend: ProjectHoursTrendRow[]): { label: string; hours: number }[]` — `day` →
  short label (`MM-DD`), seconds → hours rounded to 0.1.
- `toMemberBars(members: ProjectMemberRow[]): { name: string; hours: number }[]`.
- `toTaskBars(tasks: ProjectTaskRow[]): { name: string; hours: number }[]`.
  (Seconds→hours reuses the same rounding as `toProjectBars`; keep it consistent.)

**Page** `app/(app)/projects/[projectId]/page.tsx` — rewrite the stub, Server Component:

- `const { projectId } = await params;` `const sp = await searchParams;` `getSession()`.
- Range via `defaultReportRange(new Date())` with `sp.from/to` overrides (7-day default).
- `try { detail = await api.getProjectDetail(token, projectId, new URLSearchParams({from,to})); }`
  `catch (e) { if (ApiError) { if 404 → notFound; else if 403 → forbidden; else error } }`.
- States (distinct copy): **not-found** ("Project not found." — also covers cross-team 403? No —
  403 is separate), **forbidden** ("You're not permitted to view this project."), **error**, and
  **success**.
- Header: a color dot (reuse `projectColor(projectId)` from Slice 1) · project name · an "Archived"
  badge when `archived` · total hours (`formatDuration(totalSeconds)`, `.tt-numeric`). Range in a
  subtitle. A "← Projects" back link to `/projects`.
- Controls: `ReportRangePicker from={from} to={to} basePath={`/projects/${projectId}`}`.
- Sections: **Trend** (`ProjectHoursTrendChart` via `toTrendBars`), **By member**
  (`ProjectHoursChart` via `toMemberBars`), **By task** (`ProjectHoursChart` via `toTaskBars`).
  Each chart shows its own empty state when its array is empty.

### Data flow

```
/projects/[id]  (server)
  getSession → api.getProjectDetail(id, {from,to})
     └ GET /projects/:id/detail  (@Roles MANAGER/ADMIN)
         service.detail: findForActor → 404/403 → Promise.all(hoursByDay, membersForProject, tasksForProject)
         → totalSeconds = Σ members → ProjectDetailSchema.parse
  toTrendBars / toMemberBars / toTaskBars → ProjectHoursTrendChart + 2× ProjectHoursChart
```

## Testing

- **Contracts** (`packages/contracts`): parse tests for `ProjectDetailSchema` — a full valid
  round-trip, and a `tasks[]` row with `taskId: null` accepted (the "No task" bucket).
- **API unit** (`projects.service.spec.ts`, Vitest, no DB): `detail()` throws 404 when
  `findForActor` returns null and 403 when `teamId !== actor.teamId`; on the happy path it calls the
  three repo aggregations and returns a schema-valid object with `totalSeconds == Σ members`.
- **API e2e** (`projects.e2e-spec.ts` — Testcontainers PG18, `RUN_E2E=1` + Docker): seed one team,
  a project, ≥2 tasks (+ null-task entries), ≥2 members, entries spanning ≥2 UTC days. As a manager:
  `GET /projects/:id/detail` returns correct `totalSeconds`, `members[]` (desc), `tasks[]` incl. the
  "No task" bucket, and `trend[]` with a row per start-day. **403** for an EMPLOYEE (role gate);
  **404** for a missing id; **403** for a project owned by another team. (Note: `test:e2e -- <file>`
  narrows; plain `test -- <file>` does not and silently skips e2e.)
- **Dashboard** (`lib/project-detail-view.spec.ts`, Vitest node-env): the three mappers — seconds→
  hours rounding, day→label, empty arrays. Page verified by typecheck + lint + build. Extend the
  skipped `e2e/projects.spec.ts` scaffold with detail-page cases (header, three sections, back link,
  404/403 states) kept `test.skip` per the repo convention.
- Coverage: `apps/api` gate is measured by `test:coverage` (combined unit+e2e, needs `RUN_E2E=1` +
  Docker); functions is the binding metric. Run before claiming done:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Risks / notes

- **Two authz models in the codebase**: projects = own-team for all roles; reports = ADMIN-all. This
  slice deliberately uses the **projects** model (own-team) plus a MANAGER/ADMIN role gate. Do not
  import the reports `resolveScope`/`ResourceAccessService` path here.
- **Start-day trend** is an approximation (midnight-crossing entries count on the start day).
  Documented and accepted.
- **`totalSeconds = Σ members`** relies on every time entry having a non-null `userId` (guaranteed by
  the schema — `TimeEntry.userId` is required). Safe.
- **No index on `projectId`** — acceptable now; note for a future perf slice.
- **`findForActor` gains a `name` field** — additive; the existing `archive()` caller is unaffected.

## Definition of done

- `GET /projects/:id/detail` live (MANAGER/ADMIN, own-team; 404/403 correct), returning total,
  trend, per-member, per-task.
- Contracts schemas added + re-exported; detail page renders header + three sections + back link,
  with 404/403/error/empty states; api-client getter + trend chart + view helper added.
- Contracts parse tests, API unit authz tests, and API e2e (happy + 403 + 404 + cross-team) pass;
  dashboard view-helper unit tests pass; e2e scaffold extended (skipped). `pnpm lint && typecheck &&
test && build` green; API coverage gate holds under `test:coverage`.
- Committed on `feat/projects-detail`, Conventional Commits (scope `contracts`/`api`/`dashboard`),
  no AI attribution.
