# Slice: idle-events — design

**Date:** 2026-07-14
**Branch:** `slice-idle-events`
**Scope:** end-to-end (API endpoint + client drain wiring)

## Goal

Close the loss loop. The macOS client already records `IdleEvent`s (KEPT /
DISCARDED / UNRESOLVED away windows) into its durable buffer via
`AutoTrackingCoordinator`, but they never leave the machine: `SyncEngine` drains
only `.timeEntry`, so buffered idle events are age-pruned into oblivion. This
slice adds the server ingest endpoint and wires the client to drain idle events
to it.

## Current state (verified)

- **DB:** `IdleEvent` model already exists in `packages/db/prisma/schema.prisma`
  (`id`, `userId`, `startTime`, `endTime`, `resolvedAction`, index on
  `[userId, startTime]`, mapped to `idle_events`). **No migration needed.** It is
  a plain table — not partitioned like `activity_samples` / `screenshots`.
- **Contracts:** `packages/contracts/src/idle.ts` already defines
  `ResolvedAction` and `IdleEventSchema` (`id`, `startTime`, `endTime`,
  `resolvedAction`). That schema **is** the client payload — `userId` comes from
  the session, never the body.
- **Client:** `AutoTrackingCoordinator.enqueueIdleEvent` writes `IdleEventPayload`
  records to `BufferStore` with `kind: .idleEvent`. `SyncEngine.syncNow()` drains
  only `.timeEntry`; idle events are left buffered and age-pruned.
- **No endpoint:** `PRD §7.9` line 511 states this explicitly ("There is no
  idle-events endpoint yet"). §7.9 is kept in sync with code, so it is updated in
  this slice.

## Design

### 1. Contracts — `packages/contracts/src/idle.ts`

- Reuse the existing `IdleEventSchema` as the request schema unchanged.
- Add a response type — `IdleEventResultSchema` returning the stored row's
  identity (`{ id, resolvedAction }`) — so the controller has an inferred return
  type rather than a hand-written interface.
- Export the new type from `packages/contracts/src/index.ts`.

### 2. API — new module `apps/api/src/modules/idle-events/`

A vertical slice with the standard six files. Structure is templated off the
`activity` module (self-attributed ingest, no `@ResourceScope`); test discipline
is templated off `time-entries` (activity ships with no specs — that gap is **not**
inherited).

- **`idle-events.controller.ts`** — `@Controller('idle-events')`, served under
  `/v1`. `@Post()` with `@Body(new ZodValidationPipe(IdleEventSchema))` and
  `@CurrentUser()`. Returns Nest's **default 201** — see Trap 1. No
  `@ResourceScope`: the record is always the caller's, exactly like activity
  samples; there is no `userId` in the request to scope.
- **`idle-events.service.ts`** — attributes the event to `user.id`, delegates to
  the repository. No Prisma.
- **`idle-events.repository.ts`** — `prisma.idleEvent.upsert` keyed on the
  client-minted `id`, so a retried drain is a no-op (idempotent). Insert/upsert
  only: no `AuditLog` row (that is for deletes), no partition key concerns.
- **`idle-events.service.spec.ts`** — unit (Vitest, no DB): the service attributes
  the event to the session user and delegates to the repo.
- **`idle-events.e2e-spec.ts`** — integration (Testcontainers, real Postgres):
  ingest returns 201; a re-POST of the same `id` is idempotent (still 201, one
  row); an unauthenticated request returns **401**. There is no 403 resource test
  because the body carries no `userId` to scope on.
- Register `IdleEventsModule` in `apps/api/src/app.module.ts`.

**The server stores the record only.** It does not reconcile or delete
overlapping time entries on a `DISCARDED` event. The client already decided what
span to record (it skips the bridge `TimeEntry` on discard); the `IdleEvent` is
an audit / analytics row and nothing more.

### 3. Client — drain idle events

- Add an idle-event uploader hitting `/v1/idle-events`. Preferred implementation:
  parameterize `TimeEntryUploader`'s path (it is otherwise identical — same
  `Uploading` protocol, `classify()`, and 401-refresh-retry), rather than
  duplicating the type. Decide during implementation based on which reads cleaner.
- Add a second drain pass in `SyncEngine.syncNow()` for `.idleEvent`, reusing the
  existing per-record logic: success → remove, permanent → drop, transient /
  authFailed → stop the cycle and back off.
- Update the now-false comments: `BufferStore.prune` ("idleEvent records with no
  endpoint yet"), the `SyncEngine` header doc, and `IdleEventPayload` header.
- Update `PRD §7.9` line 511 to reflect that the client now syncs idle events.

## Traps to verify at the end (not assume)

1. **Return 201, not 202.** The client's `TimeEntryUploader.classify()` maps only
   `200`/`201` → `.success`; **`202` falls through to `default → .transient`**. The
   `activity` module (the closest structural template) returns `@HttpCode(202)`.
   Copying that while reusing `classify()` would classify every idle record as
   transient — it is never removed and loops forever while the endpoint looks
   healthy. Return 201, and **verify the full drain removes the record on
   success**, not merely that the endpoint 2xxs.
2. **Spec files exist.** The `activity` module has no `.spec.ts` / `.e2e-spec.ts`.
   CLAUDE.md §5 requires them; this slice writes both.

## Testing

- **Unit** (Vitest, no DB): service attributes to the session user.
- **Integration / e2e** (Testcontainers, real Postgres 18): ingest 201, idempotent
  re-POST, 401 unauthenticated.
- **Client** (`swift test`, `DEVELOPER_DIR=Xcode`): the idle drain pass removes a
  buffered idle record on success and stops-and-backs-off on transient failure —
  mirrors the existing time-entry drain test.
- **Full gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Out of scope

- No GET / read endpoint for idle events (matches `PRD §7.8`; dashboard surfacing
  is a later rollup slice).
- No dashboard UI.
- No server-side reconciliation of time entries against idle windows.
