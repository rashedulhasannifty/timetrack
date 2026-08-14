# Phase 4 — SSO + admin + retention

**Goal:** enterprise-readiness — SSO, full admin controls, automated retention (the compliance backbone), audit-log UI, and right-to-erasure tooling.

**PRD:** §6.6 (admin/settings), §6.8 (SSO Phase 4), §10 (retention), §4.4 (erasure), §11 (Phase 4).

**Exit criteria:** admins configure policy and productive/unproductive lists; retention runs nightly (DROP PARTITION + audit); the audit log is browsable; SSO login works; an admin can export and erase a user's data with an audit trail.

---

## Slice 4.1 — Retention automation — **do this first** (compliance backbone)

**Goal:** enforce retention by a job, not by prose (`PRD §10`).

**Steps:**

1. **Worker — `retention-cleanup` processor:** for each team, resolve `screenshotRetentionDays`/`activityRetentionDays` from `TeamSettings`; compute expired monthly partitions; **`DROP TABLE <partition>`** (fast) plus a bounded `DELETE` for stragglers; hard floor prevents "forever". Write an `AuditLog` row with counts per run.
2. **Scheduler:** register a nightly repeatable BullMQ job (worker bootstrap) that enqueues `retention` and `partition-provision`.
3. **Objects:** also delete the corresponding MinIO objects for dropped screenshot partitions (list by key prefix / retention date).
4. **Tests (integration):** seed old partitions → run → they're dropped, audit row written, floor respected; MinIO objects removed.

**Done when:** expired screenshot/activity data is dropped nightly by partition with an audit trail; no unbounded `DELETE`; retention floors enforced.

---

## Slice 4.2 — Audit-log UI

**Goal:** make the audit trail visible (`PRD §6.6`).

**Steps:**

1. **API:** `GET /admin/audit-log` is implemented (list). Add filters already in `AuditLogQuerySchema` (targetType/targetId/range) + pagination.
2. **Dashboard — `(app)/admin/audit`:** filterable, paginated table; drill into a row's `diff`.
3. **Tests:** ADMIN-only; filter application.

**Done when:** admins browse and filter the audit log, including before/after diffs.

---

## Slice 4.3 — Right-to-erasure + export

**Goal:** compliance tooling (`PRD §4.4`, §6.6).

**Steps:**

1. **API — `POST /admin/users/:id/erase`:** implement — hard-delete the user's `time_entries`, `activity_samples`, `screenshots` (+ MinIO objects), `idle_events`, tokens, and either anonymize or delete the `User`, **all in one transaction that also writes an `AuditLog` row** (`CLAUDE.md §4`). Require a reason (`EraseUserSchema` exists).
2. **API — export:** `GET /admin/users/:id/export` — a full data export (JSON/zip) for the user before erasure.
3. **Dashboard — `admin/users`:** export + erase actions with a confirm + reason prompt.
4. **Tests:** erase removes all data + writes audit in one tx; export completeness; ADMIN-only.

**Done when:** an admin can export then erase a user's data, atomically and audited.

---

## Slice 4.4 — SSO (SAML/OIDC)

**Goal:** SSO login alongside email/password (`PRD §6.8`).

**Steps:**

1. **Decision:** OIDC first (simpler, covers most IdPs); SAML if a customer requires it. Confirm target IdP(s) before building.
2. **API — `modules/auth`:** add an OIDC strategy — `GET /auth/oidc/login` → IdP redirect; `GET /auth/oidc/callback` → verify, find-or-provision the `User` (map to team/role by config/claims), issue the same access + refresh pair. Reuse the existing token issuance.
3. **Config:** OIDC issuer/client id/secret/redirect in `packages/config` + `.env.example`; secrets never in the repo.
4. **Dashboard:** "Sign in with SSO" on `/login`; session handling unchanged (still an httpOnly cookie).
5. **Tests:** callback provisions/links a user, issues tokens; state/nonce validated; deactivated users rejected.

**Done when:** a user logs in via the configured IdP and receives a normal session; provisioning maps them to the right team/role.

---

## Slice 4.5 — Advanced admin controls

