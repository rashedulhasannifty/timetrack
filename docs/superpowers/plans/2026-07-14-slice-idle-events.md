# Idle-events Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver end-to-end sync of macOS-client idle events — a new `POST /v1/idle-events` ingest endpoint plus the client drain wiring — so buffered `IdleEvent` records reach the server instead of aging out unsent.

**Architecture:** The client already enqueues `IdleEvent` records into its durable file buffer (`AutoTrackingCoordinator`), but `SyncEngine` drains only `.timeEntry`. This slice adds a NestJS vertical-slice module (`idle-events`) whose controller upserts each event idempotently on its client-minted UUIDv7, and extends `SyncEngine` with a second drain pass that routes `.idleEvent` records to the new endpoint through the existing uploader (path-parameterized). The server stores each event as an audit/analytics row only — it never reconciles or deletes time entries.

**Tech Stack:** NestJS 11 (Fastify), Prisma 7 (pg adapter), Zod 4, Vitest + Testcontainers (real Postgres 18), Swift / XCTest (macOS client).

## Global Constraints

- Node 24.x, NestJS 11.1.x, Prisma 7.8.x, Zod 4.4.x, Vitest latest. Never upgrade a major or add a dependency (CLAUDE.md §2).
- All API routes are under `/v1` (URI versioning in `main.ts`). Never break `/v1`.
- Validation is Zod-only; types are inferred, never hand-written. Use Zod 4 top-level helpers (`z.uuid()`, `z.iso.datetime()`).
- Scope the Zod pipe to the parameter (`@Body(new ZodValidationPipe(Schema))`), never method-level `@UsePipes`.
- `PrismaClient` appears only in `*.repository.ts`. Controllers hold HTTP + guards + validation (no logic); services hold logic (no Prisma).
- DTO/response shapes live only in `packages/contracts/src/`. Never hand-write a response interface.
- Deny by default: the global `JwtAuthGuard` protects every route; `@Public()` must be explicit. This route is self-attributed like activity — **no `@ResourceScope`** (there is no `userId` in the body to scope).
- Logging is Pino-only; `console.log` is banned. (No sensitive fields are added in this slice, so no redact-list change.)
- Git identity: no AI attribution anywhere. Conventional Commits (`<type>(<scope>): …`), scope ∈ `api | worker | dashboard | client | db | contracts | infra`.
- Work happens on branch `slice-idle-events` (already created). Commit after each task.

## File Structure

- `packages/contracts/src/idle.ts` — **modify**: add `IdleEventResultSchema` + `IdleEventResult` type (reuse existing `IdleEventSchema` as the request).
- `packages/contracts/src/contracts.spec.ts` — **modify**: extend the `idle` describe block.
- `apps/api/src/modules/idle-events/idle-events.repository.ts` — **create**: `prisma.idleEvent.upsert` on the client id.
- `apps/api/src/modules/idle-events/idle-events.service.ts` — **create**: attribute to session user, delegate to repo.
- `apps/api/src/modules/idle-events/idle-events.service.spec.ts` — **create**: unit (attribution).
- `apps/api/src/modules/idle-events/idle-events.controller.ts` — **create**: `POST /idle-events` (201, no `@ResourceScope`).
- `apps/api/src/modules/idle-events/idle-events.controller.spec.ts` — **create**: unit (delegation + not-`@Public`).
- `apps/api/src/modules/idle-events/idle-events.module.ts` — **create**.
- `apps/api/src/app.module.ts` — **modify**: register `IdleEventsModule`.
- `apps/api/test/idle-events.e2e-spec.ts` — **create**: repository-level, real Postgres (store + idempotency).
- `apps/client-macos/Sources/TimeTrack/Sync/SyncEngine.swift` — **modify**: add `idleUploader` + shared `drain(kind:using:)`.
- `apps/client-macos/Sources/TimeTrack/Sync/TimeEntryUploader.swift` — **modify**: add a `path` parameter (default `"time-entries"`).
- `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift` — **modify**: construct + pass the idle uploader.
- `apps/client-macos/Tests/TimeTrackTests/SyncEngineTests.swift` — **modify**: rewrite for the two-kind drain.
- `apps/client-macos/Sources/TimeTrack/Storage/BufferStore.swift`, `.../Tracking/IdleEventPayload.swift` — **modify**: correct now-false comments.
- `PRD.md` — **modify**: update §7.9 line 511 (kept in sync with code).

---

### Task 1: Contracts — idle-event ingest result type

**Files:**

- Modify: `packages/contracts/src/idle.ts`
- Test: `packages/contracts/src/contracts.spec.ts` (extend the existing `idle` block)

**Interfaces:**

