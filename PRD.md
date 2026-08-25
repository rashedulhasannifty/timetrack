# PRD: Internal Time Tracking & Workforce Analytics Tool

**Status:** Draft v2 (stack-aligned) · foundation + auth built, feature work per `docs/ROADMAP.md`
**Owner:** [fill in]
**Last updated:** 2026-07-12
**Target platforms:** macOS (native menu bar client), Windows (native system tray client), Web (manager/admin dashboard)

> As-built refinements to this spec are listed in **§7.9**. Engineering rules live in `CLAUDE.md`; the phased build plan in `docs/ROADMAP.md`.

---

## 0. Stack Decision (locked)

| Layer            | Choice                                       | Version (stable as of 2026-07-11)                                                  |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Runtime          | Node.js                                      | **24.x LTS**                                                                       |
| API              | NestJS                                       | **11.1.x** (v12 targets Q3 2026 — ESM/Vitest/oxlint; do **not** adopt pre-release) |
| HTTP adapter     | Fastify (`@nestjs/platform-fastify`)         | 11.x                                                                               |
| ORM              | Prisma                                       | **7.8.x** (TypeScript query compiler, no Rust engine)                              |
| Database         | PostgreSQL                                   | **18**                                                                             |
| Validation       | Zod                                          | **4.4.x**                                                                          |
| Logging          | Pino                                         | **10.3.x** + `nestjs-pino`                                                         |
| Frontend         | Next.js (App Router) + React                 | **16.2.x** / React 19                                                              |
| Styling          | Tailwind CSS                                 | 4.x                                                                                |
| Charts           | Recharts                                     | latest stable                                                                      |
| Queue            | BullMQ + Redis                               | latest stable                                                                      |
| Object storage   | MinIO (S3-compatible, self-hosted)           | latest stable                                                                      |
| Client (macOS)   | Swift 6 / SwiftUI + AppKit                   | Xcode 16+, macOS 14+ target                                                        |
| Client (Windows) | C# 13 / WPF on .NET 9                        | Windows 10 1809+ target, self-contained win-x64; no runtime dependencies           |
| Package manager  | pnpm workspaces                              | 10.x                                                                               |
| Testing          | Vitest (unit/integration) + Playwright (e2e) | latest stable                                                                      |

**Why Swift for the client:** screenshot capture (`ScreenCaptureKit`), idle detection (`CGEventSource`), and app/window sampling (`NSWorkspace`, Accessibility API) have no viable cross-platform equivalent. Electron would double resource usage and still need native shims. The client is the only non-TypeScript surface.

**Version policy:** exact versions pinned in lockfile; renovate/dependabot for patch + minor. No canary/RC/preview channels in `main`. No NestJS 12 until the migration guide ships and CI is green on a spike branch.

---

## 1. Summary

An internal, self-hosted tool for tracking employee time, activity, and productivity across a 10–50 person team. Employees run a lightweight macOS menu bar app or Windows system tray app that tracks time (manual + automatic), captures periodic screenshots, samples activity levels, and surfaces idle/distraction nudges locally. Managers view aggregated data through a Next.js dashboard backed by a NestJS API.

## 2. Goals

- Managers get visibility into how time is spent across projects/tasks.
- Accurate, low-friction time tracking (manual and automatic).
- Defensible time records for billing/payroll.
- Focus nudges via idle/distraction alerts — opt-in, transparent, local-first.
- Fully self-hostable: no third-party SaaS dependency for core data.

## 3. Non-Goals (v1)

- No GPS/location tracking.
- No keystroke _content_ logging — event counts only, never keys pressed.
- No webcam capture.
- No mobile app.
- No AI-based productivity scoring.
- No hidden/stealth mode. Ever. This is a hard product constraint, not a backlog item.

---

## 4. Legal / Privacy — Read Before Building

Employee monitoring carries real disclosure obligations (several US states require written notice; GDPR applies to any EU-based staff; Bangladesh/other jurisdictions vary — confirm per employment location). The product **encodes** these assumptions in code, not just in policy docs:

