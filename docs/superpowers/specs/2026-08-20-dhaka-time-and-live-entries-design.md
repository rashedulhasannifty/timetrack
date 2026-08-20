# Design — Dhaka day boundaries, live in-progress entries, and sticky project selection

Date: 2026-08-20
Status: approved (pending spec review)

## 1. Problem

Four reported issues, three of them real defects and one already built.

**(a) The product shows the wrong day.** Every day boundary in the system is UTC. The org operates in
Dhaka (UTC+6), so "today" on the dashboard runs from 06:00 Dhaka to 06:00 Dhaka. Work done between
midnight and 6am lands on the previous calendar day; work done in the evening is correct only by
accident. This is wrong in three layers:

- **Dashboard** — scattered `.toISOString().slice(0, 10)` and `slice(11, 16)` calls derive both the
  day key and the displayed clock time in UTC: `lib/format.ts:11,14-20`,
  `components/day/DayHeader.tsx:11,50`, `lib/person-day-view.ts:96,100,217,460`,
  `lib/reports-view.ts:7`, `app/(app)/me/page.tsx:101`.
- **API** — day series are generated with an explicit `AT TIME ZONE 'UTC'` pin:
  `modules/reports/reports.repository.ts:253-254,264,272-279,337`,
  `modules/projects/projects.repository.ts:161`, `modules/activity/activity.repository.ts:80-82`, and the
  default date in `modules/reports/reports.service.ts:42`.
- **Worker** — `processors/rollup-daily.processor.ts` buckets `activity_samples` into the **stored**
  `ActivityDailySummary.day` column (`schema.prisma:204`, `@db.Date`) using `previousUtcDay()`. Unlike
  the other two layers this is materialised, so historical rows are misaligned by six hours and cannot
  be fixed by changing a query.

**(b) Time does not appear until the timer is stopped.** While tracking, screenshots stream to the
dashboard but the time entry does not, so the day view looks empty while the user is visibly working.
The cause is entirely client-side: `Tracking/TimeTracker.swift` enqueues to the buffer **only** from
`close(at:)`, so the server never learns about a span until Stop. The server side is already built for
this — `CreateTimeEntrySchema.endTime` is `.nullable()`, `findActiveByUser` exists
(`time-entries.repository.ts:87-94`), `person-day-view.ts:297` already derives `recordingNow` from an
open entry, and migration `20260712104238_add_running_entry_partial_unique_index` already enforces one
open entry per user with `upsert` mapping its `P2002` to a 409.

**(c) Shutting the Mac down mid-tracking.** Already handled. `Storage/LiveSpanStore.swift` persists the
in-progress span to `live-span.json`, `AppDelegate.swift:195` bumps its `lastAlive` heartbeat, and
`recoverLiveSpanIfNeeded` (`AppDelegate.swift:360`) shows `RecoveryView` on the next launch, closing
the span at the last heartbeat so downtime is never counted. The only defect is that **Discard is the
default action**, so pressing Enter throws away real work.

**(d) The project has to be re-picked every day.** `App/MenuViewModel.swift` holds `selectedChoice` in
memory only; nothing persists it. Every relaunch starts from no selection.

Items (b) and (c) interact, and that interaction is the main risk in this design — see §4.

## 2. Goals / non-goals

**Goals**

- A "day" means a **Dhaka** day everywhere a day is derived: dashboard labels and navigation, API day
  series, and the worker's stored daily rollup — with existing rollup rows rebuilt.
- An in-progress entry is visible on the dashboard while it is running, and its duration stops growing
  shortly after the client stops heartbeating.
- Recovery after an interrupted span defaults to keeping the time.
- The last project/task selection is restored on launch, per user, without pre-selecting a project the
  user can no longer access.

**Non-goals**

- **No per-user timezone.** `Asia/Dhaka` is a single org-wide constant. A per-user zone would mean the
  rollup can no longer store one row per user-day, which is a much larger change.
- **No change to the Overview `tracking` flag.** That flag already requires a fresh activity-sample
  heartbeat (design `2026-08-03-tracking-now-heartbeat-recency-design.md`). This slice does not touch
  its derivation. It _does_ close that design's §7 follow-up for `recordingNow` — see §4.3.
- **No `/v1` contract change.** `heartbeatAt` is stamped server-side; no request or response shape
  changes, so already-shipped Mac clients keep working unchanged.