- Consumes: existing `IdleEventSchema`, `ResolvedAction` from `packages/contracts/src/idle.ts`.
- Produces: `IdleEventResultSchema` (Zod object `{ id: uuid, resolvedAction: ResolvedAction }`) and `type IdleEventResult = z.infer<typeof IdleEventResultSchema>`. `IdleEventSchema` (unchanged) is the request body type; `IdleEvent` its inferred type.

- [ ] **Step 1: Write the failing test**

Add these cases inside the existing `describe('idle', …)` block in `packages/contracts/src/contracts.spec.ts`. Add `IdleEventResultSchema` to the import list from `./index.js`:

```ts
describe('idle', () => {
  it('validates a resolved idle event', () => {
    expect(
      IdleEventSchema.safeParse({
        id: UUID,
        startTime: ISO,
        endTime: ISO,
        resolvedAction: 'DISCARDED',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown resolvedAction', () => {
    expect(
      IdleEventSchema.safeParse({
        id: UUID,
        startTime: ISO,
        endTime: ISO,
        resolvedAction: 'MAYBE',
      }).success,
    ).toBe(false);
  });

  it('IdleEventResultSchema round-trips id + resolvedAction', () => {
    expect(IdleEventResultSchema.parse({ id: UUID, resolvedAction: 'KEPT' })).toEqual({
      id: UUID,
      resolvedAction: 'KEPT',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @timetrack/contracts test`
Expected: FAIL — `IdleEventResultSchema` is not exported (import error / undefined).

- [ ] **Step 3: Add the schema + type**

Append to `packages/contracts/src/idle.ts` (after `IdleEventSchema`):

```ts
/** The ingest response: the stored event's identity + how it resolved. */
export const IdleEventResultSchema = z.object({
  id: z.uuid(),
  resolvedAction: ResolvedAction,
});

export type IdleEventResult = z.infer<typeof IdleEventResultSchema>;
```

`idle.ts` is already re-exported by `packages/contracts/src/index.ts` (`export * from './idle.js'`), so no index change is needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @timetrack/contracts test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/idle.ts packages/contracts/src/contracts.spec.ts
git commit -m "feat(contracts): add idle-event ingest result schema"
```

---

### Task 2: API — idle-events repository + Postgres e2e

**Files:**

- Create: `apps/api/src/modules/idle-events/idle-events.repository.ts`
- Test: `apps/api/test/idle-events.e2e-spec.ts`

**Interfaces:**

- Consumes: `PrismaService` (`apps/api/src/infra/prisma/prisma.service.js`), `IdleEvent` + `IdleEventResult` types from `@timetrack/contracts`, `prisma.idleEvent` model (fields `id`, `userId`, `startTime`, `endTime`, `resolvedAction`; PK on `id`, **no FK** on `userId`).
- Produces: `class IdleEventsRepository { upsert(event: IdleEvent, userId: string): Promise<IdleEventResult> }`.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/api/test/idle-events.e2e-spec.ts` (repository-level against real Postgres, mirroring `time-entries.e2e-spec.ts`). No user seeding — `idle_events.userId` has no FK:

```ts
import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IdleEventsRepository } from '../src/modules/idle-events/idle-events.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';
import type { IdleEvent } from '@timetrack/contracts';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('idle-events repository — real Postgres', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  function repo(): IdleEventsRepository {
    return new IdleEventsRepository(db.prisma as unknown as PrismaService);
  }

  function event(id: string, over: Partial<IdleEvent> = {}): IdleEvent {
    return {
      id,
      startTime: '2026-07-11T09:00:00Z',
      endTime: '2026-07-11T09:05:00Z',
      resolvedAction: 'DISCARDED',
      ...over,
    };
  }

  it('stores an idle event attributed to the user and echoes id + action', async () => {
    const id = '019797a0-0000-7000-8000-0000000000e1';
    const stored = await repo().upsert(event(id), 'u1');
    expect(stored).toEqual({ id, resolvedAction: 'DISCARDED' });

    const row = await db.prisma.idleEvent.findUnique({ where: { id } });
    expect(row?.userId).toBe('u1');
    expect(row?.resolvedAction).toBe('DISCARDED');
  });

  it('upsert is idempotent on the client id (double drain -> one row)', async () => {
    const e = event('019797a0-0000-7000-8000-0000000000e2');
    await repo().upsert(e, 'u1');
    await repo().upsert(e, 'u1'); // retried offline drain
    expect(await db.prisma.idleEvent.count({ where: { id: e.id } })).toBe(1);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('idle-events e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test:e2e` (no `RUN_E2E`, so the DB block is skipped but the file must still compile)