1. **Notice & acknowledgement gate.** The client refuses to start monitoring until the signed-in user has acknowledged the monitoring policy. `users.monitoring_ack_at` must be non-null. Enforced server-side on `/policy/effective`.
2. **Always-visible indicator.** `NSStatusItem` icon changes state (idle / tracking / capturing). No API or config flag can hide it. There is no build target that removes it.
3. **Symmetric transparency.** Employees can view every screenshot, activity sample, and time entry recorded about them, via the same API the manager uses (scoped to `self`).
4. **Right to erasure.** Admin has export + delete tooling; deletions are recorded in `audit_log`.
5. **Retention is enforced by a job, not by policy prose** (§10).

This is a product/engineering note, not legal advice — loop in legal/HR before rollout.

---

## 5. Personas

| Persona  | Needs                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| Employee | Simple start/stop, clear visibility into what's captured, minimal interruption  |
| Manager  | Team dashboards, per-person drill-down, exportable reports, timesheet approvals |
| Admin/IT | Deployment, provisioning, policy config, retention, audit                       |

---

## 6. Feature Breakdown

### 6.1 Time Tracking

**Manual**

- Start / stop / pause from the menu bar dropdown.
- Assign entry to a project/task (searchable dropdown).
- Optional note per entry.
- Edit past entries — every edit writes an `audit_log` row with before/after diff.

**Automatic**

- Active application detected via `NSWorkspace`.
- Auto-start on login (configurable, defaults **off**).
- Auto-pause on system sleep/lock.
- Auto-stop after idle threshold (configurable, default 5 min).
- On resume: "You were away for X minutes — keep or discard?" Discard is the default action.

**Captured per entry:** `startTime`, `endTime`, `projectId`, `taskId`, `note`, `source` (`MANUAL` | `AUTO`), `userId`.

### 6.2 Screenshot Capture

- Interval-based, default every 10 min, admin-configurable per team.
- `ScreenCaptureKit` (macOS 12.3+; we target 14+).
- Optional blur / thumbnail-only mode (per-team privacy setting).
- Local file deleted only after a **confirmed** upload (HTTP 201 + storage key echoed back).
- Employees can browse a log of their own screenshots.
- Employees can flag/redact a screenshot with a reason → visible to manager as "redacted by employee: <reason>", never silently removed.
- Admin controls: frequency, retention, blur level, or disable entirely per team.

### 6.3 Activity Monitoring

- Active app + window title sampled every N seconds (default 60).
- Keyboard/mouse **event counts** per minute → an "activity %" per interval. Content is never read, and the client has no code path that can read it.
- App/site categorisation (`PRODUCTIVE` | `UNPRODUCTIVE` | `NEUTRAL`) applied **client-side** from an admin-defined list.
- Rolled up into per-day / per-week summaries by a BullMQ job.

### 6.4 Idle & Distraction Alerts

- Idle detection via `CGEventSource` last-input timestamp.
- Idle threshold → local notification: "Idle for X min — still working?"
- Distraction alerts: sustained time on a flagged app/site → gentle **local** notification. Not streamed live to managers; surfaces only in the end-of-day summary. Deliberate: real-time snitching destroys trust and tanks adoption.
- All thresholds configurable per team.

### 6.5 Manager Dashboard (Next.js)

- Team overview: who's tracking now, today's hours per person.
- Per-employee timeline: entries, app breakdown, activity %, screenshot thumbnails.
- Project/task view: hours per project across the team.
- Reports: date-range CSV export, filterable by user/project/team.
- Approvals: approve/flag timesheets for payroll.

### 6.6 Admin / Settings

- User & team management (invite, deactivate, roles: `EMPLOYEE` | `MANAGER` | `ADMIN`).
- Monitoring policy: screenshot interval, idle threshold, blur mode, retention days, capture on/off.
- Productive/unproductive app & site lists.
- Data export & deletion tools (compliance / right-to-erasure).
- Audit log viewer.

### 6.7 Notifications

- Local (client): idle alerts, distraction nudges, "forgot to start tracking" reminder.
- Email (BullMQ worker): weekly manager summary, missing-timesheet reminders.