- **No change to the macOS client's own day math.** `DailyTotalAccumulator`,
  `DailyDistractionAccumulator`, and `EndOfDayScheduler` all use `Calendar.current`, which on a Dhaka
  Mac is already UTC+6.

## 3. Dhaka day boundaries

### 3.1 One shared constant

`apps/dashboard` depends only on `@timetrack/contracts` (its `package.json` lists no other workspace
package), and CLAUDE.md §3 names contracts as the one package anything may import. So the constant and
its pure helpers live in **`packages/contracts/src/time.ts`**:

```ts
export const APP_TIMEZONE = 'Asia/Dhaka';

/** 'YYYY-MM-DD' Dhaka calendar day containing `instant`. */
export function dayOf(instant: Date): string;

/** The UTC instant at which a Dhaka calendar day begins. */
export function dayStartInstant(day: string): Date;

/** Shift a 'YYYY-MM-DD' Dhaka day by `days` (may be negative). */
export function shiftDay(day: string, days: number): string;

/** 'HH:MM' Dhaka wall-clock time for `instant`. */
export function clockOf(instant: Date): string;
```

These are implemented with `Intl.DateTimeFormat` against `APP_TIMEZONE` rather than a fixed `+06:00`
offset, so the code stays correct if the constant is ever changed to a zone that observes DST.
Bangladesh does not currently observe DST, so no fold/gap handling is required today; the helpers are
nonetheless written to derive the offset from the zone rather than assume six hours.

**Both sides import these. Neither redefines a boundary.**

### 3.2 Dashboard

Replace every ad-hoc UTC slice with the shared helpers:

| File                                    | Current                                                | Becomes                       |
| --------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| `lib/format.ts:11`                      | `new Date(iso).toISOString().slice(0,10)`              | `dayOf(new Date(iso))`        |
| `lib/format.ts:14-20`                   | `slice(11,16)` on the ISO string                       | `clockOf(...)`                |
| `components/day/DayHeader.tsx:8-12`     | `shiftDateUTC`                                         | `shiftDay`                    |
| `components/day/DayHeader.tsx:14-22`    | `toLocaleDateString(..., { timeZone: 'UTC' })`         | `timeZone: APP_TIMEZONE`      |
| `components/day/DayHeader.tsx:50`       | `new Date().toISOString().slice(0,10)`                 | `dayOf(new Date())`           |
| `lib/person-day-view.ts:96,100,217,460` | UTC slices for day parsing / `isToday` / bucketing     | shared helpers                |
| `lib/reports-view.ts:7`                 | `` `${now.toISOString().slice(0,10)}T00:00:00.000Z` `` | `dayStartInstant(dayOf(now))` |
| `app/(app)/me/page.tsx:101`             | `new Date().toISOString().slice(0,10)`                 | `dayOf(new Date())`           |

Note that `person-day-view.ts:96` currently _validates_ a `?date=` query param by round-tripping it
through `toISOString().slice(0,10)`; that check must be rewritten against `dayOf`/`dayStartInstant` or
it will start rejecting valid Dhaka days.

`DayHeader` renders on the server, so `dayOf(new Date())` is evaluated against the server clock — which
is exactly right, because the day boundary is an org property, not a viewer property.

### 3.3 API

The `from`/`to` window parameters are ISO **instants** and the `GREATEST`/`LEAST` clamping in
`reports.repository.ts` is instant-based, so most of the SQL is unaffected. What changes is every place
a **day** is derived from an instant, or an instant from a day:

- `reports.service.ts:42` — `new Date().toISOString().slice(0, 10)` → `dayOf(new Date())`.
- `reports.repository.ts:253-256` — the `generate_series` bounds and `::date` cast.
- `reports.repository.ts:264,272-279` — the trends join, where `(d.day::timestamp) AT TIME ZONE 'UTC'`
  converts a day back to an instant for the entry-overlap clamp.
- `reports.repository.ts:337` — the idle series, built the same way.
- `projects.repository.ts:161` — `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD')`.
- `activity.repository.ts:80-82` — the `day: { gte, lte }` range filter compares a `@db.Date`
  column against raw instants; convert each bound to a Dhaka day label first. (`:89`,
  `r.day.toISOString().slice(0, 10)`, correctly reads a UTC-midnight day label back off that
  column — Prisma hands a `@db.Date` back as UTC midnight of the stored label — and must be
  left alone.)