Expected: FAIL — cannot resolve `../src/modules/idle-events/idle-events.repository.js` (module does not exist yet).

- [ ] **Step 3: Create the repository**

Create `apps/api/src/modules/idle-events/idle-events.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { IdleEvent, IdleEventResult, ResolvedAction } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// Never select `*` back to the client — echo only the event's identity + resolution.
const IDLE_EVENT_SELECT = { id: true, resolvedAction: true } as const;

/**
 * CLAUDE.md §3 — Prisma lives HERE and nowhere else in apps/api. Upsert on the
 * client-minted UUIDv7 (PRD §7.5): a retried offline drain is a no-op, not a duplicate.
 * The event is an audit/analytics row — no reconciliation of overlapping time entries.
 */
@Injectable()
export class IdleEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(event: IdleEvent, userId: string): Promise<IdleEventResult> {
    const row = await this.prisma.idleEvent.upsert({
      where: { id: event.id },
      create: {
        id: event.id,
        userId,
        startTime: new Date(event.startTime),
        endTime: new Date(event.endTime),
        resolvedAction: event.resolvedAction,
      },
      update: {
        endTime: new Date(event.endTime),
        resolvedAction: event.resolvedAction,
      },
      select: IDLE_EVENT_SELECT,
    });
    // resolvedAction is stored as a plain String column; it was written from a
    // Zod-validated payload, so narrowing back to the union is safe.
    return { id: row.id, resolvedAction: row.resolvedAction as ResolvedAction };
  }
}
```

- [ ] **Step 4: Run the e2e against real Postgres**

Ensure Docker is running (Testcontainers). Run:
`RUN_E2E=1 pnpm --filter api test:e2e apps/api/test/idle-events.e2e-spec.ts`
Expected: PASS — both DB cases green (`stored…` and `upsert is idempotent…`). If `truncateAll` errors on an unknown table, it dynamically enumerates `public` tables, so `idle_events` is already covered; a failure here means the migration wasn't applied to the test DB.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/idle-events/idle-events.repository.ts apps/api/test/idle-events.e2e-spec.ts
git commit -m "feat(api): idle-events repository with idempotent upsert"
```

---

### Task 3: API — idle-events service

**Files:**

- Create: `apps/api/src/modules/idle-events/idle-events.service.ts`
- Test: `apps/api/src/modules/idle-events/idle-events.service.spec.ts`

**Interfaces:**

- Consumes: `IdleEventsRepository.upsert` (Task 2), `SessionUser` (`apps/api/src/common/decorators/current-user.decorator.js`), `IdleEvent` + `IdleEventResult` types.
- Produces: `class IdleEventsService { ingest(event: IdleEvent, user: SessionUser): Promise<IdleEventResult> }`.

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/idle-events/idle-events.service.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { IdleEventsService } from './idle-events.service.js';
import type { IdleEventsRepository } from './idle-events.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import type { IdleEvent } from '@timetrack/contracts';

const employee: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const event: IdleEvent = {
  id: '019797a0-0000-7000-8000-000000000001',
  startTime: '2026-07-11T09:00:00Z',
  endTime: '2026-07-11T09:05:00Z',
  resolvedAction: 'DISCARDED',
};

function repoStub() {
  return {
    upsert: vi.fn().mockResolvedValue({ id: event.id, resolvedAction: 'DISCARDED' }),
  } as unknown as IdleEventsRepository;
}

describe('IdleEventsService', () => {
  it('attributes an idle event to the authenticated user (no cross-user writes)', async () => {
    const repo = repoStub();
    const svc = new IdleEventsService(repo);
    const result = await svc.ingest(event, employee);
    expect(repo.upsert).toHaveBeenCalledWith(event, 'u1');
    expect(result).toEqual({ id: event.id, resolvedAction: 'DISCARDED' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test idle-events.service`
Expected: FAIL — cannot resolve `./idle-events.service.js`.

- [ ] **Step 3: Create the service**

Create `apps/api/src/modules/idle-events/idle-events.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { IdleEvent, IdleEventResult } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { IdleEventsRepository } from './idle-events.repository.js';

/**
 * CLAUDE.md §3 — business logic, no Prisma. An idle event is always attributed to
 * the authenticated user; like activity samples the client cannot post for anyone
 * else, so there is no @ResourceScope to enforce.
 */
@Injectable()
export class IdleEventsService {
  constructor(private readonly repo: IdleEventsRepository) {}

  ingest(event: IdleEvent, user: SessionUser): Promise<IdleEventResult> {
    return this.repo.upsert(event, user.id);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api test idle-events.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/idle-events/idle-events.service.ts apps/api/src/modules/idle-events/idle-events.service.spec.ts
git commit -m "feat(api): idle-events service attributes to session user"
```