### 6.8 Auth

- Email/password at launch; SSO (SAML/OIDC) in Phase 4.
- Argon2id password hashing (not bcrypt — Argon2id is the current OWASP default).
- Short-lived access JWT (15 min) + rotating refresh token stored in **macOS Keychain**; refresh tokens are hashed at rest and revocable per device.
- RBAC via NestJS guards + a `@Roles()` decorator. Every controller is deny-by-default.

---

## 7. Technical Architecture

### 7.1 Repository Structure (pnpm workspaces)

#### 7.1.1 Top level

```
timetrack/
├── apps/
│   ├── api/                 NestJS 11 (Fastify) — HTTP
│   ├── worker/              NestJS standalone — BullMQ processors
│   ├── dashboard/           Next.js 16 (App Router)
│   ├── client-macos/        Swift (outside the pnpm graph)
│   └── client-windows/      C# / .NET (outside the pnpm graph)
├── packages/
│   ├── contracts/           Zod schemas + inferred types (shared api <-> dashboard)
│   ├── db/                  Prisma schema, migrations, generated client
│   ├── logger/              Pino config + redaction rules
│   └── config/              Zod-validated env loading
├── infra/
│   ├── docker-compose.yml   postgres · redis · minio
│   ├── api.Dockerfile
│   ├── worker.Dockerfile
│   └── dashboard.Dockerfile
├── .github/workflows/ci.yml
├── CLAUDE.md
├── PRD.md
├── pnpm-workspace.yaml
├── package.json             scripts only, no deps
├── turbo.json               task graph + caching
└── tsconfig.base.json
```

#### 7.1.2 apps/api

Feature-first, not layer-first. Each module is a vertical slice that can be deleted in one `rm -rf`.

```
apps/api/src/
├── main.ts                  bootstrap · Fastify adapter · Pino · global pipe/filter
├── app.module.ts
├── common/
│   ├── pipes/zod-validation.pipe.ts
│   ├── filters/problem-json.filter.ts          RFC 9457
│   ├── guards/{jwt.guard.ts,roles.guard.ts}
│   ├── decorators/{public,roles,current-user}.decorator.ts
│   └── interceptors/request-id.interceptor.ts
├── modules/
│   ├── auth/                controller · service · strategies · refresh-token.service
│   ├── users/
│   ├── teams/               policy + settings resolution
│   ├── projects/            projects + tasks
│   ├── time-entries/        idempotent upsert on client UUIDv7
│   ├── activity/            batch ingest
│   ├── screenshots/         streaming upload · presign · redact
│   ├── reports/             summaries · CSV export
│   ├── admin/               settings · audit log · erasure
│   └── health/              @nestjs/terminus
└── infra/
    ├── prisma/prisma.service.ts
    ├── storage/minio.service.ts
    └── queue/queue.module.ts                   BullMQ producers only
```

Every module folder follows the same six-file shape:

```
modules/time-entries/
├── time-entries.module.ts
├── time-entries.controller.ts
├── time-entries.service.ts
├── time-entries.repository.ts     Prisma lives here and nowhere else
├── time-entries.service.spec.ts
└── time-entries.e2e-spec.ts
```

The repository layer earns its extra file: it is the seam that lets service tests run without a DB while integration tests hit a real Postgres through the same interface.

#### 7.1.3 apps/worker

```
apps/worker/src/
├── main.ts
├── worker.module.ts
└── processors/
    ├── screenshot-process.processor.ts    thumbnail · blur · mark READY
    ├── rollup-daily.processor.ts
    ├── retention-cleanup.processor.ts     DROP PARTITION (see §10)
    ├── partition-provision.processor.ts   pre-create next month's partition
    └── email/{weekly-summary,missing-timesheet}.processor.ts
```

Separately deployable from the API. A slow thumbnail job must never affect API latency, and the two scale on different axes.

#### 7.1.4 apps/dashboard

