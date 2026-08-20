# Live In-Progress Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a running time entry visible on the dashboard while it is still running, without letting a shut-down Mac's entry grow without bound.

**Architecture:** The macOS client publishes the open entry (`endTime: null`) with a direct POST on Start, re-POSTed by the existing 60-second heartbeat — deliberately **not** through `BufferStore`, whose append-by-filename semantics would let a stale open payload land after the close and re-open the entry. The server stamps a new `heartbeatAt` column on every upsert and refuses to null an `endTime` that is already set. Every duration expression that closes an open entry with `now()` clamps to `heartbeatAt + TRACKING_FRESHNESS_SECONDS`, so a dead client's entry stops growing minutes after its last heartbeat.

**Tech Stack:** Swift 6 / SwiftUI (SPM executable target), NestJS 11 (Fastify), Prisma 7 + PostgreSQL 18, Zod 4, Vitest + Testcontainers, XCTest.

**Spec:** `docs/superpowers/specs/2026-08-20-dhaka-time-and-live-entries-design.md` (§4, §5)

## Global Constraints

- Branch is `feat/dhaka-time-and-live-entries`, already created. Do not commit to `main`.
- **No AI attribution** in any commit message, trailer, author, or branch name (CLAUDE.md §0).
- **This is monitoring software.** No hidden or stealth mode; the menu bar indicator has no kill switch. Never transmit keystroke content. Never bypass `Policy/AckGate` — but note that manual time tracking is deliberately **not** a capture path and correctly does not route through AckGate; readiness is enforced upstream in `MenuViewModel.isReady`. Do not add an AckGate call to the publish path.
- **Never break `/v1`.** A shipped Mac client pins it and cannot be rolled back. `heartbeatAt` is therefore stamped **server-side** with no contract change; do not add it to `CreateTimeEntrySchema`.
- Request bodies are parsed in **strict** mode — an unexpected field is rejected with 422. This is why the client must not start sending a `heartbeatAt` field.
- `PrismaClient` appears only in `*.repository.ts` (api) and `processors/` (worker). Never in a controller or service.
- Deletes on user data must write an `AuditLog` row in the same transaction. (Relevant to the rejected `DELETE` alternative — do not resurrect it.)
- `prisma migrate dev` **cannot run** in this harness (it needs a TTY and aborts non-interactively, even with `--create-only`). Hand-author `migration.sql`, then `pnpm db:deploy`, `pnpm db:generate`, and rebuild `packages/db`.
- `packages/db` is ESM (`"type": "module"`) because Prisma 7's client uses `import.meta`. Leave it that way.
- Swift tests need `DEVELOPER_DIR` pointed at Xcode — CommandLineTools has no XCTest. In `@testable` client tests, a bare `Category` collides with the ObjC runtime type; qualify it as `TimeTrack.Category`.
- Never write `let center = UNUserNotificationCenter.current()` as a stored eager property in client code — it SIGABRTs the whole `swift test` binary. Use `lazy var`.
- Uploader `classify()` must treat **all** 2xx as success. 408/429/5xx are **transient**, never permanent — a permanent classification drops the record and loses data.
- `console.log` is banned outside `scripts/`. Use the injected Pino logger; log objects. Never log `windowTitle`, tokens, or `authorization` headers. Pino reserves the `err` key — log a caught error's message under `reason`.
- Prettier scoped to touched apps only; `format:check` already fails on unrelated files on `main`.

## Hard ordering constraint

**Tasks 1–3 must land before Task 6.** Task 6 is what first puts an open entry on the server. Without the `heartbeatAt` column (Task 1), the stamping and monotone close (Task 2), and the duration clamp (Task 3), a Mac that shuts down mid-tracking leaves a row whose reported duration grows forever and whose "Recording now" pill never goes out. Do not reorder.

**Task 4 must land before Task 7.** Task 7 is what first creates a zero-duration row.

---

### Task 1: Add `heartbeatAt` to time entries

**Files:**

- Modify: `packages/db/prisma/schema.prisma:146-163` (the `TimeEntry` model)
- Create: `packages/db/prisma/migrations/<timestamp>_add_time_entry_heartbeat_at/migration.sql`

**Interfaces:**

- Consumes: nothing.
- Produces: `TimeEntry.heartbeatAt: DateTime?` — nullable, readable from Prisma and from raw SQL as `te."heartbeatAt"`. Null on every pre-existing row; Tasks 2 and 3 must both handle null.

- [ ] **Step 1: Add the column to the schema**

In `packages/db/prisma/schema.prisma`, inside `model TimeEntry`, add after `editedAt`:

```prisma
  /// Server-stamped on every upsert. Drives the staleness clamp: an open entry whose client
  /// has stopped heartbeating stops accruing duration (spec §4.3). Null on rows written before
  /// this column existed — readers fall back to `startTime`.
  heartbeatAt DateTime?
```

- [ ] **Step 2: Hand-author the migration**

`prisma migrate dev` aborts without a TTY in this environment, so write the SQL directly. Create `packages/db/prisma/migrations/20260820120000_add_time_entry_heartbeat_at/migration.sql`:

```sql
-- AlterTable
-- Server-stamped liveness marker for open (endTime IS NULL) entries. Nullable: existing rows
-- have no heartbeat, and readers fall back to "startTime" for those.
ALTER TABLE "time_entries" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
```

Use a timestamp prefix later than the newest existing migration directory. Check with:
`ls packages/db/prisma/migrations | sort | tail -3`

- [ ] **Step 3: Apply the migration and regenerate**

Run: `pnpm db:deploy && pnpm db:generate && pnpm --filter @timetrack/db build`
Expected: migration applied, client regenerated, package built. The build is required — apps consume `dist`.

- [ ] **Step 4: Verify the column exists and Prisma sees it**

Run: `pnpm --filter @timetrack/db exec prisma migrate status`
Expected: "Database schema is up to date!"