---

### Task 4: API — idle-events controller + module + registration

**Files:**

- Create: `apps/api/src/modules/idle-events/idle-events.controller.ts`
- Create: `apps/api/src/modules/idle-events/idle-events.module.ts`
- Test: `apps/api/src/modules/idle-events/idle-events.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- Consumes: `IdleEventsService.ingest` (Task 3), `IdleEventSchema` + `IdleEvent` + `IdleEventResult`, `ZodValidationPipe` (`apps/api/src/common/pipes/zod-validation.pipe.js`), `CurrentUser` + `SessionUser`, `IS_PUBLIC` (`apps/api/src/common/decorators/public.decorator.js`).
- Produces: `class IdleEventsController { ingest(event, user): Promise<IdleEventResult> }` mounted at `POST /v1/idle-events`; `IdleEventsModule`.

- [ ] **Step 1: Write the failing controller unit test**

Create `apps/api/src/modules/idle-events/idle-events.controller.spec.ts`. This asserts delegation AND — the meaningful auth check for a self-attributed route — that the handler is **not** `@Public()`, so the global `JwtAuthGuard` rejects an unauthenticated request with 401. (There is no `userId` in the body, so there is no 403-resource case to test.)

```ts
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { IdleEventsController } from './idle-events.controller.js';
import type { IdleEventsService } from './idle-events.service.js';
import { IS_PUBLIC } from '../../common/decorators/public.decorator.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import type { IdleEvent } from '@timetrack/contracts';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };
const event: IdleEvent = {
  id: '019797a0-0000-7000-8000-000000000001',
  startTime: '2026-07-11T09:00:00Z',
  endTime: '2026-07-11T09:05:00Z',
  resolvedAction: 'KEPT',
};

