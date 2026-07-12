# Phase 1 — MVP

**Goal:** an employee installs the macOS client, acknowledges the monitoring policy, tracks time (manual **and** automatic), and assigns entries to a project/task; a manager sees who is tracking now and today's hours per person, plus a per-person timeline.

**PRD:** §6.1 (time tracking), §6.5 (dashboard overview/timeline), §6.6 (users/teams), §6.8 (auth), §11 (Phase 1).

**Exit criteria (ship gate):**

- Bootstrappable: a seeded ADMIN can sign in; ADMIN can invite users who set their own password.
- Client: menu-bar start/stop/pause, project assignment, auto-start-on-active-app + auto-stop-on-idle, one-way sync with offline buffer, all gated behind `AckGate`.
- Dashboard: session login, team overview (tracking-now + today's hours), per-person timeline.
- Green gate; authorization (403) cases tested; behavior demonstrated end-to-end.

**Current starting point:** auth (login/refresh/logout) done; `time-entries` upsert/list done; `policy/effective` done; `users.list`/`teams.getMine`/`projects.list` read paths done; everything else in these modules is a `501` scaffold.

---

## Slice 1.1 — Bootstrap + user provisioning (self-serve auth)

**Goal:** create the first ADMIN without hand-inserting rows, and let ADMIN invite users who set their own Argon2id password.

**Depends on:** auth (done).

**Steps:**

1. **Schema** (`packages/db/prisma/schema.prisma`): add an invite mechanism. Extend `User` with `passwordHash String?` (nullable until accepted) **or** add a separate `Invite` model `{ id, email, teamId, role, tokenHash @unique, expiresAt, acceptedAt?, createdAt }`. Prefer `Invite` (keeps `User.passwordHash` non-null for active users). Migration in the same commit.
2. **Contracts** (`packages/contracts/src/auth.ts`): add `AcceptInviteSchema { token: string, password: string(min 8) }`. `packages/contracts/src/users.ts` already has `InviteUserSchema`.
3. **API — users.invite** (`modules/users`): implement `POST /users/invite` (ADMIN). Create the user (or `Invite`) with a one-time random token (store only its HMAC/hash), `expiresAt` (e.g. 72h). Enqueue an email job (`QueueService` → `email` queue, `invite` job). **Dev fallback:** return the invite link/token in the response when `NODE_ENV=development` so we can test before SMTP exists (log at `info`, never the raw token in prod).
4. **API — auth.acceptInvite** (`modules/auth`): `POST /auth/accept-invite` (`@Public`). Verify token hash + not expired + not used; Argon2id-hash the password; set `User.passwordHash`; mark invite accepted; issue a token pair (auto-login).
5. **Seed** (`packages/db/prisma/seed.ts`): create a bootstrap ADMIN from env (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) — hash with Argon2id. Add those to `packages/config` env schema (optional) + `.env.example`. Idempotent upsert.
6. **Tests:** `auth.service.spec` — acceptInvite success, expired token → 401, reused token → 401. `users.service.spec` — invite creates token, non-admin → 403 (guard-level, covered by controller `@Roles`).
7. **Verify:** seed admin → login → invite a user (capture dev token) → accept-invite → login as the new user.

**Done when:** an ADMIN seeded from env can log in and invite a user who sets their own password and logs in — no manual DB writes.

---

## Slice 1.2 — Users & teams management

**Goal:** manage the workforce: list, invite (1.1), deactivate/reactivate, acknowledge monitoring; read/create team + settings.

**Steps:**

1. **API — users**: implement `deactivate`/`reactivate` (`PATCH /users/:id` sets `deactivatedAt`), and `ackMonitoring` (`POST /users/:id/ack-monitoring`, self-only — already gated in the scaffold) writing `monitoringAckAt = now()` and an `AuditLog` row. Deactivation revokes the user's refresh tokens (reuse `AuthRepository` or add `revokeAllForUser`).
2. **API — teams**: implement `updateSettings` (moved to `admin` in the scaffold — `PATCH /admin/settings`): merge patch, **validate the merged object through `TeamSettingsSchema`** before writing, `AuditLog` in the same transaction.
3. **Repository:** add the writes to `users.repository.ts` / `admin.repository.ts` (Prisma only here).
4. **Dashboard (deferred to after Slice 1.5):** `admin/users` (list, invite form, deactivate button) and `admin/settings` (read + edit) require a working dashboard session, which lands in Slice 1.5. Deferred to keep this slice verifiable end-to-end (curl); the API + contracts ship here.
5. **Redaction/audit:** every mutation writes `AuditLog`; deletes/deactivations especially (`CLAUDE.md §4`).
6. **Tests:** service specs for deactivate (revokes tokens), ackMonitoring self-only 403, settings-merge validation (reject out-of-range retention). Integration test that settings round-trip through `TeamSettingsSchema`.

**Done when:** over the API, an ADMIN can deactivate/reactivate users and edit team monitoring settings; a deactivated user's refresh tokens are revoked (they can no longer refresh); `monitoringAckAt` is set only by the user themselves; every mutation writes an `AuditLog` row. Dashboard screens follow Slice 1.5.

---

## Slice 1.3 — Projects & tasks

**Goal:** ADMIN/MANAGER create projects and tasks; everyone lists their team's projects for assignment.

**Steps:**

1. **API — projects**: implement `createProject` (`POST /projects`, MANAGER/ADMIN — assert actor owns `dto.teamId`), `createTask` (`POST /projects/tasks` — assert the project is in the actor's team), and `archive` (`PATCH /projects/:id { archived }`). `list` (done) already returns projects+tasks in one query.
2. **Repository:** `createProject` / `createTask` / `setArchived` in `projects.repository.ts`.
3. **Contracts:** `CreateProjectSchema` / `CreateTaskSchema` exist; add `UpdateProjectSchema { archived: boolean }` if needed.
4. **Dashboard — `projects/[projectId]`** and a projects list page: show hours-per-project (wired in Phase 3 reports; MVP shows project + tasks). Admin can create.
5. **Tests:** service specs — create asserts team ownership (403 cross-team), archived projects excluded from the assignable list.

**Done when:** a manager creates a project with tasks; the client and dashboard can list them for assignment; cross-team creation is rejected.

---

## Slice 1.4 — Time entries (complete)

**Goal:** finish the server side of time tracking: idempotent create (done), list (done), **edit past entries with an audit diff**, and the "active entry" concept the overview needs.

**Steps:**

1. **API — PATCH `/time-entries/:id`**: implement edit (owner or MANAGER/ADMIN of the team). On update, write an `AuditLog` row with a before/after diff (`PRD §6.1`); set `editedById`/`editedAt`. Use `UpdateTimeEntrySchema` (exists).
2. **Repository:** `update` with a `$transaction` that writes the `AuditLog` in the same tx (`CLAUDE.md §4`).
3. **Active entry:** an entry with `endTime = null` is "running". Add a repository query `findActiveByUser` and a service method used by the overview (1.6). Enforce: at most one running entry per user (close the previous on a new start — decided client-side, validated server-side).
4. **Integration test (Testcontainers):** flip the gated `time-entries.e2e-spec.ts` (`RUN_E2E=1`) into a real suite — seed user+team, mint a JWT, assert: double-POST same UUIDv7 → one row (idempotent); GET self → 200; GET other as employee → 403; PATCH writes an audit row.
5. **Unit:** service specs for edit authorization (owner vs manager vs cross-team 403) and diff generation.

**Done when:** entries can be created idempotently, listed with correct authorization, and edited with an audit trail; the "running entry" query backs the overview.

---

## Slice 1.5 — Session & dashboard shell

**Goal:** real login on the dashboard, server-side session, and the authenticated app shell reading data from the API.

**Steps:**

1. **`app/api/auth/[...auth]/route.ts`**: implement `POST /api/auth/login` → call API `POST /auth/login` → set an **httpOnly, secure, sameSite=Lax** cookie holding the session (access + refresh, or a server-side session id). `POST /api/auth/logout` → API logout + clear cookie. The browser never holds a long-lived token in JS (`PRD §7.6`).
2. **`lib/session.ts`**: implement `getSession()` — read the cookie, return `{ userId, role, accessToken }`; refresh via API when the access token is near expiry (server-side).
3. **`lib/api-client.ts`**: extend the typed client — `listTimeEntries` (exists), add `teamOverview`, `listUsers`, `listProjects`, `getTeam`. Every call takes the session token and parses the response through the contract schema.
4. **Route protection:** `(app)/layout.tsx` redirects to `/login` when `getSession()` is null; `(auth)/login` renders the form (already scaffolded) wired to `/api/auth/login`.
5. **Tests:** Playwright (seeded) — unauthenticated → redirected to `/login`; login → lands on overview. Keep gated until seed+auth are wired, then enable.

**Done when:** a user logs in through the dashboard, gets an httpOnly session, and protected pages load data from the API with their token; logout clears the session.

---

## Slice 1.6 — Team overview + timeline

**Goal:** the manager's first real screen — who's tracking now and today's hours per person — plus a per-person timeline.

**Steps:**

1. **API — overview**: add `GET /reports/overview?date=` (MANAGER/ADMIN scope to team; also usable by `/me`) returning per-user `{ userId, name, tracking: boolean, trackedSecondsToday }`. Compute from `time_entries` (running = `endTime null`; today's sum). One query per user avoided via a grouped query in the repository.
2. **Contracts:** add `TeamOverviewSchema` / `TeamOverviewRowSchema` in `packages/contracts/src/reports.ts`.
3. **Dashboard — `(app)/page.tsx`**: server component fetches the overview; render per-person cards (tracking dot + hours). Use the `ActivityChart` placeholder later (Phase 2/3).
4. **Dashboard — `people/[userId]`**: fetch that user's entries (authorization enforced by the API) and render `components/timeline/Timeline` (exists).
5. **Tests:** service spec for the overview aggregation (tracking flag, today's sum, team scoping 403).

**Done when:** the overview shows live tracking state and today's hours for the team, and drilling into a person shows their timeline — all authorization enforced server-side.

---

## Slice 1.7 — macOS client MVP (the tracker)

**Goal:** the actual product surface employees use. Build in sub-slices; each is independently testable. **Every capture path routes through `AckGate` (already the structural gate).**

**Sub-slices:**

- **1.7a — Auth + policy + ack gate**
  - `Auth/`: login (email/password) → store access + refresh tokens in the **macOS Keychain** (`PRD §6.8`); refresh on 401.
  - `Policy/PolicyClient` (exists): fetch `/policy/effective`; if `ackRequired`, present the acknowledgement screen; on accept call `POST /users/:id/ack-monitoring`. `AckGate.withCaptureAllowed` already blocks capture until acknowledged.
  - XCTest: ack-gate refuses capture while `ackRequired`.
- **1.7b — Menu bar + manual tracking**
  - `App/StatusItemController` (exists): dropdown with Start / Stop / Pause, searchable project/task picker, "My Data", "Settings", "Quit". Icon reflects `idle`/`tracking`.
  - `Tracking/TimeTracker` (exists): start → create a `TimeEntry` with a client-minted **UUIDv7**; stop → set `endTime`; enqueue to the buffer.
  - Manual entries sync (1.7d) to `POST /time-entries`.
- **1.7c — Automatic tracking**
  - `Tracking/WorkspaceObserver`: active app via `NSWorkspace`; auto-start (config, default **off**).
  - `Tracking/IdleMonitor`: last-input via `CGEventSource`; auto-pause on sleep/lock; auto-stop after idle threshold (from `TeamSettings`); on resume, "away for X min — keep or discard?" (discard default) → `IdleEvent`.
  - XCTest: idle state machine (active → idle → resume → keep/discard).
- **1.7d — Offline buffer + sync**
  - `Storage/BufferStore`: replace the in-memory stand-in with **GRDB (SQLite)**, ≥24h capacity, UUIDv7 keys. (Adds the GRDB SwiftPM dependency — flagged for approval when we reach it.)
  - `Sync/SyncEngine` + `UploadQueue` + `BackoffPolicy`: one-way (client→server), every 1–2 min, exponential backoff; idempotent because the API upserts on UUIDv7.
  - XCTest: sync buffer drains, retries with backoff, dedupes on UUIDv7.

**Done when:** a signed-in employee who has acknowledged the policy can start/stop tracking manually and via active-app/idle detection, assign a project, work offline for ≥24h, and see entries sync exactly once. The indicator is always visible; no path bypasses the gate.

---

## Phase 1 testing & verification summary

- **Unit** (Vitest): every service authorization case (owner/manager/admin/403), invite/accept flow, settings-merge validation, overview aggregation, token duration parsing.
- **Integration** (Testcontainers): time-entry idempotency + audit, settings round-trip, deactivation-revokes-refresh.
- **E2E** (Playwright): login/redirect, overview renders seeded data, invite→accept happy path.
- **Client** (XCTest): ack gate, idle state machine, sync buffer.
- **Manual smoke** each slice: curl the endpoint / click the page / run the client flow.

## Phase 1 Definition of Done

- [ ] 1.1 Bootstrap admin + invite/accept flow.
- [ ] 1.2 Users & teams management + settings (API; dashboard after 1.5).
- [ ] 1.3 Projects & tasks CRUD.
- [ ] 1.4 Time entries complete (edit + audit + active-entry).
- [ ] 1.5 Dashboard session + shell.
- [ ] 1.6 Team overview + timeline.
- [ ] 1.7 macOS client MVP (a–d).
- [ ] Green gate; coverage ≥80% on `apps/api` + `packages/contracts`; end-to-end demo of the full loop.
