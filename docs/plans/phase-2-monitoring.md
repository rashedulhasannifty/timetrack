# Phase 2 — Monitoring + transparency

**Goal:** periodic screenshots, activity monitoring (activity %), and idle/focus nudges — **shipped together with the employee self-view.** Capture is off-limits without acknowledgement and without symmetric transparency.

**PRD:** §6.2 (screenshots), §6.3 (activity), §6.4 (idle/distraction), §4.3 (symmetric transparency), §7.4 (screenshot pipeline), §11 (Phase 2 gate).

**Hard gate (PRD §11):** _Phase 2 does not ship until the employee self-view ships._ Slice 2.1 is a prerequisite for releasing 2.2/2.3 — plan the release so they land in the same version.

**Exit criteria:** an employee can browse every screenshot, activity sample, and idle event recorded about them via the same API a manager uses (scoped to self); screenshots capture → upload → thumbnail/blur → presigned view works; activity % rolls up daily; idle nudges are local.

---

## Slice 2.1 — Employee self-view (transparency) — **ships with capture**

**Goal:** the `/me` surface where an employee sees everything recorded about them.

**Steps:**

1. **API:** ensure every read endpoint accepts `self` scope. `screenshots.list`, `activity` reads, `time-entries.list`, and a new `GET /idle-events?userId=` all enforce: employee → own id only (the existing `assertCanRead` pattern). Add an `activity` list endpoint (`GET /activity-samples?userId=&from=&to=`) — the scaffold only has ingest.
2. **Contracts:** add `ListActivityQuerySchema`; `ScreenshotSchema` (exists) already carries `url` for presigned reads.
3. **Dashboard — `(app)/me`:** tabs for Timeline, Activity, Screenshots — each fetching the self-scoped API. Reuse `Timeline`; add an activity chart (`ActivityChart` exists) and a screenshot grid (thumbnails via presigned URLs).
4. **Redaction:** employee redact action for screenshots (2.2) surfaced here.
5. **Tests:** the self-scope 403 case for each read (employee cannot pass another `userId`).

**Done when:** an employee opens `/me` and sees their own entries, activity %, screenshots, and idle events — through the same endpoints managers use.

---

## Slice 2.2 — Screenshot capture & pipeline

**Goal:** the end-to-end screenshot path (`PRD §7.4`).

**Steps:**

1. **Client (`Capture/ScreenshotCapturer`):** interval capture via **ScreenCaptureKit** (behind `AckGate`); write the image to the offline buffer with a UUIDv7 key; never delete the local file until upload is confirmed (HTTP 201 + storage key echoed).
2. **API — `POST /screenshots`:** implement the multipart handler — **stream straight to MinIO** (`MinioService.putObject`, never buffer the full image in Node memory); write a `screenshots` row `status = PENDING`; return 201 with the storage key. Wire `StorageModule` + `QueueModule` into `ScreenshotsModule` (currently noted as deferred). **Remove the `src/infra/storage/**` coverage exclusion in `apps/api/vitest.coverage.config.ts`** — it was excluded in the Phase-1 gate as unbuilt; wiring MinIO here means it must fall back under the 80% gate (add the integration tests that cover it).
3. **Worker — `screenshot-process` processor:** implement thumbnail generation + optional blur per `TeamSettings.screenshotBlur` (via `sharp`), upload derivatives to MinIO, mark row `READY`.
4. **API — reads:** `GET /screenshots?userId=&from=&to=` returns rows with **short-lived presigned URLs** (`MinioService.presignGet`, 5-min TTL). `POST /screenshots/:id/redact` — owner-only, marks `REDACTED` + reason, never deletes; surfaces to manager as "redacted by employee: <reason>".
5. **Dashboard:** screenshot grid on `/me` (own) and `people/[userId]` (manager, team-scoped); redact button on `/me`.
6. **Config/redaction:** MinIO env already present; ensure nothing logs raw bytes.
7. **Tests:** integration — upload creates PENDING → worker marks READY; presigned URL returned, never a public URL; redact is owner-only (403 otherwise); the local file deletes only after 201.

**Done when:** screenshots capture on the client, stream to MinIO, get a thumbnail/blur, and are viewable via presigned URLs by the employee and their manager; employees can redact with a reason.

---

## Slice 2.3 — Activity monitoring & rollups

**Goal:** app/window sampling + keyboard/mouse **event counts** → activity %, rolled up daily.

**Steps:**

1. **Client (`Activity/EventCounter`, `Categorizer`):** count key/mouse **events** per interval (never content — `CLAUDE.md §1`); sample active app + window title every N seconds; compute activity % per interval; categorize app/site (`PRODUCTIVE|UNPRODUCTIVE|NEUTRAL`) from the admin list, **client-side**. Respect `TeamSettings.captureWindowTitles` (truncate to 120 chars or omit).
2. **API — ingest:** `POST /activity-samples/batch` is done (idempotent, ≤500). Add the self/manager read endpoint (2.1).
3. **Worker — `rollup-daily` processor:** aggregate the previous day's `activity_samples` per user (avg activity %, minutes per app/category) into a summary table. **Schema:** add `ActivityDailySummary` model + migration. Schedule via a repeatable BullMQ job (add the scheduler in the worker bootstrap).
4. **Dashboard:** activity % chart on `/me` and `people/[userId]`; app/category breakdown.
5. **Redaction:** `windowTitle` is already in the Pino redact list — keep it there; never log it.
6. **Tests:** rollup aggregation correctness; `windowTitle` truncation; category defaults to NEUTRAL.

**Done when:** activity samples flow in, roll up into per-day summaries, and render as activity % and an app breakdown — with window titles handled per policy and never logged.

---

## Slice 2.4 — Idle & focus nudges (local)

**Goal:** local, transparent idle alerts (distraction alerts are Phase 3).

**Steps:**

1. **Client (`Tracking/IdleMonitor` + notifications):** idle threshold (from `TeamSettings.idleThresholdMinutes`) → **local** `UNUserNotification` "Idle for X min — still working?"; "forgot to start tracking" reminder. Keep/discard on resume already handled in Phase 1's 1.7c; here we add the notifications and the end-of-day local summary shell.
2. **API:** `IdleEvent` sync endpoint (if not added in Phase 1) — `POST /idle-events` (self only), read via 2.1.
3. **Tests (XCTest):** notification fires at threshold; no network dependency for the nudge.

**Done when:** idle nudges are delivered locally and transparently; idle events sync and appear in the employee's self-view.

---

## Phase 2 Definition of Done

- [x] 2.1 Self-view live (prerequisite for release). API read endpoints `GET /activity-samples` and `GET /idle-events` added (self/manager/admin via `@ResourceScope` → `ResourceGuard`); `GET /time-entries`/`GET /screenshots` already existed. Dashboard `/me` ships the four-tab transparency surface (Timeline, Activity, Screenshots, Idle), today-UTC, self-scoped. **Deferrals (inherent to the §11 gate — self-view ships before capture):** the Screenshots tab is a working shell with an empty state until 2.2 wires MinIO/presigned URLs; the Activity tab renders raw `activity_samples` until 2.3 adds daily rollups. Live-driven: employee self=200 / cross-user=403, admin(scope)→employee=200, unauth=401; coverage 88.95%/84.11% functions.
- [ ] 2.2 Screenshot pipeline end-to-end (capture → MinIO → thumbnail/blur → presigned → redact).
- [ ] 2.3 Activity monitoring + daily rollups.
- [ ] 2.4 Local idle/focus nudges.
- [ ] Release bundles self-view **with** capture (PRD §11 gate). Green gate; no raw bytes/titles logged; no capture without ack.
