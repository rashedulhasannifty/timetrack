# Design — "tracking now" requires a live heartbeat

Date: 2026-08-03
Status: approved (pending spec review)

## 1. Problem

The manager Overview shows a live "N clients tracking now" footer and a "Currently tracking" KPI.
Both count `overview.rows` where `tracking === true`. The API computes that flag in
`apps/api/src/modules/reports/reports.repository.ts` as:

```sql
COALESCE(bool_or(te.id IS NOT NULL AND te."endTime" IS NULL), false) AS "tracking"
```

`tracking` is true for **any** user with an open time entry (`endTime IS NULL`), with **no recency
bound**. So a time entry that was never closed — a client that crashed mid-entry, or a manual entry
never stopped — reads as "tracking now" **forever**.

Observed live: the count showed "2 clients tracking now" while nobody's client was actually running.
The two counted users (`emp@example.com`, `employee-demo@example.com`) had `MANUAL` entries left open
for ~3 weeks; the newest `activity_samples` row in the whole database was 5+ days old. With a recency
bound the count would correctly read 0.

This is a correctness defect in **monitoring software**: a manager is shown a live claim about who is
working right now, and it is wrong. "Now" must mean now.

## 2. Goals / non-goals

**Goals**

- `tracking` means the timer is running **and** the client is provably alive right now: an open time
  entry **and** a recent activity-sample heartbeat.
- The freshness window is configurable via env (`TRACKING_FRESHNESS_SECONDS`, default 300 = 5 min).
- A regression test (real Postgres, Testcontainers) that fails against today's code: an open entry with
  a stale heartbeat must read `tracking = false`.

**Non-goals**

- **No change to `recordingNow`** on `/me` and `/people`. That flag is a _different_ derivation —
  `person-day-view.ts:249` computes it client-side as `isToday && parsed.some((p) => p.open)`, from the
  time entries in the person-day view-model, **not** from the API `tracking` field this slice touches.
  It shares the same staleness class (open entry ⇒ recording, no heartbeat check) but is day-scoped to
  _today_ and the person-day view-model is not currently fed an activity-sample recency signal. Fixing
  it is a separate follow-up (see §7), not this slice.
- No cleaning of the stale seed entries. The fix makes them read correctly (`false`) regardless; the
  orphaned rows are a separate data-hygiene question.
- No contracts / schema / migration / dependency change. `tracking` stays `z.boolean()`.
- No change to `trackedSeconds`, `activeUsers`, or any other overview column.

## 3. Key decisions

- **Heartbeat signal = `activity_samples.timestamp`.** A live client emits one activity sample every
  `ACTIVITY_SAMPLE_INTERVAL_SECONDS` (= 60) while tracking, so the most recent sample per user is the
  natural liveness heartbeat. No new column or table is needed.
- **`tracking` = open entry AND a sample within the window.** Both conditions, per the approved
  definition. A recent sample alone (no open entry) is not "tracking"; an open entry alone (stale
  samples) is the bug being fixed.
- **Window = `TRACKING_FRESHNESS_SECONDS`, default 300 (5 min), range [60, 3600].** At a 60s cadence
  this tolerates ~4 missed samples, so a single throttled/dropped heartbeat (the API has a global
  rate limiter and the client retries) does not flap a live user to not-tracking. Mirrors the existing
  `PRESIGNED_URL_TTL_SECONDS` env shape exactly.
- **Time authority stays in SQL `now()`.** The window is passed to the query as an integer number of
  seconds and applied as `now() - make_interval(secs => $n)`, consistent with the existing open-entry
  `trackedSeconds` calc (which already uses `now()`). No app-clock/DB-clock skew.
- **Applies to both `overviewForTeam` and `overviewForSelf`.** Both build the same overview rows, so
  both get the freshness parameter. The employee self-overview's `tracking` flag then also reflects a
  live heartbeat (defensive consistency), even though the manager footer/KPI are the visible consumers.
- **Index-backed, partition-pruned.** `activity_samples_userId_timestamp_idx` on `("userId",
"timestamp")` exists on every monthly partition; the `EXISTS (… timestamp > now() - window)` check
  prunes to the current partition and uses the index. No new index needed.

## 4. The query change

`apps/api/src/modules/reports/reports.repository.ts`, in the shared `overview(scope, dayStart, dayEnd,
freshnessSeconds)` helper. The `tracking` SELECT expression becomes:

```sql
(
  COALESCE(bool_or(te.id IS NOT NULL AND te."endTime" IS NULL), false)
  AND EXISTS (
    SELECT 1 FROM activity_samples a
    WHERE a."userId" = u.id
      AND a."timestamp" > now() - make_interval(secs => ${freshnessSeconds})
  )
) AS "tracking"
```

- `bool_or(...)` is an aggregate over the grouped time-entry rows (unchanged sub-expression); the
  `EXISTS` is a scalar correlated subquery keyed on the grouping column `u.id`, so it is constant per
  group and valid alongside `GROUP BY u.id, u.name`.
- `freshnessSeconds` is a bound integer parameter (`Prisma.sql`), never string-interpolated.
- Everything else in the query (the `trackedSeconds` clamp, the LEFT JOIN, the `deactivatedAt` filter)
  is unchanged.