**Implementation care required.** In Postgres, `AT TIME ZONE` is direction-dependent:
`timestamptz AT TIME ZONE 'zone'` yields a `timestamp` (wall clock in that zone), while
`timestamp AT TIME ZONE 'zone'` yields a `timestamptz`. The existing SQL uses **both** directions —
`:253` converts instant→day, `:272` converts day→instant. Swapping the literal `'UTC'` for
`'Asia/Dhaka'` is correct in both cases, but each site must be read to confirm which direction it is
before it is changed. Each converted query gets a Testcontainers assertion on a boundary instant
to prove the bucket moved. Use the pair 23:30 and 00:30 Dhaka on consecutive Dhaka days: 23:30 Dhaka
is 17:30 UTC the **same** date, while 00:30 Dhaka is 18:30 UTC the **previous** date. They are two
different Dhaka days but the same UTC day, which is precisely the case today's code gets wrong.

### 3.4 Worker rollup — the migration

`rollup-daily.processor.ts` changes `previousUtcDay()` to the previous **Dhaka** day, and its window
from `[dayStart, dayStart + 1 UTC day)` to the UTC instants bracketing that Dhaka day
(`dayStartInstant(day)` to `dayStartInstant(shiftDay(day, 1))`). The stored
`ActivityDailySummary.day` value becomes the Dhaka day.

Existing rows are misaligned by six hours. Because the processor already accepts `job.data.day`
(`rollup-daily.processor.ts:34-35`), the backfill is **not** a hand-written SQL data migration — it is
a script that enqueues one rollup job per Dhaka day across the retained range, each of which
recomputes and upserts (`:47-50`) from the surviving `activity_samples`.

**Known and accepted limit.** `retention-cleanup.processor.ts` purges `activity_samples` per team
retention policy, and the table is monthly-partitioned with a finite set of partitions. Any day whose
samples have already been purged **cannot** be re-bucketed; those `ActivityDailySummary` rows keep
their UTC-shaped numbers. The backfill script must therefore discover the real boundary at run time
rather than assume one:

1. Determine the oldest surviving `activity_samples.timestamp`.
2. Rebuild only from the Dhaka day containing it forward.
3. **Log and report the exact date from which the rollup data is trustworthy**, so nobody reads older
   activity figures as if they were Dhaka-aligned.

Time entries are _not_ affected by this limit — they are stored as instants and re-bucketed at query
time, so entry durations and day totals are correct for all history immediately.

**Ordering.** The processor change and the backfill run together; deploying the processor without the
backfill leaves a six-hour seam between old and new rows.

## 4. Live in-progress entries

### 4.1 Client — publish the open entry out of band

`TimeEntryPayload.endTime` becomes `String?`. Because `CreateTimeEntrySchema.endTime` is `.nullable()`
and _not_ `.optional()`, Swift's synthesised `Codable` omission of a nil optional would produce a 422;
the field therefore needs the same explicit `encodeNil` treatment already applied to `projectId` and
`taskId` in the same `encode(to:)` (`TimeTracker.swift`).

The open entry **must not** go through `BufferStore`. `BufferStore.enqueue` (`BufferStore.swift:37-48`)
names files `{millis}__{kind}__{id}.json`; its defensive `removeItem(at: dst)` only collides on an
identical millisecond, so enqueueing the same entry id twice leaves **two** records. A stale
"still open" payload draining _after_ the close payload would then null out a real `endTime` and wedge
the entry as permanently running.

Instead, `TimeTracker.open(_:source:)` publishes the open entry with a direct POST, and the existing
heartbeat at `AppDelegate.swift:195` re-POSTs it on each tick alongside `liveSpanStore.heartbeat`.
Failures are ignored: the authoritative record is still the closed entry enqueued by `close(at:)`
through the buffer, exactly as today, so **offline correctness is unchanged**. A live view is a
best-effort nicety; the durable record is not.

Two client-side responses to server status:

- **409 (`runningConflict`)** — a stranded open row already exists for this user. Treated as
  non-fatal: tracking continues locally and the closed entry will still upsert correctly on Stop. §4.4
  removes the cause.
- **401** — routed through the existing `AuthSession` refresh-and-retry-once path, as
  `TimeEntryUploader` already does.

### 4.2 API — monotone close and a server-stamped heartbeat

Two changes to `upsert` (`time-entries.repository.ts:46-72`):