**Goal:** finish the admin surface (`PRD §6.6`).

**Steps:**

1. **API/Dashboard:** productive/unproductive app & site list management (feeds client categorization); per-team policy editor (screenshot interval/blur/retention/idle threshold, capture toggles) — validated through `TeamSettingsSchema`; role management.
2. **Tests:** settings validation (floors/ranges), ADMIN-only, audit on every change.

**Done when:** admins manage policy, app lists, and roles from the dashboard, all validated and audited.

---

## Phase 4 Definition of Done

- [x] 4.1 Retention automation (partition drop + audit + MinIO cleanup).
- [x] 4.2 Audit-log UI.
- [x] 4.3 Export + erasure (atomic, audited).
- [x] 4.4 SSO (OIDC). API owns the protocol; dashboard BFF owns the cookie + redirects.
      Link-by-verified-email + auto-provision; SAML deferred.
- [x] 4.5 Advanced admin controls. Policy editor + app lists already shipped; this slice
      added separate productive/unproductive SITE lists (client host-categorization split)
      and admin role management (audited, last-active-admin + self-lockout guards).
- [x] 4.6 Manager assignment (post-phase follow-up). "Which manager manages which employee" had
      no representation anywhere: `User.teamId` + `role` derive it (a MANAGER manages their own
      team, via `ResourceAccessService`), but nothing could create a second team or move anyone
      between teams — `CreateTeamSchema` was unwired and the only route was `GET /teams/current`.
      Ships `GET /v1/teams` + `POST /v1/teams` (both ADMIN-only, creation audited as
      `team.create`) and `teamId` on `UpdateUserSchema`, so assigning an employee to a manager is
      a team move, audited as `user.team_change` with `{from, to}` — a permissions change, not a
      field edit, because manager-scoped queries resolve membership at read time: the new team's
      managers gain that person's history and the old team's lose it. `CreateTeamSchema.settings`
      was rebuilt on the DEFAULT-FREE field shape (Zod 4's `.partial()` keeps each `.default()`,
      so the old version materialized every key and hid what the admin actually chose) — the
      known landmine, closed now that a create endpoint exists. Dashboard: per-row team picker,
      create-team form, team column, and a team selector on the invite form so a hire lands under
      the right manager on day one.
      **Authorization change, deliberate and load-bearing:** ADMIN is now org-wide for user and
      team management. It was same-team (`users.service` 403, `GET /users` scoped to own team,
      invite restricted to own team), which cannot work once teams are the unit of management —
      a second team would have had no admin able to see or move its people. The last-admin guards
      in `setRole`/`setActive` moved from per-team to org-wide with it, so the deployment's final
      admin is still protected while a team's only admin can now be demoted provided another team
      has one. MANAGER scope is untouched and remains strictly own-team.
      Gate green: `pnpm lint`, `typecheck`, `build`; `pnpm test` — api 33 files / 248 tests,
      contracts 7 / 90, dashboard 21 / 198, worker 13 / 65; `apps/api` `test:e2e` (`RUN_E2E=1`,
      19 files / 151 tests) including 12 net-new against real Postgres covering the move + audit,
      a cross-team move, 422 on an unknown team, the silent no-op, history following the person,
      both org-wide last-admin guards, and roster scope per role.
      **Live-driven over HTTP** against the running API with real HS256 tokens, because
      service-level e2e bypasses the guards entirely: `GET /v1/teams` → 401 unauthenticated, 403
      as MANAGER, 200 as ADMIN; `POST /v1/teams` → 403 as MANAGER, 201 as ADMIN returning a
      complete default policy; `PATCH /v1/users/:id {teamId}` → 403 as MANAGER, 422 on an unknown
      team, 422 on an unknown field (strict body), 200 as ADMIN — the roster then read
      `admin:Eng, mgr:Eng, ada:Support` with exactly one `user.team_change` audit row carrying
      `{from, to}` and the admin's id. Fixture removed afterwards.
- [x] Green gate; compliance paths (retention, erasure) integration-tested; SSO validated
      end-to-end against a real Keycloak IdP (surfaced + fixed the RFC 9207 `iss` bug).