```
apps/dashboard/src/
├── app/
│   ├── (auth)/login/
│   ├── (app)/
│   │   ├── layout.tsx
│   │   ├── page.tsx                 team overview
│   │   ├── people/[userId]/         timeline · screenshots · activity
│   │   ├── projects/[projectId]/
│   │   ├── reports/
│   │   ├── approvals/
│   │   ├── me/                      employee self-view — same API, scoped to self
│   │   └── admin/{settings,users,audit}/
│   └── api/auth/[...]/route.ts      session cookie only; never proxies data
├── components/{ui,charts,timeline}/
├── lib/{api-client.ts,session.ts,format.ts}
└── styles/globals.css
```

`lib/api-client.ts` is the only file that knows the API base URL, and it imports its types from `@timetrack/contracts`. No hand-written response interfaces anywhere in this app.

#### 7.1.5 packages

```
packages/contracts/src/
├── auth.ts  users.ts  teams.ts  projects.ts
├── time-entry.ts  activity.ts  screenshot.ts
├── reports.ts  admin.ts
├── enums.ts                  single source for Role / EntrySource / Category
├── team-settings.ts          schema for the Team.settings Json column — parsed on read AND write
└── index.ts

packages/db/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/           includes raw-SQL partition migrations (§7.3)
│   └── seed.ts
└── src/index.ts              re-exports PrismaClient + generated types

packages/logger/src/index.ts  Pino config; redact: authorization, cookie,
                              *.password, *.refreshToken, *.windowTitle
packages/config/src/index.ts  z.object({...}).parse(process.env) — fail fast at boot
```

#### 7.1.6 apps/client-macos

```
apps/client-macos/
├── TimeTrack.xcodeproj
└── Sources/TimeTrack/
    ├── App/            AppDelegate · StatusItemController (the indicator — no kill switch)
    ├── Tracking/       TimeTracker · WorkspaceObserver · IdleMonitor
    ├── Capture/        ScreenshotCapturer (ScreenCaptureKit)
    ├── Activity/       EventCounter (counts only) · Categorizer
    ├── Sync/           SyncEngine · UploadQueue · BackoffPolicy
    ├── Storage/        GRDB buffer — 24h capacity, UUIDv7 keys
    ├── Policy/         PolicyClient · AckGate
    └── UI/             MenuBarView · MyDataView (self-view) · SettingsView
```

`Policy/AckGate` sits between every capture path and the hardware APIs. It is a structural gate, not a runtime `if` scattered across call sites — that is what makes §4.1 ("no monitoring before acknowledgement") enforceable rather than aspirational.

#### 7.1.7 Structural rules (CI-enforced)

- **Import direction is one-way.** `apps/*` may import `packages/*`; never the reverse. `packages/*` do not import each other, except that anything may import `contracts`. Enforced by an ESLint boundary rule in CI — without it this is violated within a month.
- **Prisma is confined** to `*.repository.ts` in the API and `processors/` in the worker. `PrismaClient` in a controller fails review.
- **`packages/contracts` is the only place DTO types are defined.** Types are inferred from Zod schemas, never written alongside them.

### 7.2 API (NestJS 11 + Fastify)

- **Modules:** `AuthModule`, `UsersModule`, `TeamsModule`, `ProjectsModule`, `TimeEntriesModule`, `ActivityModule`, `ScreenshotsModule`, `ReportsModule`, `AdminModule`, `HealthModule`.
- **Validation:** Zod everywhere. A custom `ZodValidationPipe` replaces `class-validator`/`class-transformer` entirely — one schema library, one source of truth. Schemas live in `packages/contracts` and are imported by both the API and the dashboard, so a contract change breaks the build on both sides.
- **Logging:** `nestjs-pino` with `pino-http`. Structured JSON in prod, `pino-pretty` in dev. A `requestId` (from `AsyncLocalStorage`) is on every line. **Redaction is mandatory** — `authorization`, `cookie`, `password`, `refreshToken`, `windowTitle` are redacted at the Pino config level, not per call site.
- **Errors:** global exception filter → RFC 9457 problem+json. Zod errors map to 422 with a field-path map.
- **Config:** `packages/config` parses `process.env` through a Zod schema at boot. Missing/invalid env = fail fast, never a runtime `undefined`.
- **Rate limiting:** `@nestjs/throttler` on auth endpoints and batch ingest.