1. **Stamp `heartbeatAt: new Date()`** on both the create and update branches. This is derived
   server-side from write arrival, so **no contract change** — `/v1` is untouched and shipped clients
   need no update. New nullable column `heartbeatAt DateTime?` on `TimeEntry` plus a migration.
2. **Make the close monotone.** The update branch currently reads
   `endTime: dto.endTime ? new Date(dto.endTime) : null`, which lets a late open-payload **re-open** a
   closed entry. Change it to leave a set `endTime` alone when the incoming payload has none.
   Corrections continue to go through the audited `PATCH` path (`repository.update`), which is where
   they belong.

Per `prisma-migrate-dev-needs-tty`, the migration is hand-authored as `migration.sql` and applied with
`db:deploy` + `db:generate` + a rebuild of `packages/db`, since `prisma migrate dev` cannot run
non-interactively in this harness.

### 4.3 The staleness guard — ships in the same change

Without this, §4.1 is a **regression**: an open row on the server plus
`COALESCE(te."endTime", now())` means a powered-off Mac's day total grows without bound and its
"Recording now" pill stays lit forever. That expression appears at `reports.repository.ts:272,279,487`
and `approvals.repository.ts:28`.

**The sweep is not uniform.** The discriminating question per site is _what bounds the open end_:

| Site                                         | Open end bounded by                                 | Clamp?                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `reports.repository.ts:272,279` (trends)     | `now()` — the current day is open-ended             | **Yes**                                                                                                                                       |
| `reports.repository.ts:487` (CSV / timeline) | `LEAST(..., ${to})`, a report range the user chose  | **Yes** — for a range ending now it is the same live case, and for a past range it correctly stops a stranded entry from inflating the export |
| `person-day-view.ts:297` (`recordingNow`)    | nothing — any open entry lights the pill            | **Yes**                                                                                                                                       |
| `approvals.repository.ts:28`                 | `LEAST(..., ${toCol})`, the **approval period end** | **No — excluded, see below**                                                                                                                  |

**Approvals is deliberately excluded.** `CLAMPED_SECONDS` backs `trackedSeconds` on a submitted
timesheet — a number a manager reads when approving, and has often already approved. Applying the
clamp would retroactively reduce the total for any period containing a stranded open entry, so the
same submitted period would compute differently before and after this migration. That a stranded
entry currently inflates an approval total is a real and separate defect; correcting it means deciding
what happens to already-decided approvals (the model has a stored `totalSeconds` alongside the live
`trackedSeconds`, so a snapshot may already exist for decided rows). **That decision is out of scope
here and is recorded as follow-up §10.1.** This slice must not change a number a manager has signed.

The remaining sites clamp the open end to the last heartbeat plus the freshness window:

```sql
COALESCE(
  te."endTime",
  LEAST(now(), COALESCE(te."heartbeatAt", te."startTime") + make_interval(secs => $freshness))
)
```

`$freshness` is the existing `TRACKING_FRESHNESS_SECONDS` (`packages/config/src/index.ts:76`, default
300, already injected into `reports.service.ts:38` via `reports.tokens.ts`). **No second liveness
signal is introduced.**

The inner `COALESCE` handles rows predating the migration, which have a null `heartbeatAt`: they fall
back to `startTime`, so a legacy stranded entry contributes at most the freshness window rather than
`now() - startTime`. Note the consequence for a _live_ entry — its duration is reported as at most
`heartbeatAt + freshness`, i.e. it can read up to five minutes ahead of real elapsed time between
heartbeats. `LEAST(now(), ...)` caps that, so the overshoot only ever appears on a genuinely stale
entry, never on a running one.

`recordingNow` (`person-day-view.ts:297`) gains the same freshness condition, closing the follow-up
explicitly deferred in §7 of `2026-08-03-tracking-now-heartbeat-recency-design.md`.

### 4.4 Recovery must close the server row

Once §4.1 ships, the local `live-span.json` is no longer the only record of an interrupted span — there
is a matching open row on the server. `recoverLiveSpanIfNeeded` must therefore resolve **both**:

- **Keep** — unchanged in effect. The recovered entry is enqueued with the same `LiveSpan.entryId`
  (the original UUIDv7), so the upsert takes the update branch and closes the existing row. No second
  row, no double count.
