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
- [x] 3.2 Streaming CSV export. `GET /v1/reports/export.csv` streams one row per time entry (`entryId,user,project,task,startTime,endTime,durationSeconds,source,note`) via a keyset-paginated generator piped into a Fastify `StreamableFile` — never buffers the full result set. RFC 4180 quoting (comma/quote/CR/LF) plus formula-injection neutralization (leading `= + - @ TAB CR` on text fields prefixed with `'`); `startTime`/`endTime`/`durationSeconds` window-clamped to `[from, to]`, reconciling with team-summary totals. Same authorization scope as the rest of `/reports` (MANAGER own-team, ADMIN any/all, `resolveScope` 403 before the first byte). Live-driven against the running API (no seeded fixture — proves the stream through the real guard/pipe/filter/Fastify stack, not the aggregation numbers): MANAGER own-team `?from=2026-07-01&to=2026-07-31` → `200`, `content-type: text/csv; charset=utf-8`, `content-disposition: attachment; filename="timetrack-export-2026-07-01_2026-07-31.csv"`, `Transfer-Encoding: chunked`, correct header row (zero data rows, as expected with no fixture); MANAGER + a different team's `teamId` → `403` problem+json (`Not permitted to report on this team`); unauthenticated → `401` problem+json (`Authentication required`). Gate green: lint/typecheck/build; `apps/api` test:coverage (`RUN_E2E=1`, 45 files / 239 tests) 88.06% functions (≥80%), 91.78% statements/lines, 96.81% branches.
- [ ] 3.3 Approvals workflow with audit.
- [ ] 3.4 Local distraction nudges (no live manager feed).
- [ ] Green gate; all report/approval endpoints authorization-tested; distraction data never streamed live.