### 7.3 Data Layer (Prisma 7 + PostgreSQL 18)

- Single Prisma schema in `packages/db`. Migrations via `prisma migrate` — **never** `db push` against anything but a local scratch DB.
- Prisma 7's TypeScript query compiler: no Rust binary, smaller container images, faster cold start.
- High-volume tables (`activity_samples`, `screenshots`) are **partitioned monthly by timestamp** — retention deletion becomes a `DROP PARTITION` instead of a mass `DELETE`, which is the difference between a 200ms job and a vacuum storm.
- Prisma has no native partitioning DSL: partitions are created in raw-SQL migrations, and a monthly worker pre-creates the next partition.
- Connection pooling via PgBouncer (transaction mode) once we exceed one API replica.

### 7.4 Screenshot Pipeline

1. Client POSTs multipart → API streams straight to MinIO (never buffers the full image in Node memory).
2. API writes a `screenshots` row with `storageKey`, `status = PENDING`.
3. BullMQ job: generate thumbnail, apply blur if the team policy demands it, mark `READY`.
4. API returns 201 with the storage key → **only then** does the client delete its local copy.
5. Dashboard fetches via short-lived presigned URLs (5 min TTL). Objects are never publicly readable.

### 7.5 Offline Buffer (Client)

- Local SQLite (GRDB) write-buffer, ≥24h capacity.
- Every record carries a client-generated **UUIDv7** primary key → sync is naturally idempotent; the API upserts on that key, so a retried batch is a no-op rather than a duplicate.
- Background sync every 1–2 min with exponential backoff.
- Sync is one-way (client → server) for captured data. Only policy/config flows server → client. This is what lets us assume single-device-per-user in v1.

### 7.6 Dashboard (Next.js 16)

- App Router, Server Components for data-heavy views; client components only where interaction demands it.
- Server-side fetch to the NestJS API with the session's access token; the browser never talks to the API directly with a long-lived credential.
- Recharts for activity/time visualisation.
- Types come from `packages/contracts` — no hand-written response interfaces, ever.

### 7.7 Data Model (Prisma sketch)

```prisma
enum Role            { EMPLOYEE MANAGER ADMIN }
enum EntrySource     { MANUAL AUTO }
enum Category        { PRODUCTIVE UNPRODUCTIVE NEUTRAL }
enum ShotStatus      { PENDING READY REDACTED }

model User {
  id                String    @id @default(uuid(7))
  email             String    @unique
  name              String
  role              Role      @default(EMPLOYEE)
  passwordHash      String
  monitoringAckAt   DateTime?              // null => monitoring MUST NOT run
  teamId            String
  team              Team      @relation(fields: [teamId], references: [id])
  deactivatedAt     DateTime?
  createdAt         DateTime  @default(now())
  timeEntries       TimeEntry[]
  @@index([teamId, deactivatedAt])
}

model Team {
  id         String  @id @default(uuid(7))
  name       String
  settings   Json                          // validated by TeamSettingsSchema (Zod) on read+write
  users      User[]
  projects   Project[]
}

model Project {
  id       String  @id @default(uuid(7))
  teamId   String
  name     String
  archived Boolean @default(false)
  tasks    Task[]
  team     Team    @relation(fields: [teamId], references: [id])
}

model Task {
  id        String  @id @default(uuid(7))
  projectId String
  name      String
  project   Project @relation(fields: [projectId], references: [id])
}

model TimeEntry {
  id        String      @id                // UUIDv7 minted on the client
  userId    String
  projectId String?
  taskId    String?
  startTime DateTime
  endTime   DateTime?
  source    EntrySource
  note      String?
  editedById String?
  editedAt  DateTime?
  user      User        @relation(fields: [userId], references: [id])
  @@index([userId, startTime])
}

model ActivitySample {              // partitioned monthly on `timestamp`
  id          String   @id
  userId      String
  timestamp   DateTime
  appName     String
  windowTitle String?               // redacted in logs; nullable if team disables titles
  activityPct Int
  category    Category @default(NEUTRAL)
  @@index([userId, timestamp])
}

model Screenshot {                  // partitioned monthly on `timestamp`
  id             String     @id
  userId         String
  timestamp      DateTime
  storageKey     String
  thumbnailKey   String?
  blurred        Boolean    @default(false)
  status         ShotStatus @default(PENDING)
  redactedReason String?
  @@index([userId, timestamp])
}

model IdleEvent {
  id             String   @id
  userId         String
  startTime      DateTime
  endTime        DateTime
  resolvedAction String            // KEPT | DISCARDED | UNRESOLVED
}

model AuditLog {
  id         String   @id @default(uuid(7))
  actorId    String
  action     String
  targetType String
  targetId   String
  diff       Json?
  timestamp  DateTime @default(now())
  @@index([targetType, targetId])
}
```