Both public methods gain the parameter:

```ts
overviewForTeam(teamId: string, dayStart: Date, dayEnd: Date, freshnessSeconds: number): Promise<OverviewRow[]>
overviewForSelf(userId: string, dayStart: Date, dayEnd: Date, freshnessSeconds: number): Promise<OverviewRow[]>
```

## 5. Config

`packages/config/src/index.ts` — add to the Zod env schema, mirroring `PRESIGNED_URL_TTL_SECONDS`:

```ts
TRACKING_FRESHNESS_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
```

`.env.example` — document it in the same commit.

**Wiring — inject the value, don't call `loadEnv()` in the service.** `ReportsService` has an
env-free unit spec (`reports.service.spec.ts` constructs `new ReportsService(repo, access)` and calls
`svc.overview()`), so a `loadEnv()` call inside the service would throw in CI where no `.env` exists.
(That is why `minio.service.ts` can do `private readonly env = loadEnv()` and this service cannot —
minio has no unit spec.) Instead:

- `apps/api/src/modules/reports/reports.module.ts` — provide the value via a factory that reads env
  once at DI resolution: `{ provide: TRACKING_FRESHNESS_SECONDS, useFactory: () => loadEnv().TRACKING_FRESHNESS_SECONDS }`
  (token is an exported `symbol`/string const). The factory runs only at real app boot and at e2e
  module boot (where `test-env.ts` supplies env) — there is no module-boot unit test.
- `apps/api/src/modules/reports/reports.service.ts` — add a third constructor param
  `@Inject(TRACKING_FRESHNESS_SECONDS) private readonly trackingFreshnessSeconds: number` (explicit
  token, which also sidesteps the vitest DI-metadata gap) and pass `this.trackingFreshnessSeconds` to
  both `overviewForSelf` / `overviewForTeam` calls at lines ~42–43.
- `reports.service.spec.ts` — update the two hand-built `ReportsService` constructions to pass a
  literal (e.g. `300`) as the third arg, and update the `overviewForTeam/Self` `toHaveBeenCalledWith`
  assertions to expect that fourth argument. Stays env-free.

This keeps `ReportsRepository` a pure function of its arguments (the window is just a query parameter)
and the service unit-testable.

## 6. Testing

- **Integration (Vitest + Testcontainers, real Postgres 18 — no mocked Prisma):** in the reports
  repository / e2e spec, seed one team with three non-deactivated users and assert the `tracking` flag:
  1. Open entry (`endTime NULL`) **+ a sample at `now()`** → `tracking = true`.
  2. Open entry (`endTime NULL`) **+ a sample older than the window** (e.g. `now() - 10 min`) →
     `tracking = false`. **This case fails against today's code** (which returns `true`) — the
     regression guard.
  3. A **fresh sample but no open entry** (all entries closed) → `tracking = false`.
     Pass an explicit small `freshnessSeconds` (or the default 300) so the stale case sits outside it.
- **Update the existing running-entry test.** `reports.e2e-spec.ts`'s current
  "a running entry sets tracking=true and counts live elapsed" seeds an open entry with **no** activity
  sample; under the new rule that becomes `tracking=false`, so this test **will break** unless it also
  seeds a fresh sample (at ~`now()`) for the user. Update it in the same commit. Every `overviewFor*`
  call in this spec file gains the new `freshnessSeconds` argument.
- **Unit (dashboard, node-env):** none needed — `overview-view.ts` already has coverage for counting
  `tracking` rows, and its input contract (`tracking: boolean`) is unchanged.
- **Verification:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus the coverage-gated
  `test:coverage` (RUN_E2E=1 + Docker) stays green on `apps/api`.
- **Manual:** with the fix, reload the Overview — the footer and "Currently tracking" KPI read 0 while
  no client is live (matches reality), and would read N only for users with a heartbeat in the last
  5 minutes.

## 7. Risks / open items / follow-ups

- **`recordingNow` (`/me`, `/people`) has the same staleness class and is NOT fixed here** — it is
  client-side (`person-day-view.ts`), day-scoped to today, and fed only the person's time entries, not
  an activity-sample recency signal. Follow-up: either derive a heartbeat signal into the person-day
  view-model or surface the API `tracking` flag to that view. Tracked as a separate finding from this
  QA pass.
- **Stale seed entries** (`emp@example.com`, `employee-demo@example.com`, open ~3 weeks) are unrelated
  data hygiene; this fix makes them read `false` regardless. Cleaning them is a separate decision.
- **Clock source:** using SQL `now()` (not an app-computed threshold) is deliberate — it keeps the
  heartbeat window and the `trackedSeconds` open-entry clamp on the same clock.
- **Task decomposition** (for the plan): ~2 tasks — (1) config env + `.env.example`; (2) repository
  query + service wiring + the integration regression test. Task 2 depends on Task 1's env value.
- **Branch:** `fix/tracking-now-recency`, off `main` (currently also carries the verified
  `fix(dashboard): LineChart unit` hotfix from the same QA pass).
