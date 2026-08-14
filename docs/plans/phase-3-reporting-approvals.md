# Phase 3 — Reporting + approvals

**Goal:** turn captured data into decisions — team/project reports, CSV export, timesheet approvals — plus gentle, **local** distraction nudges surfaced only in the end-of-day summary.

**PRD:** §6.4 (distraction alerts), §6.5 (reports, approvals), §7.8 (report endpoints).

**Exit criteria:** managers view project/team reports (Recharts), export a filterable date-range CSV, and approve/flag timesheets for payroll; distraction alerts are local-only and never streamed live to managers.

---

## Slice 3.1 — Reports aggregation + dashboard

**Goal:** real `team-summary` and project/task rollups.

**Steps:**

1. **API — `GET /reports/team-summary?from=&to=`:** implement in `ReportsService`/`ReportsRepository`. Aggregate tracked seconds per user (sum of entry durations) joined to users, plus activity % from `ActivityDailySummary` (Phase 2). **One query**, not N+1 — use a grouped SQL/`$queryRaw`. Scope: MANAGER → own team, ADMIN → any.
2. **API — project view:** `GET /reports/projects?from=&to=` — hours per project across the team.
3. **Contracts:** `TeamSummarySchema` exists; add `ProjectSummarySchema`.
4. **Dashboard:** `(app)/reports` — date-range picker, per-user and per-project charts (Recharts via the `charts/` components), filter by user/project/team.
5. **Tests:** aggregation correctness (duration sums, running-entry handling), team-scope 403, timezone/day-boundary handling.

**Done when:** managers see accurate per-user and per-project rollups for any date range, scoped to what they may see.

---

## Slice 3.2 — CSV export

**Goal:** filterable date-range CSV for billing/payroll.

**Steps:**

1. **API — `GET /reports/export.csv?...`:** stream **RFC 4180** rows (never buffer the whole set — async generator → Fastify stream). Filters: user/project/team + range. MANAGER/ADMIN only; same authorization scope as reports.
2. **Repository:** a cursor/stream query in `ReportsRepository` (`prisma` cursor pagination or `$queryRaw` streaming).
3. **Dashboard:** "Export CSV" button on `/reports` that hits the endpoint with current filters and downloads.
4. **Tests:** CSV shape (headers, escaping), filter application, large-set streaming (no full buffer), authorization.

**Done when:** a manager exports a correct, filtered CSV that streams without loading everything into memory.

---

## Slice 3.3 — Approvals workflow

**Goal:** approve/flag timesheets for payroll.

**Steps:**

1. **Schema:** add a `Timesheet`/`Approval` concept — e.g. `TimesheetApproval { id, userId, periodStart, periodEnd, status (PENDING|APPROVED|FLAGGED), reviewerId?, note?, decidedAt? }` + migration. (Decide period granularity: weekly per PRD.)
2. **Contracts:** `TimesheetApprovalSchema`, `DecisionSchema { status, note? }`.
3. **API — `modules/approvals`** (new module, six-file shape): list pending timesheets for the manager's team; `POST /approvals/:id/decide` (MANAGER/ADMIN, must own the team) → set status + `AuditLog`. Employees see their own approval status (self-scope).
4. **Dashboard:** `(app)/approvals` — queue of pending timesheets, approve/flag with a note; employee sees status on `/me`.
5. **Tests:** manager can only decide own-team timesheets (403 otherwise); decision writes an audit row; employee read is self-scoped.

**Done when:** managers approve or flag timesheets with an audit trail; employees see their status; cross-team decisions are rejected.

---

## Slice 3.4 — Distraction alerts (local, end-of-day)

**Goal:** gentle focus nudges that **build trust, not surveillance** — local only, surfaced in the end-of-day summary, never streamed live to managers (`PRD §6.4`).

**Steps:**

1. **Client:** detect sustained time on a flagged app/site (from `TeamSettings` productive/unproductive lists) → a **local** notification. Aggregate into the client's end-of-day summary.
2. **Explicitly not:** no real-time manager feed of distraction events. This is a deliberate product constraint (`PRD §6.4`) — do not add a live endpoint.
3. **Tests (XCTest):** threshold triggers a local nudge; nothing is sent to the server in real time.