- **Discard** — currently clears `live-span.json` only, which would leave the server row open
  **forever**, and the partial unique index would then 409 every subsequent Start. Discard therefore
  POSTs the same id with `endTime == startTime`, closing it as a zero-duration entry through the normal
  path. This does release the unique-index slot, since that index is `WHERE "endTime" IS NULL`.

A zero-duration row is a **new row shape**, and hiding it is a **repository-level concern, not a view
one** — filtering it in the day view alone would leave it visible in the CSV export
(`reports.repository.ts:482-488`) and countable in the trends join (`:272-279`). The predicate
`te."endTime" IS NULL OR te."endTime" > te."startTime"` is therefore added to the entry-selecting
queries in `time-entries.repository.ts` (`list`), `reports.repository.ts` (trends, CSV stream), and
`projects.repository.ts:161`. Durations are unaffected either way — a zero-length span sums to zero —
so this is about not showing the user a phantom 0m row, and the tests assert it in the export as well
as the day view.

The considered alternative was a new audited `DELETE /v1/time-entries/:id`. It is semantically cleaner
— a discarded span arguably should not exist — but it is a new endpoint with its own guard, its own
`AuditLog` write, and its own 403 test, for a row that already contributes nothing. Rejected as
disproportionate; revisit if zero-duration rows prove a nuisance elsewhere.

## 5. Shutdown default

In `UI/RecoveryView.swift`, `.keyboardShortcut(.defaultAction)` moves from the Discard button to Keep.
Discard remains available and remains the result of dismissing the window, so the existing
`windowWillClose → resolve(.discard)` safety path and `dismissIfShowing()` sign-out behaviour
(`client-signout-prompt-window-leak`) are untouched.

No `applicationWillTerminate` handler is added. A graceful shutdown continues to route through the same
recovery prompt as a crash — one prompt, defaulting to the right answer — rather than introducing a
second close path that could race the recovery flow.

## 6. Sticky project selection

**Local cache, server fallback.**

`MenuViewModel` persists `{projectId, taskId}` to `UserDefaults` on every selection change, under a key
**namespaced by userId**. `MenuViewModel.reset()`, called on sign-out, clears the in-memory selection
and the current user id so a user cannot inherit another user's wrong-team project — but it
deliberately leaves the persisted, per-user key alone. Clearing it on every sign-out would defeat the
feature for anyone who signs out at the end of the day; per-user namespacing is what makes it safe to
keep, without reopening the cross-user leak `reset()` exists to close.

On launch, in order:

1. Read the persisted choice for the signed-in user.
2. If absent (fresh install, new user), fall back to the project on the user's most recent entry via
   the existing `GET /v1/time-entries` — **no new endpoint**. This is best-effort and non-blocking; a
   failure simply leaves nothing pre-selected.
3. **Validate before applying.** The restored `{projectId, taskId}` is matched against the refreshed
   `ProjectCache` choices. If the project or task is gone — archived, or access removed — the
   selection is dropped and the persisted key cleared. Without this the app pre-selects a project the
   user can no longer use and every Start fails server-side.

Step 3 means the restore is applied _after_ the project refresh completes, not at construction time.

## 7. Testing