### 7.8 API Surface (illustrative)

```
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

GET    /policy/effective              -> monitoring config + ack requirement for current user

POST   /time-entries                  (idempotent upsert on client UUIDv7)
PATCH  /time-entries/:id
GET    /time-entries?userId=&from=&to=

POST   /activity-samples/batch        (max 500 per batch)
POST   /screenshots                   (multipart, streamed to MinIO)
POST   /screenshots/:id/redact
GET    /screenshots?userId=&from=&to= (returns presigned URLs, 5 min TTL)

GET    /reports/team-summary?from=&to=
GET    /reports/export.csv?...

GET    /admin/settings
PATCH  /admin/settings
GET    /admin/audit-log
POST   /admin/users/:id/erase
```

`GET` endpoints with `userId` enforce: employees may only pass their own id; managers only their team; admins anyone.

---

### 7.9 As-built refinements (kept in sync with the code)

Where the implementation refines this spec:

- **API is versioned.** Every route in §7.8 is served under `/v1` (e.g. `POST /v1/auth/login`); `/health` and `/health/ready` are version-neutral. A shipped client pins `/v1`, so `/v1` is never broken — breaking changes go to `/v2`.
- **Prisma 7 config.** The DB connection URL lives in `packages/db/prisma.config.ts` (not a `datasource.url` in `schema.prisma`), and the client connects via the `@prisma/adapter-pg` driver adapter. `packages/db` is an **ESM** package; the CJS apps consume it via `require(esm)`.
- **Env schema file** is `packages/config/src/index.ts` (not `env.ts`).
- **`policy` module** implements `/policy/effective` as its own vertical slice.
- **`RefreshToken` model** was added to §7.7's model for rotating, HMAC-hashed refresh tokens (§6.8).
- **Security baseline** in `apps/api/src/main.ts`: `@fastify/helmet`, a `@fastify/cors` origin allowlist (`CORS_ORIGINS`), and strict-body Zod validation (unknown fields rejected). Resource authorization is a reusable `@ResourceScope` decorator + global `ResourceGuard` (`common/authz/`), not per-route logic.
- **Packages build to `dist`** and apps consume the built output (turbo `^build`), not source.
- **Repo tooling:** husky + lint-staged, gitleaks secret scanning, `pnpm audit --prod` + Dependabot in CI, and Developer ID signing/notarization scaffolding for the client (`apps/client-macos/SIGNING.md`).
- **Client offline buffer is file-backed, not SQLite.** PRD §7.5's GRDB is replaced by a hand-rolled, file-backed FIFO (one atomic write-temp-then-rename file per record under Application Support; startup `.tmp` sweep) — no SwiftPM dependency (CLAUDE.md §2). The durable buffer also serves as the upload queue (no separate `UploadQueue` type); the drain loop lives in `SyncEngine`.
- **Client sync covers time-entries and idle-events.** `SyncEngine` drains both kinds from the durable buffer — time-entries to `POST /v1/time-entries`, idle-events to `POST /v1/idle-events` — each idempotent on the client-minted UUIDv7. A time-entry transient/auth failure stops the cycle before the idle pass. `SyncEngine` is not gated by `AckGate` (it transmits the employee's own already-recorded records) and, on sign-out, flushes-then-clears the buffer so a subsequent user cannot upload the prior user's records under their own token. The server stores each idle event as an audit/analytics row; it does **not** reconcile or delete overlapping time entries on a `DISCARDED` event (the client already decided what span to record).
- **Client persists the in-progress span (crash-durability).** The running `TimeTracker` span is written to `Application Support/TimeTrack/live-span.json` with a ~60s heartbeat; on relaunch after an unclean exit the client offers a keep/discard recovery prompt (keep → a completed entry ending at the last heartbeat, original UUIDv7). Recovery is userId-gated: a leftover span belonging to a different user on the same Mac is cleared, never mis-attributed. (The equivalent crash hole for the _buffer_ — a crash bypasses the sign-out clear — remains a separate follow-up.)

---

## 8. Non-Functional Requirements

- **Client performance:** <2% average CPU for the background agent; no measurable battery-life regression in a 4h test.
- **Offline resilience:** ≥24h of local buffering when the backend is unreachable.
- **API latency:** p95 <200ms for dashboard reads at 50 users.
- **Security:** TLS everywhere; data encrypted at rest (Postgres volume + MinIO SSE); backend behind VPN or auth-gated reverse proxy; presigned URLs only, never public buckets.
- **Scalability:** 50 users on a single small VM. API stateless so it can scale horizontally; Postgres, Redis, MinIO external.
- **Observability:** Pino JSON → shipped to whatever log sink the org already runs. `/health` (liveness) and `/health/ready` (Postgres + Redis + MinIO reachability) via `@nestjs/terminus`.

---

## 9. Testing

- **Unit:** Vitest. Business logic in services, no DB.
- **Integration:** Vitest + Testcontainers (real Postgres 18, real Redis). No mocking the ORM — mocked Prisma tests pass while production breaks.
- **Contract:** every Zod schema in `packages/contracts` has round-trip tests.
- **E2E:** Playwright against the dashboard on seeded data.
- **Client:** XCTest for the sync buffer and idle-detection state machine.
- Coverage gate: 80% on `apps/api` and `packages/contracts`. No gate on UI.

---

## 10. Data Retention

- Defaults: screenshots **30 days**, activity samples **90 days**, time entries **indefinite** (payroll record).
- Configurable per team, with a hard admin-side floor to stop anyone setting screenshots to "forever" by accident.
- Nightly BullMQ job drops expired partitions and hard-deletes stragglers. Every run writes an `audit_log` entry with counts.

---

## 11. Rollout Plan

| Phase   | Scope                                                                            |
| ------- | -------------------------------------------------------------------------------- |
| 1 (MVP) | Auth, manual + automatic time tracking, project/task assignment, basic dashboard |
| 2       | Screenshots, activity monitoring, idle alerts, employee self-view (transparency) |
| 3       | Distraction alerts, reporting/CSV exports, approvals workflow                    |
| 4       | SSO (SAML/OIDC), advanced admin controls, retention automation, audit log UI     |

Phase 2 does not ship until the employee self-view ships. Monitoring you can't inspect is the thing the whole category gets sued over.

---

## 12. Success Metrics

- % of team using the app daily without prompting.
- Reduction in missing-timesheet incidents.
- Manager-reported dashboard usefulness (qualitative survey).
- **Employee-reported trust** (anonymous survey). If this tanks, the product has failed regardless of the other three.
- Crash-free sessions >99%.

---

## 13. Open Questions

- Multi-device conflict resolution — deferred; v1 assumes one device per user. UUIDv7 keys mean we _could_ merge later without a data migration.
- SSO timeline: launch or Phase 4?
- Compliance drivers from client contracts (SOC 2, HIPAA)? Affects retention, audit depth, and hosting.
- Do we store `windowTitle` at all, or hash/truncate it? Titles leak document names, ticket subjects, and URLs — arguably the most sensitive field in the schema. Recommend: per-team opt-out, default **on** but truncated to 120 chars.