**Done when:** distraction nudges are local and time-delayed; managers only ever see them (if at all) in aggregate end-of-day data, never live.

---

## Phase 3 Definition of Done

- [x] 3.1 Reports aggregation + charts. `GET /v1/reports/team-summary` and `GET /v1/reports/projects` (MANAGER own-team, ADMIN any/all, fan-out-safe CTE aggregation) plus the `/reports` dashboard page (range picker, per-user/per-project charts) all ship. Live-driven against a deterministic fixture (Team A: manager M with no data, employee E — 1h on project P + 30m unassigned; Team B: user Z — 1h unassigned; activity summaries 80%/100min + 40%/300min for E): MGR_A team-summary(own team) → 200, rows `[E: 5400s/50%]` — M and Z correctly absent (locked design decision, `docs/superpowers/specs/2026-07-19-slice-3.1-reports-aggregation-design.md` §3: team-summary only lists users with data in range, unlike `overview`); MGR_A with Team B's `teamId` → 403 problem+json; ADMIN no-filter → 200, rows `[E: 5400s/50%, Z: 3600s/0%]` (both teams); ADMIN projects → 200, `Repro P: 3600s` + `No project: 5400s`, reconciling to 9000s total; unauthenticated → 401. Gate green: lint/typecheck/test/build; `apps/api` coverage 87.28% functions (≥80%), `packages/contracts` 100% functions.
- [x] 3.2 Streaming CSV export. `GET /v1/reports/export.csv` streams one row per time entry (`entryId,user,project,task,startTime,endTime,durationSeconds,source,note`) via a keyset-paginated generator piped into a Fastify `StreamableFile` — never buffers the full result set. RFC 4180 quoting (comma/quote/CR/LF) plus formula-injection neutralization (leading `= + - @ TAB CR` on text fields prefixed with `'`); `startTime`/`endTime`/`durationSeconds` window-clamped to `[from, to]` and truncated to whole seconds, so each row satisfies `end − start == durationSeconds` unconditionally; the CSV total reconciles with team-summary for whole-second entry data (real client data), with at most per-row second-rounding otherwise. Same authorization scope as the rest of `/reports` (MANAGER own-team, ADMIN any/all, `resolveScope` 403 before the first byte). Live-driven against the running API (no seeded fixture — proves the stream through the real guard/pipe/filter/Fastify stack, not the aggregation numbers): MANAGER own-team `?from=2026-07-01&to=2026-07-31` → `200`, `content-type: text/csv; charset=utf-8`, `content-disposition: attachment; filename="timetrack-export-2026-07-01_2026-07-31.csv"`, `Transfer-Encoding: chunked`, correct header row (zero data rows, as expected with no fixture); MANAGER + a different team's `teamId` → `403` problem+json (`Not permitted to report on this team`); unauthenticated → `401` problem+json (`Authentication required`). Gate green: lint/typecheck/build; `apps/api` test:coverage (`RUN_E2E=1`, 45 files / 239 tests) 88.06% functions (≥80%), 91.78% statements/lines, 96.81% branches.
- [x] 3.3 Approvals workflow with audit. `TimesheetApproval { id, userId, periodStart, periodEnd, status, totalSeconds?, reviewerId?, note?, decidedAt? }` (migration `20260719131953_add_timesheet_approvals`), `@@unique([userId, periodStart])` as the upsert idempotency key (periodStart = Monday 00:00 UTC via `date_trunc('week', … AT TIME ZONE 'UTC')`, periodEnd = periodStart + 7 days). Worker generates weekly over a rolling `LOOKBACK_WEEKS = 4` window of CLOSED ISO weeks (current in-progress week excluded), active users only (`deactivatedAt IS NULL`) with >0 tracked time, via `createMany({ skipDuplicates: true })` — create-if-missing only, never touches an existing/decided row, which is what catches late offline syncs. `POST /v1/approvals/:id/decide` snapshots `totalSeconds` (clamped whole-second SUM over `[periodStart, periodEnd)`) at decision time; re-decision is allowed from any status and each decision writes its own `AuditLog` row (`action: 'timesheet.decide'`, `diff: { from, to, note }`) in the same transaction as the status update. Authz matrix: `GET /v1/approvals` is EMPLOYEE self-only, MANAGER own-team, ADMIN any/`teamId` (MANAGER with a foreign `teamId` → 403); `POST /decide` requires `@Roles('MANAGER','ADMIN')` plus `ResourceAccessService.assertCanAccessUser` (403 on a cross-team target). Gate green: lint/typecheck/build; `apps/api` test:coverage (`RUN_E2E=1`, 48 files / 255 tests) 88.54% functions (≥80%), 92.16% statements/lines, 96.48% branches; `@timetrack/worker` test:e2e (`RUN_E2E=1`, 3 files / 11 tests) all green; `@timetrack/contracts` test (4 files / 49 tests) all green. Live-driven against the running API with a seeded fixture (Team A, active user U with a 1h time entry, a PENDING timesheet row) and two minted MANAGER JWTs (HS256, `.env` `JWT_ACCESS_SECRET`): `GET /v1/approvals?status=PENDING` (MGR_A, same team) → `200`, `[{ userName: "…", status: "PENDING", trackedSeconds: 3600, totalSeconds: null }]`; `POST /decide { status: "APPROVED", note: "ok" }` (MGR_A) → `200` (`@HttpCode(200)` — a decision updates an existing timesheet, not a creation, matching the house convention for non-creation POST actions such as `users/:id/ack-monitoring`) with `status: "APPROVED"`, `totalSeconds: 3600` (snapshot), `reviewerId` = MGR_A's `sub`, `decidedAt` non-null, and exactly one `audit_log` row (`targetType='TimesheetApproval'`, `action='timesheet.decide'`) confirmed by direct query; `POST /decide { status: "FLAGGED" }` with MGR_B (different `teamId`) → `403` problem+json (`assertCanAccessUser` denies); `GET /v1/approvals` with no `Authorization` header → `401`; `POST /decide { status: "PENDING" }` (MGR_A) → `422` (Zod `DecisionSchema` rejects `PENDING` as a decision, confirming the param-scoped pipe). Fixture rows cleaned up after the drive. **Known limitation:** generation buckets an entry by its _start_ week, so an entry that starts in week W but spills into W+1 counts toward W only; if that spillover is a user's sole activity in W+1 (no other W+1 entry starts), no PENDING row is generated for W+1. This is rare (a working employee has other W+1 starts) and does not affect the decision-time snapshot (which clamps precisely to `[periodStart, periodEnd)`); an overlap-based generator is a future refinement if needed.
- [x] 3.4 Local distraction nudges (no live manager feed). Client-only slice (`apps/client-macos`), **zero** server surface — no contract/api/db/worker/dashboard change (managers see distraction only via the existing 2.3a activity rollup, never a live feed; PRD §6.4). Detection piggybacks on `ActivitySampler`, which already computes a `Category` each ~60s window **only while tracking and only through `AckGate`**: a new optional `onCategorized: (Category) -> Void` hook (defaulted → no call-site breakage) fires on measured ticks only (after the `!Task.isCancelled` guard + enqueue, never on a skip path) and feeds two net-new pure units. `DistractionMonitor` counts **consecutive** `UNPRODUCTIVE` samples and, at `threshold = 10` (10 consecutive minutes at the 60s cadence), posts ONE local `"distraction"` nudge; any non-unproductive sample (PRODUCTIVE **or** NEUTRAL) resets the streak and re-arms; fires exactly once per streak. `DailyDistractionAccumulator` tallies today's unproductive seconds (mirrors `DailyTotalAccumulator`: per-local-day, new day replaces, stale day → 0) and `EndOfDayScheduler` appends `" ~<Zm> on distracting apps."` to the existing summary only when Z > 0 (zero-case body byte-identical). Wired in `AppDelegate` with the `onCategorized` closure hopping to `@MainActor` (both units main-thread-only) and reading `now` once; **sign-out teardown resets the streak + tally** (`distractionMonitor.stop()` + `dailyDistraction.reset()`), the load-bearing cross-user integrity guard. The subsystem has **no network/disk/logging seam** — "nothing streamed live" holds by construction; it sees only a `Category` enum, never app name/host/window title/key content (CLAUDE.md §1). Tests (XCTest, `DEVELOPER_DIR=<Xcode> swift test`): 13 net-new (6 monitor + 4 accumulator + 2 sampler-hook + 1 summary-line), full client suite **182/182 green**, `swift build` clean. Reviewed per-task + a final whole-branch review (zero Critical / zero Important; two Minors — the documented count-based-streak-across-a-gap tradeoff (spec §3.2) and the 60s-cadence coupling, now commented at the wiring site).
- [x] 3.5 Weekly emails (post-phase follow-up — closes the last two `TODO(scaffold)` no-ops). `EmailProcessor`'s `weekly-summary` and `missing-timesheet` cases logged and returned; nothing enqueued them either, so both were dead as well as empty. Now scheduled by a new `EmailScheduler` on the existing `email` queue — `weekly-summary` at 08:00 Mon UTC, `missing-timesheet` at 09:00 Mon UTC, both AFTER `timesheet-generate` (00:30 Mon) whose PENDING rows the summary counts. Both report the last CLOSED ISO week (`closed-week.ts`, Monday-start UTC, byte-identical to the generator's `date_trunc('week', … AT TIME ZONE 'UTC')`); an optional `{ now }` in the job data overrides the clock so an operator can resend an earlier week. **Weekly summary:** one mail per team to that team's active `MANAGER`s (team membership + role IS the manager relation — `Team` has no manager FK, same rule as `ResourceAccessService`); lists every active member including zero-hour ones, with week-clamped tracked seconds (the same `CLAMPED_SECONDS` expression the approvals repository snapshots with) and an activity % weighted by each day's `activeMinutes` from the unpartitioned `activity_daily_summaries`; no rollup renders as `—`, never `0%`. A team with active members but no active MANAGER logs a warn rather than being silently skipped. **Missing-timesheet reminder:** to the EMPLOYEE, when their week came in under the team's new `TeamSettings.timesheetReminderHours` (0–80). It defaults to **0 = off** — an upgrade must not start emailing employees, matching the opt-in stance of `distractionAlertsEnabled`/the unproductive lists — and is editable in the admin settings UI. Managers/admins are not reminded (they are the reviewers), nor is anyone who joined after the week began (they could not reach a full-week target). Both jobs check `mailer.enabled` BEFORE querying, and — unlike the single-message `invite` job — collect per-recipient failures and log a `{ sent, failed }` count instead of throwing: one job → N mails, so a BullMQ retry would re-send everyone who already succeeded. `TeamSettings` rides `EffectivePolicy` to the macOS client, which ignores the new key (Swift `Decodable` skips unknown fields); no migration (`Team.settings` is a Json column). Gate green: `pnpm lint`/`typecheck`/`test` (worker 48 email tests, contracts 87, api 236)/`build`; `@timetrack/worker` `test:e2e` (`RUN_E2E=1`, 5 files / 26 tests) green including 10 net-new against real Postgres covering team grouping, boundary clamping, activity weighting, per-team PENDING counts, threshold on/off, and every reminder exclusion; `apps/api` `test:e2e` (`RUN_E2E=1`, 18 files / 139 tests) green.
- [x] Green gate; all report/approval endpoints authorization-tested; distraction data never streamed live. Reports (3.1) + CSV export (3.2) + approvals (3.3) all ship with resource-scoped authorization and the 403 test written alongside the 200; the server gate was green at the 3.3 merge (`api` coverage functions 88.54% ≥ 80%). Distraction (3.4) is local-only with no live endpoint (verified by construction — no network seam). Phase 3 complete.