| Area                           | Level                                                                         | Case                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/time.ts`            | Vitest unit                                                                   | `dayOf`/`dayStartInstant`/`shiftDay`/`clockOf` across a Dhaka midnight; 23:30 and 00:30 Dhaka map to different days despite the same UTC day                                    |
| Dashboard view models          | Vitest unit (node env — no jsdom, per `dashboard-vitest-node-and-tabbed-ssr`) | `person-day-view` buckets a 00:30-Dhaka entry onto the correct day; `?date=` validation accepts a valid Dhaka day                                                               |
| Reports SQL                    | Testcontainers                                                                | An entry at 18:30 UTC lands on the _next_ Dhaka day in trends; idle series likewise                                                                                             |
| Rollup                         | Testcontainers                                                                | Samples either side of Dhaka midnight land in the right `ActivityDailySummary.day` (timestamps inside the seeded partition months, per `partitioned-table-e2e-timestamp-range`) |
| Staleness clamp                | Testcontainers                                                                | **Regression, fails without the fix**: an open entry with `heartbeatAt` 1 hour stale reports a bounded duration, and `recordingNow` is false                                    |
| Monotone close                 | Testcontainers                                                                | **Regression, fails without the fix**: POST close, then POST the same id with `endTime: null` → `endTime` survives                                                              |
| Discard path                   | Testcontainers                                                                | A zero-duration entry contributes 0 and does not block a subsequent open (no 409)                                                                                               |
| Zero-duration filter           | Testcontainers                                                                | A discarded (zero-duration) entry appears in neither the day list nor the CSV export, and the approvals total is unchanged by this slice                                        |
| Open-entry POST classification | Swift unit                                                                    | 429 and 503 classify as transient (ignored, tracking continues); tracking never stops on an upload failure                                                                      |
| `TimeEntryPayload`             | Swift unit                                                                    | `endTime: nil` encodes as explicit `null`, not an omitted key                                                                                                                   |
| Selection restore              | Swift unit                                                                    | A persisted choice absent from the refreshed `ProjectCache` is dropped and its key cleared; a choice for user A is not restored for user B                                      |

Swift tests run with `DEVELOPER_DIR` pointed at Xcode (`client-macos-swift-test-developer-dir`), and
qualify `TimeTrack.Category` where relevant (`client-test-category-objc-ambiguity`).

Gate before claiming done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus
`test:coverage` with `RUN_E2E=1` for the API 80% gate (`api-coverage-gate`), plus `swift build` and
`swift test` for the client. Prettier is scoped to the touched apps, since `format:check` already fails
on unrelated files on main (`repo-format-is-not-clean-on-main`).

## 8. Commits

One logical change each, per CLAUDE.md §6:

1. `feat(contracts): add Asia/Dhaka day helpers` — the constant, helpers, and their unit tests.
2. `feat(dashboard): render days and times in Asia/Dhaka` — the call-site sweep.
3. `feat(api): bucket day series in Asia/Dhaka` — the SQL direction changes.
4. `feat(worker): roll up activity on Dhaka days` — processor plus the backfill script.
5. `feat(db): add heartbeatAt to time entries` — schema plus hand-authored migration.
6. `fix(api): clamp open entries to the last heartbeat` — the staleness guard and the monotone close,
   with their regression tests.
7. `feat(client): publish the in-progress entry while tracking` — nullable `endTime`, the direct POST,
   the heartbeat re-POST.
8. `fix(api): hide zero-duration entries from lists and exports` — the §4.4 repository predicate.
9. `fix(client): close the server row when recovery is discarded` — the §4.4 Discard path.
10. `fix(client): default interrupted-time recovery to Keep` — the one-line shortcut move.
11. `feat(client): remember the last project selection` — persistence, fallback, validation.

Commits 5 and 6 must land **before or with** 7; shipping 7 alone is the unbounded-duration regression
described in §4.3. Commit 8 must land before or with 9, which is what first creates a zero-duration row.

## 9. Risks

- **The `AT TIME ZONE` direction trap (§3.3).** The single most likely source of a subtle wrong-day
  bug. Mitigated by reading each site before changing it and asserting on boundary instants rather
  than mid-day ones.
- **Backfill coverage (§3.4).** Purged samples mean some historical activity rollups stay UTC-shaped.
  Accepted; mitigated by reporting the trustworthy-from date rather than leaving it implicit.
- **Live entries widen the write path.** The heartbeat timer is **60 seconds**
  (`AppDelegate.swift:192`, `Timer(timeInterval: 60, repeats: true)`) and its body already early-returns
  unless `timeTracker.isRunning`. The open-entry re-POST rides that same tick, so the added load is
  **at most one request per minute per actively-tracking client** — well inside the API's 100/60s
  throttler (`client-sync-throttler-retry`). **Do not shorten the heartbeat to make the UI feel
  smoother**; the dashboard renders elapsed time from `startTime`, so a faster POST buys nothing.
  A 429 or 5xx on the open-entry POST is classified **transient and ignored** — never `permanent`, and
  never a reason to stop tracking. This is the classification that has been got wrong twice
  (`client-uploader-classify-2xx`, `client-sync-throttler-retry`), so it gets an explicit unit test.
- **Zero-duration entries (§4.4)** are a new row shape, filtered at the repository layer so no consumer
  has to remember to.

## 10. Follow-ups (explicitly out of scope)

**10.1 Stranded open entries inflate approval totals.** `approvals.repository.ts:28` counts an open
entry from `startTime` to the period end. The staleness clamp would fix it but would also change
totals on already-decided approvals (§4.3). Deciding that — clamp only `PENDING` rows, snapshot
`totalSeconds` at submission, or accept the change — needs a product call and its own slice.