describe('IdleEventsController', () => {
  it('delegates ingest to the service with the event and current user', async () => {
    const service = {
      ingest: vi.fn().mockResolvedValue({ id: event.id, resolvedAction: 'KEPT' }),
    } as unknown as IdleEventsService;
    const ctrl = new IdleEventsController(service);

    const result = await ctrl.ingest(event, user);

    expect(service.ingest).toHaveBeenCalledWith(event, user);
    expect(result).toEqual({ id: event.id, resolvedAction: 'KEPT' });
  });

  it('is NOT @Public — the global JwtAuthGuard applies (401 when unauthenticated)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(IS_PUBLIC, IdleEventsController.prototype.ingest);
    expect(meta).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api test idle-events.controller`
Expected: FAIL — cannot resolve `./idle-events.controller.js`.

- [ ] **Step 3: Create the controller**

Create `apps/api/src/modules/idle-events/idle-events.controller.ts`. Return Nest's **default 201** — do NOT add `@HttpCode(202)`: the client's `classify()` treats only 200/201 as success, so a 202 would be classified transient and the record would loop forever.

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { IdleEventSchema, type IdleEvent, type IdleEventResult } from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { IdleEventsService } from './idle-events.service.js';

/**
 * CLAUDE.md §3 — HTTP + guards + validation only. No business logic, no Prisma.
 * Self-attributed like activity samples: the event is always the caller's, so there
 * is no @ResourceScope (no userId in the body to scope). The Zod pipe is scoped to
 * the @Body parameter, never method-level @UsePipes.
 */
@Controller('idle-events')
export class IdleEventsController {
  constructor(private readonly service: IdleEventsService) {}

  // Default 201 (NOT 202): the client's TimeEntryUploader.classify() treats only
  // 200/201 as .success; a 202 would be reclassified transient and never removed.
  @Post()
  ingest(
    @Body(new ZodValidationPipe(IdleEventSchema)) event: IdleEvent,
    @CurrentUser() user: SessionUser,
  ): Promise<IdleEventResult> {
    return this.service.ingest(event, user);
  }
}
```

- [ ] **Step 4: Create the module**

Create `apps/api/src/modules/idle-events/idle-events.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { IdleEventsController } from './idle-events.controller.js';
import { IdleEventsService } from './idle-events.service.js';
import { IdleEventsRepository } from './idle-events.repository.js';

@Module({
  controllers: [IdleEventsController],
  providers: [IdleEventsService, IdleEventsRepository],
  exports: [IdleEventsService],
})
export class IdleEventsModule {}
```

- [ ] **Step 5: Register the module in app.module.ts**

In `apps/api/src/app.module.ts`, add the import next to the other module imports and the module in the `imports` array right after `ActivityModule`:

```ts
import { IdleEventsModule } from './modules/idle-events/idle-events.module.js';
```

```ts
    ActivityModule,
    IdleEventsModule,
    ScreenshotsModule,
```

- [ ] **Step 6: Run the controller test to verify it passes**

Run: `pnpm --filter api test idle-events.controller`
Expected: PASS — both cases green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/idle-events/idle-events.controller.ts apps/api/src/modules/idle-events/idle-events.controller.spec.ts apps/api/src/modules/idle-events/idle-events.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): idle-events ingest endpoint POST /v1/idle-events"
```

---

### Task 5: Client — SyncEngine drains idle events

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/Sync/SyncEngine.swift`
- Test: `apps/client-macos/Tests/TimeTrackTests/SyncEngineTests.swift`

**Interfaces:**

- Consumes: `BufferStore` (`take(kind:limit:)`, `remove(id:)`, `prune(olderThan:)`), `Uploading.upload(_:) -> UploadResult`, `BackoffPolicy`, `BufferKind.timeEntry` / `.idleEvent`.
- Produces: `SyncEngine.init(buffer:uploader:idleUploader:backoff:intervalSeconds:batchLimit:maxAge:)` — `idleUploader` is a new **required** parameter placed immediately after `uploader`. Private `drain(kind:using:) async -> Bool`. `syncNow()` drains `.timeEntry` then `.idleEvent`; a transient/auth failure in the first pass returns early (no second pass).

Note: `swift test` on this repo needs `DEVELOPER_DIR` pointed at Xcode (CommandLineTools lacks XCTest). Run from `apps/client-macos/`.

- [ ] **Step 1: Rewrite the tests (failing)**

Replace the whole body of `apps/client-macos/Tests/TimeTrackTests/SyncEngineTests.swift` with the version below. It adds an `idleUploader` argument to every `SyncEngine(...)` call, replaces the old "idle events left untouched" test with two new drain tests, and adjusts the prune test to use a transient idle uploader so the pruned-vs-kept assertion still isolates prune behavior:

```swift
import XCTest
@testable import TimeTrack

final class SyncEngineTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func tempBuffer(clock: @escaping () -> Date = Date.init) -> BufferStore {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("synctest-\(UUID().uuidString)", isDirectory: true)
        return BufferStore(directory: dir, clock: clock)
    }

    func testDrainsTimeEntriesAndRemovesOnSuccess() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        buffer.enqueue(id: "t2", kind: .timeEntry, payload: Data("2".utf8))
        let uploader = FakeUploader(results: [.success])
        let engine = SyncEngine(buffer: buffer, uploader: uploader,
                                idleUploader: FakeUploader(results: [.success]))

        await engine.syncNow()

        XCTAssertEqual(uploader.uploadedPayloads.count, 2)
        XCTAssertTrue(buffer.take(kind: .timeEntry, limit: 10).isEmpty, "delivered records removed")
    }

    func testDrainsIdleEventsToIdleUploaderAndRemovesOnSuccess() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("te".utf8))
        buffer.enqueue(id: "e1", kind: .idleEvent, payload: Data("ie".utf8))
        let timeUploader = FakeUploader(results: [.success])
        let idleUploader = FakeUploader(results: [.success])
        let engine = SyncEngine(buffer: buffer, uploader: timeUploader, idleUploader: idleUploader)

        await engine.syncNow()

        // Each kind routed to its own uploader; both buffers drained.
        XCTAssertEqual(timeUploader.uploadedPayloads, [Data("te".utf8)])
        XCTAssertEqual(idleUploader.uploadedPayloads, [Data("ie".utf8)])
        XCTAssertTrue(buffer.take(kind: .timeEntry, limit: 10).isEmpty)
        XCTAssertTrue(buffer.take(kind: .idleEvent, limit: 10).isEmpty, "delivered idle events removed")
    }

    func testIdleTransientStopsCycleAndKeepsIdleRecords() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "e1", kind: .idleEvent, payload: Data("ie".utf8))
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.success]),
                                idleUploader: FakeUploader(results: [.transient]))

        let backedOff = await engine.syncNow()

        XCTAssertTrue(backedOff, "a transient idle upload backs the cycle off")
        XCTAssertEqual(buffer.take(kind: .idleEvent, limit: 10).count, 1, "nothing removed on transient")
    }

    func testTimeEntryTransientStopsBeforeIdlePass() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("te".utf8))
        buffer.enqueue(id: "e1", kind: .idleEvent, payload: Data("ie".utf8))
        let idleUploader = FakeUploader(results: [.success])
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.transient]),
                                idleUploader: idleUploader)

        let backedOff = await engine.syncNow()

        XCTAssertTrue(backedOff)
        XCTAssertEqual(buffer.take(kind: .timeEntry, limit: 10).count, 1, "time entry kept")
        XCTAssertEqual(buffer.take(kind: .idleEvent, limit: 10).count, 1, "idle pass never ran")
        XCTAssertTrue(idleUploader.uploadedPayloads.isEmpty, "idle uploader untouched after early stop")
    }

    func testPermanentFailureDropsPoisonRecord() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.permanent(422)]),
                                idleUploader: FakeUploader(results: [.success]))

        let backedOff = await engine.syncNow()

        XCTAssertFalse(backedOff, "a permanent drop is not a backoff condition")
        XCTAssertTrue(buffer.take(kind: .timeEntry, limit: 10).isEmpty, "poison record dropped")
    }

    func testRetriedRecordRemovedExactlyOnce() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.transient, .success]),
                                idleUploader: FakeUploader(results: [.success]))

        await engine.syncNow()   // transient → kept
        XCTAssertEqual(buffer.take(kind: .timeEntry, limit: 10).count, 1)
        await engine.syncNow()   // success → removed
        XCTAssertTrue(buffer.take(kind: .timeEntry, limit: 10).isEmpty)
    }

    func testPrunesOldRecordsEachCycle() async {
        let clock = MutableClock(t0)
        let buffer = tempBuffer(clock: clock.read)
        buffer.enqueue(id: "old", kind: .idleEvent, payload: Data("o".utf8))  // t0
        clock.advance(10 * 24 * 3600)                                         // now = t0 + 10d
        buffer.enqueue(id: "new", kind: .idleEvent, payload: Data("n".utf8))
        // A transient idle uploader keeps the fresh record, so this isolates prune behavior.
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.success]),
                                idleUploader: FakeUploader(results: [.transient]),
                                maxAge: 7 * 24 * 3600)

        await engine.syncNow()

        XCTAssertEqual(buffer.take(kind: .idleEvent, limit: 10).map(\.id), ["new"],
                       "the 10-day-old idle event was pruned; the fresh one kept")
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DEVELOPER_DIR=$(xcode-select -p 2>/dev/null | grep -q Xcode && xcode-select -p || echo /Applications/Xcode.app/Contents/Developer) swift test --filter SyncEngineTests`
(Simpler if Xcode is the active toolchain: `swift test --filter SyncEngineTests`.)
Expected: FAIL — `SyncEngine` has no `idleUploader:` parameter (compile error).

- [ ] **Step 3: Add the idle drain to SyncEngine**

Edit `apps/client-macos/Sources/TimeTrack/Sync/SyncEngine.swift`. Add the stored property and init parameter, and replace `syncNow()`'s inline loop with two `drain` calls plus the shared `drain` helper:

```swift
    private let buffer: BufferStore
    private let uploader: Uploading
    private let idleUploader: Uploading
    private let backoff: BackoffPolicy
    private let intervalSeconds: TimeInterval
    private let batchLimit: Int
    private let maxAge: TimeInterval

    private var timer: Timer?
    private var started = false
    private var isDraining = false

    init(buffer: BufferStore, uploader: Uploading, idleUploader: Uploading,
         backoff: BackoffPolicy = BackoffPolicy(),
         intervalSeconds: TimeInterval = 90, batchLimit: Int = 50,
         maxAge: TimeInterval = 7 * 24 * 3600) {
        self.buffer = buffer
        self.uploader = uploader
        self.idleUploader = idleUploader
        self.backoff = backoff
        self.intervalSeconds = intervalSeconds
        self.batchLimit = batchLimit
        self.maxAge = maxAge
    }
```

Replace the existing `syncNow()` body's `for record in …` loop with the two-kind drain, and add the helper below it:

```swift
    @discardableResult
    func syncNow() async -> Bool {
        guard !isDraining else { return false }
        isDraining = true
        defer { isDraining = false }

        buffer.prune(olderThan: maxAge)

        // Time entries first; a transient/auth failure there stops the whole cycle (the
        // session is likely unusable, so the idle pass would fail too) and the caller backs off.
        if await drain(kind: .timeEntry, using: uploader) { return true }
        if await drain(kind: .idleEvent, using: idleUploader) { return true }
        return false
    }

    /// One drain pass for a single buffer kind. Returns true if it stopped early on a
    /// transient/auth failure. Each record is removed on confirmed success (2xx) or dropped
    /// on a permanent 4xx (a poison record can't wedge the queue). Idempotent on the UUIDv7.
    private func drain(kind: BufferKind, using uploader: Uploading) async -> Bool {
        for record in buffer.take(kind: kind, limit: batchLimit) {
            switch await uploader.upload(record.payload) {
            case .success:
                buffer.remove(id: record.id)
                backoff.reset()
            case .permanent:
                buffer.remove(id: record.id)   // drop the poison record so it can't wedge the queue
            case .transient, .authFailed:
                return true                    // stop this cycle; caller backs off
            }
        }
        return false
    }
```

Also update the file header doc comment (lines describing "idleEvent records are left buffered (no server endpoint yet) and age-pruned") to:

```swift
/// PRD §7.5 — one-way (client→server) sync. `syncNow()` drains the durable buffer through the
/// uploaders: timeEntry records to `uploader`, then idleEvent records to `idleUploader`; each is
/// removed on confirmed success (2xx). Idempotent on the UUIDv7, so a retried record is a no-op. A
/// transient/auth failure stops the cycle (time-entry failures skip the idle pass) and the caller
/// backs off; a permanent 4xx record is dropped so a poison record can't wedge the queue. Stale
/// records still age-prune each cycle. Not a capture path → not gated by AckGate. The
/// timer/scheduling glue is build-verified; `syncNow()`/`drain` are unit-tested.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `swift test --filter SyncEngineTests` (from `apps/client-macos/`, Xcode toolchain active)
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Sync/SyncEngine.swift apps/client-macos/Tests/TimeTrackTests/SyncEngineTests.swift
git commit -m "feat(client): drain idle events through a second sync pass"
```

---

### Task 6: Client — wire the idle uploader + correct stale docs

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/Sync/TimeEntryUploader.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/Storage/BufferStore.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/Tracking/IdleEventPayload.swift`
- Modify: `PRD.md`

**Interfaces:**

- Consumes: `TimeEntryUploader.init` gains an optional `path: String = "time-entries"`; `SyncEngine.init(...idleUploader:...)` from Task 5.
- Produces: a running `SyncEngine` whose `idleUploader` posts to `/v1/idle-events`. This is build-verified wiring (like the existing timer glue); the drain logic itself is unit-tested in Task 5.

- [ ] **Step 1: Parameterize the uploader path**

Edit `apps/client-macos/Sources/TimeTrack/Sync/TimeEntryUploader.swift`. Add the `path` field + init parameter and use it in `post`. Update the class doc comment to note the configurable path:

```swift
/// PRD §7.5 — POSTs a buffered record payload to `<baseURL>/<path>` (default `time-entries`;
/// idle events pass `idle-events`) with the session bearer token. The API upserts on the
/// client-minted UUIDv7, so a retried record is a no-op. On a 401 it forces a token refresh and
/// retries once (mirrors PolicyClient/ProjectClient); a surviving 401 → authFailed. Not a capture
/// path — no AckGate.
final class TimeEntryUploader: Uploading {
    private let baseURL: URL
    private let session: AuthSession
    private let path: String

    init(baseURL: URL, session: AuthSession, path: String = "time-entries") {
        self.baseURL = baseURL
        self.session = session
        self.path = path
    }
```

In `post(_:token:)`, change the URL construction:

```swift
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
```

(`classify(status:)` is unchanged — 200/201 → success — so `TimeEntryUploaderTests` still passes as written.)

- [ ] **Step 2: Verify the uploader still builds and its tests pass**

Run: `swift test --filter TimeEntryUploaderTests` (from `apps/client-macos/`)
Expected: PASS — unchanged classify behavior; the new `path` parameter has a default so no call site breaks yet.

- [ ] **Step 3: Wire the idle uploader in AppDelegate**

Edit `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift` — `startSyncIfNeeded()`. Construct both uploaders from the same base URL + session and pass the idle one:

```swift
    @MainActor private func startSyncIfNeeded() {
        guard syncEngine == nil else { return }
        let base = AppDelegate.apiBaseURL()
        let engine = SyncEngine(
            buffer: BufferStore.shared,
            uploader: TimeEntryUploader(baseURL: base, session: session),
            idleUploader: TimeEntryUploader(baseURL: base, session: session, path: "idle-events")
        )
        syncEngine = engine
        engine.start()
    }
```

- [ ] **Step 4: Correct the now-false comments**

In `apps/client-macos/Sources/TimeTrack/Storage/BufferStore.swift`:

- Line ~4 (`BufferKind` doc): change `used to route on drain (SyncEngine syncs timeEntry only).` to `used to route on drain (SyncEngine syncs each kind to its own endpoint).`
- The `prune(olderThan:)` doc comment: replace the parenthetical `(undeliverable entries and idleEvent records with no endpoint yet)` and the trailing sentence about "endpoint-less records" with:

```swift
    /// Drops records created before `now - maxAge`, bounding the buffer against records that never
    /// deliver. Both kinds are drained and removed on 2xx, so only stuck records ever age out.
```

In `apps/client-macos/Sources/TimeTrack/Tracking/IdleEventPayload.swift`, update the doc comment's final sentence `Buffered like a TimeEntry; sync (1.7d) routes it to its own endpoint.` to `Buffered like a TimeEntry and drained by SyncEngine to POST /v1/idle-events.`

- [ ] **Step 5: Update PRD §7.9**

In `PRD.md`, replace the bullet at line ~511 (`**Client sync covers time-entries only (Phase 1).** …`) with:

```markdown
- **Client sync covers time-entries and idle-events.** `SyncEngine` drains both kinds from the durable buffer — time-entries to `POST /v1/time-entries`, idle-events to `POST /v1/idle-events` — each idempotent on the client-minted UUIDv7. A time-entry transient/auth failure stops the cycle before the idle pass. `SyncEngine` is not gated by `AckGate` (it transmits the employee's own already-recorded records) and, on sign-out, flushes-then-clears the buffer so a subsequent user cannot upload the prior user's records under their own token. The server stores each idle event as an audit/analytics row; it does **not** reconcile or delete overlapping time entries on a `DISCARDED` event (the client already decided what span to record).
```

- [ ] **Step 6: Build the client and run its full test suite**

Run (from `apps/client-macos/`): `swift build && swift test`
Expected: PASS — all suites green, including `SyncEngineTests`, `TimeEntryUploaderTests`, and `AutoTrackingCoordinatorTests`.

- [ ] **Step 7: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Sync/TimeEntryUploader.swift apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift apps/client-macos/Sources/TimeTrack/Storage/BufferStore.swift apps/client-macos/Sources/TimeTrack/Tracking/IdleEventPayload.swift PRD.md
git commit -m "feat(client): route idle events to POST /v1/idle-events"
```

---

### Task 7: Full-gate verification

**Files:** none (verification only).

- [ ] **Step 1: Run the workspace gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. `pnpm test` runs unit suites (contracts idle tests, api idle-events service + controller specs). The e2e suite is gated behind `RUN_E2E=1` and is not part of `pnpm test`.

- [ ] **Step 2: Run the API e2e against real Postgres**

Ensure Docker is running. Run: `RUN_E2E=1 pnpm --filter api test:e2e`
Expected: PASS — including `idle-events repository — real Postgres` (store + idempotency).

- [ ] **Step 3: Run the client test suite**

Run (from `apps/client-macos/`, Xcode toolchain active): `swift build && swift test`
Expected: PASS.

- [ ] **Step 4: End-to-end drain sanity check (the 201-vs-classify trap)**

This confirms a real buffered idle event is _removed_ on success, not merely that the endpoint 2xxs. `testDrainsIdleEventsToIdleUploaderAndRemovesOnSuccess` (Task 5) already asserts the buffer is emptied on `.success`, and `IdleEventsController` returns 201 (which `classify()` maps to `.success`). Confirm both are true in the committed code: the controller has **no** `@HttpCode(202)`, and the drain test asserts `buffer.take(kind: .idleEvent, limit: 10).isEmpty`.

- [ ] **Step 5: No commit** — this task only verifies. If any gate fails, fix under the owning task and re-run.

---

## Self-Review

**Spec coverage:**

- Contracts request reuse + response type → Task 1. ✅
- API module (repository/service/controller/module/registration) → Tasks 2–4. ✅
- Idempotent upsert on UUIDv7 → Task 2 (repo) + e2e. ✅
- Self-attribution, no `@ResourceScope`, 201 not 202 → Tasks 3–4. ✅
- Spec files (service + controller unit, repo e2e) — not inheriting activity's gap → Tasks 2–4. ✅
- 401-unauthenticated (not 403) auth assertion → Task 4 controller spec (asserts route not `@Public`). ✅
- Server stores record only, no reconciliation → documented in Task 2 repo comment + PRD update (Task 6). ✅
- Client second drain pass routing `.idleEvent` → Task 5. ✅
- Uploader path parameterization + AppDelegate wiring → Task 6. ✅
- Stale-comment fixes (BufferStore, SyncEngine header, IdleEventPayload) + PRD §7.9 → Tasks 5–6. ✅
- Full gate + client `swift test` → Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code.

**Type consistency:** `IdleEventResult` = `{ id, resolvedAction }` used identically in contracts (Task 1), repository return (Task 2), service return (Task 3), controller return (Task 4). `SyncEngine.init(buffer:uploader:idleUploader:…)` defined in Task 5 is exactly the signature called in Task 6's AppDelegate wiring and in every Task 5 test. `TimeEntryUploader.init(baseURL:session:path:)` defined in Task 6 matches its two call sites. `drain(kind:using:)` named consistently in the SyncEngine body and its doc.