Then confirm the generated type carries the field:
Run: `grep -n "heartbeatAt" packages/db/generated/client/models/TimeEntry.ts`
Expected: at least one hit.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): add heartbeatAt to time entries"
```

---

### Task 2: Stamp the heartbeat and make the close monotone

**Files:**

- Modify: `apps/api/src/modules/time-entries/time-entries.repository.ts:46-72`
- Test: `apps/api/src/modules/time-entries/time-entries.e2e-spec.ts`

**Interfaces:**

- Consumes: `TimeEntry.heartbeatAt` (Task 1).
- Produces: `upsert(dto, userId)` keeps its signature. New behaviour: every call stamps `heartbeatAt = now()`, and a payload with `endTime: null` no longer clears a stored `endTime`.

- [ ] **Step 1: Write the failing regression test**

Append to `apps/api/src/modules/time-entries/time-entries.e2e-spec.ts`:

```ts
it('a late open payload cannot re-open a closed entry', async () => {
  const id = '01920000-0000-7000-8000-00000000fb01';
  const body = {
    id,
    projectId: null,
    taskId: null,
    source: 'MANUAL' as const,
    startTime: '2026-08-20T04:00:00.000Z',
  };

  // 1. The client opens the entry.
  const opened = await app.inject({
    method: 'POST',
    url: '/v1/time-entries',
    headers: { authorization: `Bearer ${employeeToken}` },
    payload: { ...body, endTime: null },
  });
  expect(opened.statusCode).toBe(201);

  // 2. The client closes it.
  const closed = await app.inject({
    method: 'POST',
    url: '/v1/time-entries',
    headers: { authorization: `Bearer ${employeeToken}` },
    payload: { ...body, endTime: '2026-08-20T05:00:00.000Z' },
  });
  expect(closed.statusCode).toBe(201);

  // 3. A stale open payload arrives late (retry, slow network, queued heartbeat).
  const stale = await app.inject({
    method: 'POST',
    url: '/v1/time-entries',
    headers: { authorization: `Bearer ${employeeToken}` },
    payload: { ...body, endTime: null },
  });
  expect(stale.statusCode).toBe(201);

  const row = await prisma.timeEntry.findUniqueOrThrow({ where: { id } });
  // Without the fix this is null and the entry is wedged as permanently running.
  expect(row.endTime?.toISOString()).toBe('2026-08-20T05:00:00.000Z');
});

