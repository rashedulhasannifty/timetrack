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

- [ ] 4.1 Retention automation (partition drop + audit + MinIO cleanup).
- [ ] 4.2 Audit-log UI.
- [ ] 4.3 Export + erasure (atomic, audited).
- [ ] 4.4 SSO (OIDC/SAML).
- [ ] 4.5 Advanced admin controls.
- [ ] Green gate; compliance paths (retention, erasure) integration-tested; SSO validated against a real IdP.