it('stamps heartbeatAt on every upsert', async () => {
  const id = '01920000-0000-7000-8000-00000000fb02';
  const before = new Date();

  await app.inject({
    method: 'POST',
    url: '/v1/time-entries',
    headers: { authorization: `Bearer ${employeeToken}` },
    payload: {
      id,
      projectId: null,
      taskId: null,
      source: 'MANUAL' as const,
      startTime: '2026-08-20T04:00:00.000Z',
      endTime: null,
    },
  });

  const row = await prisma.timeEntry.findUniqueOrThrow({ where: { id } });
  expect(row.heartbeatAt).not.toBeNull();
  expect(row.heartbeatAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- time-entries.e2e-spec`
Expected: FAIL — the first test finds `endTime` is `null`; the second finds `heartbeatAt` is `null`.

- [ ] **Step 3: Rewrite `upsert`**

In `apps/api/src/modules/time-entries/time-entries.repository.ts`, replace the `prisma.timeEntry.upsert` call inside `upsert`:

```ts
const now = new Date();
const row = await this.prisma.timeEntry.upsert({
  where: { id: dto.id },
  create: {
    id: dto.id,
    userId,
    projectId: dto.projectId,
    taskId: dto.taskId,
    source: dto.source,
    note: dto.note ?? null,
    startTime: new Date(dto.startTime),
    endTime: dto.endTime ? new Date(dto.endTime) : null,
    heartbeatAt: now,
  },
  update: {
    // The close is MONOTONE: an open payload arriving after the close (a retry, or a
    // heartbeat queued behind it) must NOT null a stored endTime and re-open the entry.
    // Corrections go through the audited PATCH path, not here.
    ...(dto.endTime ? { endTime: new Date(dto.endTime) } : {}),
    note: dto.note ?? null,
    heartbeatAt: now,
  },
  select: TIME_ENTRY_SELECT,
});
```

Note the conditional spread rather than `endTime: dto.endTime ? ... : undefined` — `exactOptionalPropertyTypes` rejects assigning `undefined` to an optional key.

- [ ] **Step 4: Include `heartbeatAt` in the row projection if the tests need it**

Check whether `TIME_ENTRY_SELECT` needs `heartbeatAt: true`. It does **not** for the API response — `TimeEntrySchema` has no such field and adding one would be a `/v1` change. The tests above read the row through `prisma` directly, so leave `TIME_ENTRY_SELECT` alone. Confirm by running:
`grep -n "TIME_ENTRY_SELECT" -A 15 apps/api/src/modules/time-entries/time-entries.repository.ts | head -20`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- time-entries.e2e-spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/time-entries
git commit -m "fix(api): keep the time-entry close monotone"
```

---

### Task 3: Clamp open entries to the last heartbeat

**Files:**

- Modify: `apps/api/src/modules/reports/reports.repository.ts:272,279,487`
- Modify: `apps/dashboard/src/lib/person-day-view.ts:297`
- Test: `apps/api/src/modules/reports/reports.e2e-spec.ts`
- Test: `apps/dashboard/src/lib/person-day-view.spec.ts`

**Interfaces:**

- Consumes: `TimeEntry.heartbeatAt` (Task 1), `TRACKING_FRESHNESS_SECONDS` (already provided — `apps/api/src/modules/reports/reports.tokens.ts`, injected at `reports.service.ts:38`, sourced from `packages/config/src/index.ts:76`, default 300).
- Produces: no signature changes.

**Which sites get the clamp — this is not a uniform sweep.** The question per site is _what bounds the open end_:

| Site                                       | Open end bounded by             | Clamp?                  |
| ------------------------------------------ | ------------------------------- | ----------------------- |
| `reports.repository.ts:272,279` (trends)   | `now()`                         | **Yes**                 |
| `reports.repository.ts:487` (CSV / stream) | the user's report range `${to}` | **Yes**                 |
| `person-day-view.ts:297` (`recordingNow`)  | nothing                         | **Yes**                 |
| `approvals.repository.ts:28`               | the **approval period** end     | **No — leave it alone** |

**Do not touch `approvals.repository.ts`.** Its `CLAMPED_SECONDS` backs `trackedSeconds` on a submitted timesheet — a number a manager reads when approving and has often already approved. Clamping it would retroactively shrink totals on decided approvals, so the same submitted period would compute differently before and after this deploy. That a stranded entry inflates an approval total is a real, separate defect, recorded as spec §10.1. **This slice must not change a number a manager has signed.**

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/reports/reports.e2e-spec.ts`:

```ts
it('an open entry with a stale heartbeat stops accruing duration', async () => {
  const staleHeartbeat = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
  const startTime = new Date(Date.now() - 90 * 60 * 1000); // 90 minutes ago

  await prisma.timeEntry.create({
    data: {
      id: '01920000-0000-7000-8000-00000000fc01',
      userId: employeeId,
      projectId: null,
      taskId: null,
      source: 'MANUAL',
      startTime,
      endTime: null,
      heartbeatAt: staleHeartbeat,
    },
  });

  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/reports/trends?from=${from}&to=${to}`,
    headers: { authorization: `Bearer ${employeeToken}` },
  });

  expect(res.statusCode).toBe(200);
  const days = res.json() as Array<{ day: string; trackedSeconds: number }>;
  const total = days.reduce((sum, d) => sum + d.trackedSeconds, 0);

  // start -> heartbeat is 30 min, plus the 300s freshness window = 1800 + 300 = 2100s.
  // Without the clamp this is ~5400s and climbing every second the process runs.
  expect(total).toBeGreaterThanOrEqual(2000);
  expect(total).toBeLessThanOrEqual(2200);
});

it('a legacy open entry with no heartbeatAt contributes at most the freshness window', async () => {
  await prisma.timeEntry.create({
    data: {
      id: '01920000-0000-7000-8000-00000000fc02',
      userId: managerId,
      projectId: null,
      taskId: null,
      source: 'MANUAL',
      startTime: new Date(Date.now() - 90 * 60 * 1000),
      endTime: null,
      heartbeatAt: null, // written before the column existed
    },
  });

  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/reports/trends?from=${from}&to=${to}`,
    headers: { authorization: `Bearer ${managerToken}` },
  });

  const days = res.json() as Array<{ day: string; trackedSeconds: number }>;
  const total = days.reduce((sum, d) => sum + d.trackedSeconds, 0);
  expect(total).toBeLessThanOrEqual(400); // falls back to startTime + 300s
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports.e2e-spec`
Expected: FAIL — the totals are ~5400s, unclamped.

- [ ] **Step 3: Add a shared SQL fragment for the open end**

In `apps/api/src/modules/reports/reports.repository.ts`, near the other module-level SQL helpers, add:

```ts
/**
 * The effective end of a time entry. A CLOSED entry ends at its `endTime`. An OPEN entry ends
 * at whichever comes first: now, or its last heartbeat plus the freshness window — so a client
 * that has stopped heartbeating (crash, sleep, shutdown) stops accruing duration instead of
 * growing without bound (spec §4.3).
 *
 * Rows written before `heartbeatAt` existed have null, and fall back to `startTime`.
 *
 * NOTE: deliberately NOT used by `approvals.repository.ts`, whose open end is bounded by the
 * approval period and whose totals a manager may already have signed off (spec §10.1).
 */
const ENTRY_END = (freshnessSeconds: number): Prisma.Sql => Prisma.sql`
  COALESCE(
    te."endTime",
    LEAST(
      now(),
      COALESCE(te."heartbeatAt", te."startTime") + make_interval(secs => ${freshnessSeconds})
    )
  )`;
```

- [ ] **Step 4: Use it in the trends query**

Replace both `COALESCE(te."endTime", now())` occurrences in the `tracked` CTE (`:272` in the `LEAST`, `:279` in the `JOIN ... ON`) with `${ENTRY_END(freshnessSeconds)}`. The repository method must accept `freshnessSeconds` — check whether `trends` already receives it; `overviewForSelf`/`overviewForScope` do (`reports.service.ts:50,55`). If `trends` does not, thread it through from `reports.service.ts` the same way, injecting `TRACKING_FRESHNESS_SECONDS`, **not** by calling `loadEnv()` inside the repository.

- [ ] **Step 5: Use it in the CSV stream query**

Replace `COALESCE(te."endTime", now())` at `:487` with `${ENTRY_END(freshnessSeconds)}`.

Leave the `CASE WHEN te."endTime" IS NULL THEN NULL ... END AS "endTime"` projection at `:483-484` alone — the export should still show an open entry's end as blank, not as a synthesised clamp. Only the computed `durationSeconds` is clamped.

- [ ] **Step 6: Write the failing dashboard test**

`heartbeatAt` is **not** on `TimeEntrySchema` and must not be added (`/v1`), so the dashboard
cannot read it from the entry list. It does not need to: `PersonDayInput` already carries
`samples: ActivitySample[]`, each with a `timestamp`. The newest sample IS the client-liveness
signal — the same one the Overview `tracking` flag already uses. Gate on that.

This also fixes a second, quieter bug in the same expression: `person-day-view.ts:226` computes
`effectiveEnd = endMs ?? (isToday ? nowMs : startMs)`, so an open entry's rendered duration
climbs forever too, not just the pill.

Append to `apps/dashboard/src/lib/person-day-view.spec.ts` (read the file's existing fixture
helper first and match its shape — the input below shows only the fields that matter here):

```ts
describe('open-entry liveness', () => {
  const openEntry = {
    id: 'e1',
    userId: 'u1',
    projectId: null,
    taskId: null,
    startTime: '2026-08-20T08:00:00.000Z',
    endTime: null,
    source: 'MANUAL' as const,
    editedById: null,
    editedAt: null,
  };

  it('is not recording when the newest sample has gone stale', () => {
    const model = buildPersonDayView({
      date: '2026-08-20',
      now: new Date('2026-08-20T10:00:00.000Z'),
      isSelf: true,
      subjectName: 'You',
      entries: [openEntry],
      samples: [sample({ timestamp: '2026-08-20T09:00:00.000Z' })], // an hour old
      screenshots: [],
    });
    expect(model.recordingNow).toBe(false);
  });

  it('is recording while samples keep arriving', () => {
    const model = buildPersonDayView({
      date: '2026-08-20',
      now: new Date('2026-08-20T10:00:00.000Z'),
      isSelf: true,
      subjectName: 'You',
      entries: [openEntry],
      samples: [sample({ timestamp: '2026-08-20T09:59:00.000Z' })],
      screenshots: [],
    });
    expect(model.recordingNow).toBe(true);
  });

  it("stops growing a stale open entry's duration", () => {
    const model = buildPersonDayView({
      date: '2026-08-20',
      now: new Date('2026-08-20T10:00:00.000Z'),
      isSelf: true,
      subjectName: 'You',
      entries: [openEntry],
      samples: [sample({ timestamp: '2026-08-20T09:00:00.000Z' })],
      screenshots: [],
    });
    // 08:00 -> 09:00 heartbeat + 300s freshness = 3900s, NOT the 7200s to `now`.
    expect(model.entryRows[0]?.durationSeconds).toBeLessThanOrEqual(4000);
  });

  it('runs a live entry to now', () => {
    const model = buildPersonDayView({
      date: '2026-08-20',
      now: new Date('2026-08-20T10:00:00.000Z'),
      isSelf: true,
      subjectName: 'You',
      entries: [openEntry],
      samples: [sample({ timestamp: '2026-08-20T09:59:00.000Z' })],
      screenshots: [],
    });
    expect(model.entryRows[0]?.durationSeconds).toBe(7200);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- person-day-view.spec`
Expected: FAIL — `recordingNow` is `true` for the stale case and the stale duration is 7200s.

- [ ] **Step 8: Clamp the open entry in `person-day-view.ts`**

Add the freshness constant near the top of `apps/dashboard/src/lib/person-day-view.ts`:

```ts
/**
 * How long after a client's last activity sample we still consider it live. Mirrors the API's
 * TRACKING_FRESHNESS_SECONDS default (packages/config/src/index.ts:76) and the server-side
 * clamp in reports.repository.ts, so the pill and the duration agree with the reports.
 */
const TRACKING_FRESHNESS_MS = 300_000;
```

Before the `parsed` mapping, derive the liveness horizon once:

```ts
// The client's last provable sign of life today. An open entry cannot accrue past this —
// otherwise a shut-down Mac's entry grows forever and the pill never goes out (spec §4.3).
const newestSampleMs = samples.reduce(
  (max, s) => Math.max(max, Date.parse(s.timestamp)),
  Number.NEGATIVE_INFINITY,
);
const liveHorizonMs = Number.isFinite(newestSampleMs)
  ? newestSampleMs + TRACKING_FRESHNESS_MS
  : Number.NEGATIVE_INFINITY;
const openEndMs = Math.min(nowMs, liveHorizonMs);
```

Then replace `:226`:

```ts
const effectiveEnd = endMs ?? (isToday ? Math.max(startMs, openEndMs) : startMs);
```

`Math.max(startMs, ...)` keeps the duration non-negative when there are no samples at all
(a manual entry with monitoring paused), in which case the entry reads as zero-length rather
than negative.

And replace `:297`:

```ts
// An open entry alone is not proof of life — a crashed or shut-down client leaves one behind.
// Require a recent activity sample too, the same signal the Overview `tracking` flag uses.
const recordingNow = isToday && parsed.some((p) => p.open) && nowMs <= liveHorizonMs;
```

This closes the follow-up deferred in §7 of `2026-08-03-tracking-now-heartbeat-recency-design.md`.

- [ ] **Step 8b: Run both suites to verify they pass**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports.e2e-spec && pnpm --filter @timetrack/dashboard test -- person-day-view.spec`
Expected: PASS.

- [ ] **Step 9: Verify approvals was NOT touched**

Run: `git diff --name-only | grep approvals || echo "approvals untouched — correct"`
Expected: `approvals untouched — correct`. If `approvals.repository.ts` appears in the diff, revert that file.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/reports apps/dashboard/src packages/contracts
git commit -m "fix(api): clamp open entries to the last heartbeat"
```

---

### Task 4: Hide zero-duration entries at the repository layer

**Files:**

- Modify: `apps/api/src/modules/time-entries/time-entries.repository.ts` (the `list` query)
- Modify: `apps/api/src/modules/reports/reports.repository.ts` (trends join, CSV stream)
- Modify: `apps/api/src/modules/projects/projects.repository.ts:161` (the per-project day query)
- Test: `apps/api/src/modules/time-entries/time-entries.e2e-spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: no signature changes. Entries where `endTime == startTime` stop appearing in lists and exports. Durations are unaffected — a zero-length span already sums to zero.

**Why the repository and not the view.** Task 7's Discard path creates zero-duration rows. Filtering them in the day view alone would leave them visible in the CSV export and countable in the trends join — a bug that looks correct in a UI test and is wrong in the artifact a manager downloads.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/time-entries/time-entries.e2e-spec.ts`:

```ts
it('a zero-duration entry is hidden from the list and does not block a new open entry', async () => {
  const discardedId = '01920000-0000-7000-8000-00000000fd01';
  const at = '2026-08-20T04:00:00.000Z';

  // A discarded recovery span: closed at its own start.
  await app.inject({
    method: 'POST',
    url: '/v1/time-entries',
    headers: { authorization: `Bearer ${employeeToken}` },
    payload: {
      id: discardedId,
      projectId: null,
      taskId: null,
      source: 'MANUAL' as const,
      startTime: at,
      endTime: at,
    },
  });

  const listed = await app.inject({
    method: 'GET',
    url: `/v1/time-entries?from=2026-08-19T00:00:00.000Z&to=2026-08-21T00:00:00.000Z`,
    headers: { authorization: `Bearer ${employeeToken}` },
  });
  const ids = (listed.json() as Array<{ id: string }>).map((e) => e.id);
  expect(ids).not.toContain(discardedId);

  // It released the one-open-entry index slot, so a new entry can be opened.
  const opened = await app.inject({
    method: 'POST',
    url: '/v1/time-entries',
    headers: { authorization: `Bearer ${employeeToken}` },
    payload: {
      id: '01920000-0000-7000-8000-00000000fd02',
      projectId: null,
      taskId: null,
      source: 'MANUAL' as const,
      startTime: '2026-08-20T05:00:00.000Z',
      endTime: null,
    },
  });
  expect(opened.statusCode).toBe(201);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- time-entries.e2e-spec`
Expected: FAIL — the discarded id appears in the list.

- [ ] **Step 3: Filter in the entry list**

In `apps/api/src/modules/time-entries/time-entries.repository.ts`, in `list`, add to the `where`:

```ts
// A zero-duration row is a discarded recovery span (spec §4.4) — never shown.
NOT: { endTime: { equals: this.prisma.timeEntry.fields.startTime } },
```

If Prisma's field-reference comparison is unavailable for this shape, use the equivalent raw predicate the other queries use. Verify by running the test; do not guess.

- [ ] **Step 4: Filter in the reports queries**

Add to the `JOIN time_entries te ... ON` clause of the trends `tracked` CTE and to the CSV stream's `WHERE`:

```sql
AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
```

Add the same predicate to the per-project day query in `apps/api/src/modules/projects/projects.repository.ts:161`.

- [ ] **Step 5: Run it to verify it passes**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- time-entries.e2e-spec reports.e2e-spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "fix(api): hide zero-duration entries from lists and exports"
```

---

### Task 5: Make the client's `endTime` nullable on the wire

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/Sync/TimeEntryPayload.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/Tracking/TimeTracker.swift` (remove the private payload struct, use the shared one)
- Test: `apps/client-macos/Tests/TimeTrackTests/TimeEntryPayloadTests.swift`

**Interfaces:**

- Consumes: nothing.
- Produces: `struct TimeEntryPayload: Encodable` — `internal`, with `endTime: String?`, and a static `make(id:projectId:taskId:start:end:source:note:)` factory. Task 6 and Task 7 both encode it.

**Why this must be explicit.** `CreateTimeEntrySchema.endTime` is `.nullable()`, **not** `.optional()`. Swift's synthesised `Codable` **omits** a nil `Optional` rather than emitting `null`, so a nil `endTime` would produce a body missing the key, and the strict-mode Zod pipe would reject it with 422. `projectId` and `taskId` already carry `encodeNil` for exactly this reason — follow that pattern.

- [ ] **Step 1: Write the failing test**

Create `apps/client-macos/Tests/TimeTrackTests/TimeEntryPayloadTests.swift`:

```swift
import XCTest
@testable import TimeTrack

final class TimeEntryPayloadTests: XCTestCase {
    private func encoded(_ payload: TimeEntryPayload) throws -> [String: Any] {
        let data = try JSONEncoder().encode(payload)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testOpenEntryEmitsExplicitNullEndTime() throws {
        let json = try encoded(TimeEntryPayload(
            id: "01920000-0000-7000-8000-000000000001",
            projectId: nil, taskId: nil,
            startTime: "2026-08-20T04:00:00Z",
            endTime: nil,
            source: "MANUAL",
            note: nil
        ))
        // The server schema is .nullable(), NOT .optional() — an omitted key is a 422.
        XCTAssertTrue(json.keys.contains("endTime"))
        XCTAssertTrue(json["endTime"] is NSNull)
    }

    func testClosedEntryEmitsTheEndTime() throws {
        let json = try encoded(TimeEntryPayload(
            id: "01920000-0000-7000-8000-000000000002",
            projectId: nil, taskId: nil,
            startTime: "2026-08-20T04:00:00Z",
            endTime: "2026-08-20T05:00:00Z",
            source: "MANUAL",
            note: nil
        ))
        XCTAssertEqual(json["endTime"] as? String, "2026-08-20T05:00:00Z")
    }

    func testNilProjectAndTaskStillEmitExplicitNulls() throws {
        let json = try encoded(TimeEntryPayload(
            id: "01920000-0000-7000-8000-000000000003",
            projectId: nil, taskId: nil,
            startTime: "2026-08-20T04:00:00Z",
            endTime: nil,
            source: "MANUAL",
            note: nil
        ))
        XCTAssertTrue(json["projectId"] is NSNull)
        XCTAssertTrue(json["taskId"] is NSNull)
    }

    func testNilNoteIsOmittedNotNulled() throws {
        let json = try encoded(TimeEntryPayload(
            id: "01920000-0000-7000-8000-000000000004",
            projectId: nil, taskId: nil,
            startTime: "2026-08-20T04:00:00Z",
            endTime: nil,
            source: "MANUAL",
            note: nil
        ))
        // note is .optional() on the server — omitted, not null.
        XCTAssertFalse(json.keys.contains("note"))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter TimeEntryPayloadTests`
Expected: FAIL to compile — `TimeEntryPayload` is `private` to `TimeTracker.swift` and not visible.

- [ ] **Step 3: Extract the payload to its own file**

Create `apps/client-macos/Sources/TimeTrack/Sync/TimeEntryPayload.swift`:

```swift
import Foundation

/// Matches `CreateTimeEntrySchema` in @timetrack/contracts.
///
/// `projectId`/`taskId`/`endTime` are `.nullable()` on the server (present, may be null), so a
/// nil MUST be encoded with `encodeNil` — Swift's synthesised Codable would omit the key and
/// the strict-mode Zod pipe answers 422. `note` is `.optional()`, so nil is omitted instead.
///
/// A nil `endTime` means the entry is still RUNNING. Only the direct live-entry publish sends
/// that; buffered records are always closed.
struct TimeEntryPayload: Encodable {
    let id: String
    let projectId: String?
    let taskId: String?
    let startTime: String
    let endTime: String?
    let source: String
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id, projectId, taskId, startTime, endTime, source, note
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        if let projectId { try c.encode(projectId, forKey: .projectId) } else { try c.encodeNil(forKey: .projectId) }
        if let taskId { try c.encode(taskId, forKey: .taskId) } else { try c.encodeNil(forKey: .taskId) }
        try c.encode(startTime, forKey: .startTime)
        if let endTime { try c.encode(endTime, forKey: .endTime) } else { try c.encodeNil(forKey: .endTime) }
        try c.encode(source, forKey: .source)
        try c.encodeIfPresent(note, forKey: .note)
    }

    /// The wire format the API expects for instants.
    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
```

- [ ] **Step 4: Remove the private duplicate from `TimeTracker.swift`**

Delete the `private struct TimeEntryPayload` at the bottom of `Sources/TimeTrack/Tracking/TimeTracker.swift` and the `private static let iso` on `TimeTracker`. Update `enqueue` to use the shared type:

```swift
private func enqueue(id: String, projectId: String?, taskId: String?,
                     start: Date, end: Date, source: Source) {
    let payload = TimeEntryPayload(
        id: id,
        projectId: projectId,
        taskId: taskId,
        startTime: TimeEntryPayload.iso.string(from: start),
        endTime: TimeEntryPayload.iso.string(from: end),
        source: source.rawValue,
        note: nil
    )
    if let data = try? JSONEncoder().encode(payload) {
        buffer.enqueue(id: id, kind: .timeEntry, payload: data)
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter TimeEntryPayloadTests`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the whole client suite**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS. The client is a single executable target, so a type change must compile against every call site in the same commit.

- [ ] **Step 7: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Sync/TimeEntryPayload.swift \
        apps/client-macos/Sources/TimeTrack/Tracking/TimeTracker.swift \
        apps/client-macos/Tests/TimeTrackTests/TimeEntryPayloadTests.swift
git commit -m "refactor(client): share the time-entry payload encoder"
```

---

### Task 6: Publish the in-progress entry while tracking

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/Sync/LiveEntryPublisher.swift`
- Create: `apps/client-macos/Tests/TimeTrackTests/LiveEntryPublisherTests.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/Tracking/TimeTracker.swift` (add `onSpanOpened`)
- Modify: `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift:191-199` (heartbeat), and the wiring near `:533`

**Interfaces:**

- Consumes: `TimeEntryPayload` (Task 5), `Uploading` / `TimeEntryUploader` (existing), `LiveSpan` + `LiveSpanStore.load()` (existing).
- Produces:
  - `TimeTracker.onSpanOpened: ((_ entryId: String, _ start: Date, _ selection: Selection, _ source: Source) -> Void)?` — mirrors the existing `onSpanClosed`, invoked on the main thread after the live span is recorded.
  - `final class LiveEntryPublisher` with `func publish(_ span: LiveSpan) async` and `func publish(entryId:start:selection:source:) async`.

**Why not `BufferStore`.** `BufferStore.enqueue` names files `{millis}__{kind}__{id}.json` and its `removeItem(at: dst)` only collides on an identical millisecond — so enqueueing the same id twice leaves **two** records. A stale "still open" payload draining after the close would null a real `endTime`. Task 2 makes the server refuse that, but the client should not send it in the first place. The publish is fire-and-forget and out of band; the closed entry still goes through the buffer exactly as today, so **offline correctness is unchanged**.

- [ ] **Step 1: Write the failing test**

Create `apps/client-macos/Tests/TimeTrackTests/LiveEntryPublisherTests.swift`:

```swift
import XCTest
@testable import TimeTrack

private final class SpyUploader: Uploading {
    var bodies: [Data] = []
    var result: UploadResult = .success
    func upload(_ payload: Data) async -> UploadResult {
        bodies.append(payload)
        return result
    }
}

final class LiveEntryPublisherTests: XCTestCase {
    private func json(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testPublishesAnOpenEntryWithNullEndTime() async throws {
        let spy = SpyUploader()
        let publisher = LiveEntryPublisher(uploader: spy)

        await publisher.publish(
            entryId: "01920000-0000-7000-8000-000000000010",
            start: Date(timeIntervalSince1970: 1_787_000_000),
            selection: TimeTracker.Selection(projectId: nil, taskId: nil),
            source: .manual
        )

        XCTAssertEqual(spy.bodies.count, 1)
        let body = try json(XCTUnwrap(spy.bodies.first))
        XCTAssertTrue(body["endTime"] is NSNull)
        XCTAssertEqual(body["source"] as? String, "MANUAL")
        XCTAssertEqual(body["id"] as? String, "01920000-0000-7000-8000-000000000010")
    }

    func testPublishesFromAPersistedLiveSpan() async throws {
        let spy = SpyUploader()
        let publisher = LiveEntryPublisher(uploader: spy)
        let span = LiveSpan(
            entryId: "01920000-0000-7000-8000-000000000011",
            startTime: Date(timeIntervalSince1970: 1_787_000_000),
            projectId: "01920000-0000-7000-8000-0000000000aa",
            taskId: nil,
            source: "AUTO",
            lastAlive: Date(timeIntervalSince1970: 1_787_000_600),
            userId: "01920000-0000-7000-8000-0000000000bb"
        )

        await publisher.publish(span)

        let body = try json(XCTUnwrap(spy.bodies.first))
        XCTAssertEqual(body["id"] as? String, span.entryId)
        XCTAssertEqual(body["projectId"] as? String, span.projectId)
        XCTAssertTrue(body["taskId"] is NSNull)
        XCTAssertTrue(body["endTime"] is NSNull)
        XCTAssertEqual(body["source"] as? String, "AUTO")
    }

    // A live publish is best-effort. It must NEVER be treated as fatal: the authoritative
    // record is the closed entry that goes through BufferStore on Stop.
    func testATransientFailureIsSwallowed() async {
        let spy = SpyUploader()
        spy.result = .transient
        let publisher = LiveEntryPublisher(uploader: spy)

        await publisher.publish(
            entryId: "01920000-0000-7000-8000-000000000012",
            start: Date(),
            selection: TimeTracker.Selection(projectId: nil, taskId: nil),
            source: .manual
        )

        XCTAssertEqual(spy.bodies.count, 1) // did not throw, did not retry-storm
    }

    func testAConflictIsSwallowed() async {
        let spy = SpyUploader()
        spy.result = .permanent(409) // a stranded open row already exists server-side
        let publisher = LiveEntryPublisher(uploader: spy)

        await publisher.publish(
            entryId: "01920000-0000-7000-8000-000000000013",
            start: Date(),
            selection: TimeTracker.Selection(projectId: nil, taskId: nil),
            source: .manual
        )

        XCTAssertEqual(spy.bodies.count, 1)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter LiveEntryPublisherTests`
Expected: FAIL to compile — `LiveEntryPublisher` does not exist.

- [ ] **Step 3: Write the publisher**

Create `apps/client-macos/Sources/TimeTrack/Sync/LiveEntryPublisher.swift`:

```swift
import Foundation

/// Publishes the CURRENTLY RUNNING entry (`endTime: null`) so the dashboard can show time
/// accruing instead of only appearing on Stop (spec §4.1).
///
/// Deliberately does NOT go through `BufferStore`: that buffer appends one file per enqueue
/// (`{millis}__{kind}__{id}.json`), so the same id enqueued twice leaves two records, and a
/// stale open payload draining after the close would null a real `endTime`.
///
/// Best-effort by design. Every failure is swallowed — the authoritative record is still the
/// CLOSED entry that `TimeTracker.close` enqueues to the buffer, so offline behaviour is
/// unchanged. Not a capture path: no AckGate (manual tracking is gated upstream by
/// `MenuViewModel.isReady`).
final class LiveEntryPublisher {
    private let uploader: Uploading

    init(uploader: Uploading) {
        self.uploader = uploader
    }

    func publish(entryId: String, start: Date, selection: TimeTracker.Selection,
                 source: TimeTracker.Source) async {
        await send(TimeEntryPayload(
            id: entryId,
            projectId: selection.projectId,
            taskId: selection.taskId,
            startTime: TimeEntryPayload.iso.string(from: start),
            endTime: nil,
            source: source.rawValue,
            note: nil
        ))
    }

    /// Re-publish from the persisted span — used by the heartbeat, which is the only thing that
    /// knows the span survived a restart of the publish path.
    func publish(_ span: LiveSpan) async {
        await send(TimeEntryPayload(
            id: span.entryId,
            projectId: span.projectId,
            taskId: span.taskId,
            startTime: TimeEntryPayload.iso.string(from: span.startTime),
            endTime: nil,
            source: span.source,
            note: nil
        ))
    }

    /// Close the server row for a span the user chose to DISCARD, by ending it at its own start.
    /// A zero-duration row releases the one-open-entry index slot and is filtered out of every
    /// list and export server-side (spec §4.4). Used by recovery Discard.
    func publishDiscarded(_ span: LiveSpan) async {
        let at = TimeEntryPayload.iso.string(from: span.startTime)
        await send(TimeEntryPayload(
            id: span.entryId,
            projectId: span.projectId,
            taskId: span.taskId,
            startTime: at,
            endTime: at,
            source: span.source,
            note: nil
        ))
    }

    private func send(_ payload: TimeEntryPayload) async {
        guard let data = try? JSONEncoder().encode(payload) else { return }
        // The result is intentionally discarded. A 409 means a stranded open row already
        // exists; a 429/5xx means the API is busy. Neither is a reason to stop tracking, and
        // neither loses data — the closed entry still goes through the buffer.
        _ = await uploader.upload(data)
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter LiveEntryPublisherTests`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the `onSpanOpened` seam to `TimeTracker`**

In `apps/client-macos/Sources/TimeTrack/Tracking/TimeTracker.swift`, beside the existing `onSpanClosed`:

```swift
/// Optional observer of each span OPENING (spec §4.1 live publish). Default nil → no
/// behavioural change and no call-site change. Invoked on the main thread (this type is
/// main-thread-only), after the live span is recorded.
var onSpanOpened: ((_ entryId: String, _ start: Date, _ selection: Selection, _ source: Source) -> Void)?
```

and fire it at the end of `open`:

```swift
private func open(_ selection: Selection, source: Source) {
    let now = clock()
    let id = idGen(now)
    state = .tracking(entryId: id, startedAt: now, selection: selection, source: source)
    liveSpan.begin(entryId: id, startTime: now, selection: selection, source: source)
    onSpanOpened?(id, now, selection, source)
}
```

- [ ] **Step 6: Wire the publisher in `AppDelegate`**

Add a stored property beside the other clients (near `:85-96`):

```swift
private let liveEntryPublisher: LiveEntryPublisher
```

Initialise it where the other `baseURL`/`session` clients are built (near `:82-96`):

```swift
self.liveEntryPublisher = LiveEntryPublisher(
    uploader: TimeEntryUploader(baseURL: baseURL, session: session)
)
```

After the tracker is constructed (`:109`), wire the seam:

```swift
tracker.onSpanOpened = { [weak self] entryId, start, selection, source in
    guard let self else { return }
    Task { await self.liveEntryPublisher.publish(
        entryId: entryId, start: start, selection: selection, source: source
    ) }
}
```

- [ ] **Step 7: Re-publish on the existing heartbeat**

Extend `startHeartbeat` (`:191-199`). Do **not** add a second timer and do **not** shorten the interval — 60s is one request per minute per actively-tracking client, comfortably inside the API's 100/60s throttler, and the dashboard renders elapsed time from `startTime` so a faster POST buys nothing:

```swift
@MainActor private func startHeartbeat() {
    let timer = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
        guard let self, self.timeTracker.isRunning else { return }
        self.liveSpanStore.heartbeat(at: Date())
        // Re-publish the OPEN entry so the server's heartbeatAt stays fresh and the
        // dashboard keeps showing it as running (spec §4.1/§4.3). Best-effort.
        if let span = self.liveSpanStore.load() {
            Task { await self.liveEntryPublisher.publish(span) }
        }
    }
    RunLoop.main.add(timer, forMode: .common)
    heartbeatTimer = timer
}
```

- [ ] **Step 8: Build and run the full client suite**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS.

- [ ] **Step 9: Verify the ordering constraint is satisfied**

Run: `git log --oneline | head -8`
Expected: the `feat(db): add heartbeatAt`, `fix(api): keep the time-entry close monotone`, and `fix(api): clamp open entries to the last heartbeat` commits all appear **before** this one. If they do not, stop — shipping this commit alone is the unbounded-duration regression.

- [ ] **Step 10: Commit**

```bash
git add apps/client-macos/Sources apps/client-macos/Tests
git commit -m "feat(client): publish the in-progress entry while tracking"
```

---

### Task 7: Close the server row when recovery is discarded

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift:360-386` (`recoverLiveSpanIfNeeded`)
- Test: `apps/client-macos/Tests/TimeTrackTests/LiveEntryPublisherTests.swift` (extend)

**Interfaces:**

- Consumes: `LiveEntryPublisher.publishDiscarded(_:)` (Task 6), `LiveSpan` (existing).
- Produces: no new types.

**Why this is needed.** Before Task 6, Discard only cleared the local `live-span.json` and nothing else existed. Now there is a matching **open row on the server**, and clearing the local file would leave it open forever — after which the `time_entries_one_running_per_user` partial unique index would 409 every subsequent Start.

- [ ] **Step 1: Write the failing test**

Append to `apps/client-macos/Tests/TimeTrackTests/LiveEntryPublisherTests.swift`:

```swift
extension LiveEntryPublisherTests {
    func testDiscardClosesTheRowAtItsOwnStart() async throws {
        let spy = SpyUploader()
        let publisher = LiveEntryPublisher(uploader: spy)
        let start = Date(timeIntervalSince1970: 1_787_000_000)
        let span = LiveSpan(
            entryId: "01920000-0000-7000-8000-000000000020",
            startTime: start,
            projectId: nil, taskId: nil,
            source: "MANUAL",
            lastAlive: start.addingTimeInterval(1800),
            userId: nil
        )

        await publisher.publishDiscarded(span)

        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: XCTUnwrap(spy.bodies.first)) as? [String: Any]
        )
        // Zero duration: releases the one-open-entry index slot, contributes nothing,
        // and is filtered out of every server-side list and export.
        XCTAssertEqual(body["startTime"] as? String, body["endTime"] as? String)
        XCTAssertEqual(body["id"] as? String, span.entryId)
        // NOT closed at lastAlive — that would silently KEEP the time the user discarded.
        XCTAssertNotEqual(body["endTime"] as? String,
                          TimeEntryPayload.iso.string(from: span.lastAlive))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter LiveEntryPublisherTests`
Expected: FAIL if `publishDiscarded` was not added in Task 6; PASS if it was — in which case this step confirms the behaviour and you proceed to wire it.

- [ ] **Step 3: Wire Discard in `recoverLiveSpanIfNeeded`**

In `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift`, extend the resolve closure. Keep the existing defence-in-depth user re-check exactly as it is:

```swift
RecoveryWindowController.present(minutes: minutes) { [weak self] action in
    guard let self else { return }
    // Defense-in-depth: the prompt is non-modal and can outlive the user who opened it
    // (e.g. left open across a sign-out/sign-in). Re-check against the CURRENT logged-in
    // user so a stale click from a prior user's prompt can never be mis-attributed.
    let stillOurs = LiveSpanStore.shouldRecover(span: span, currentUserId: self.userIdBox.value)
    if action == .keep, stillOurs {
        self.timeTracker.recordSpan(
            id: span.entryId, start: span.startTime, end: span.lastAlive,
            projectId: span.projectId, taskId: span.taskId,
            source: TimeTracker.Source(rawValue: span.source) ?? .manual
        )
    } else if action == .discard, stillOurs {
        // The span may already be an OPEN row on the server (spec §4.1). Clearing only the
        // local file would leave it open forever and 409 every future Start, so close it as
        // a zero-duration entry.
        Task { await self.liveEntryPublisher.publishDiscarded(span) }
    }
    self.liveSpanStore.clear()
}
```

Note the Keep branch is unchanged in effect: `recordSpan` reuses `span.entryId`, so the upsert takes the update branch and closes the existing row. No second row, no double count.

- [ ] **Step 4: Build and test**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos
git commit -m "fix(client): close the server row when recovery is discarded"
```

---

### Task 8: Default interrupted-time recovery to Keep

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/UI/RecoveryView.swift:24-28`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Move the default action**

In `apps/client-macos/Sources/TimeTrack/UI/RecoveryView.swift`, move `.keyboardShortcut(.defaultAction)` from Discard to Keep:

```swift
HStack {
    Spacer()
    Button("Keep", action: onKeep)
        .keyboardShortcut(.defaultAction)
    Button("Discard", action: onDiscard)
}
```

- [ ] **Step 2: Update the doc comment**

The comment above the struct says "Discard is the default action (and the result of dismissing), mirroring the away prompt." Correct it — Keep is now the default; **dismissing still discards**, which stays true and matters:

```swift
/// Shown on relaunch when a previous tracking span was interrupted (crash, shutdown, or
/// quit-while-tracking). Keep → the span is recovered as a completed entry ending at the last
/// heartbeat; Discard drops it and closes any server-side row at zero duration.
///
/// Keep is the DEFAULT action: a graceful shutdown routes through this same prompt, and
/// pressing Enter should not throw away real work. Dismissing the window still resolves to
/// Discard, so an ignored prompt never silently invents time. Always a visible window; no
/// stealth. `resolve` fires exactly once.
```

- [ ] **Step 3: Build and test**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS. If a test asserts the old default, update it to assert Keep.

- [ ] **Step 4: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/UI/RecoveryView.swift
git commit -m "fix(client): default interrupted-time recovery to Keep"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the monorepo gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. Paste the real output into the completion report.

- [ ] **Step 2: Run the e2e suites**

Run: `RUN_E2E=1 pnpm --filter api test:e2e`
Expected: PASS. Requires Docker.

- [ ] **Step 3: Check the API coverage gate**

Run: `RUN_E2E=1 pnpm --filter api test:coverage`
Expected: ≥80%; `functions` is the binding metric.

- [ ] **Step 4: Build and test the client**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS.

- [ ] **Step 5: Manual smoke test — the actual reported bug**

This is the only step that proves the reported problem is fixed:

1. Start the API, worker, dashboard, and Postgres/Redis/MinIO (`docker compose -f infra/docker-compose.yml up -d`, then `pnpm dev`).
2. Launch the Mac client, sign in, pick a project, press Start.
3. Open `/me` on the dashboard. **Within about a minute, the running entry must appear** with a "Recording now" pill — before pressing Stop.
4. Wait two minutes and refresh: the entry's duration has grown.
5. Quit the client without stopping. Wait six minutes, refresh: the duration has **stopped growing** and the pill is out.
6. Relaunch the client: the Recover prompt appears with **Keep** as the default. Press Enter; the entry closes at the last heartbeat.

Record what you actually observed. If any step does not behave as described, report it rather than marking this plan complete.

- [ ] **Step 6: Format only what this plan touched**

Run: `pnpm exec prettier --write "apps/api/src/**" "apps/dashboard/src/**" "packages/db/**/*.prisma"`
Do not run repo-wide `pnpm format`.

---

## Deployment ordering

`packages/db` migration → API (Tasks 2–4) → **then** the Mac client build (Tasks 5–8). Shipping a client that publishes open entries to an API without the `heartbeatAt` clamp is the unbounded-duration regression this plan exists to prevent.
