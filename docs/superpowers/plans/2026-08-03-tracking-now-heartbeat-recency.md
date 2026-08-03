# Heartbeat-gated "tracking now" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Overview "N clients tracking now" count (and the "Currently tracking" KPI) require a live activity-sample heartbeat, not merely an open time entry, so a never-closed entry no longer reads as tracking forever.

**Architecture:** The API computes `tracking` in `reports.repository.ts`'s raw overview query. Add a per-user `EXISTS` check against `activity_samples` within a configurable freshness window. The window is a new env var, provided to `ReportsService` by a module factory and passed as a query parameter into the repository (repo stays a pure function of its args; service stays unit-testable).

**Tech Stack:** NestJS 11 (Fastify), Prisma 7 (raw `$queryRaw`), PostgreSQL 18 (monthly-partitioned `activity_samples`), Zod 4 env schema (`@timetrack/config`), Vitest + Testcontainers for the API e2e suite.

## Global Constraints

- **Contracts unchanged.** `tracking` stays `z.boolean()` in `packages/contracts`. No schema/migration/dependency change.
- **Repo = Prisma only.** The freshness window is passed **into** the repository as a method argument; the repository does **not** read env. `PrismaClient` stays confined to `*.repository.ts`.
- **No `loadEnv()` in `ReportsService`.** It has an env-free unit spec; env is read by a module factory and injected as a number (explicit DI token — also sidesteps the vitest DI-metadata gap).
- **Time authority is SQL `now()`.** The window is applied as `now() - make_interval(secs => $n)`; `freshnessSeconds` is a **bound** integer param (`Prisma.sql`), never string-interpolated.
- **Env var shape** mirrors `PRESIGNED_URL_TTL_SECONDS`: `z.coerce.number().int().min(60).max(3600).default(300)`.
- **e2e is gated:** the API e2e suite runs under `RUN_E2E=1` with Docker (`pnpm --filter api test:e2e`). Committing "done" on Task 2 requires actually running it and seeing it green.
- No AI attribution in commits. `type(scope)` per repo convention; scope `api` or `contracts` here.

---

### Task 1: Add the `TRACKING_FRESHNESS_SECONDS` env var

**Files:**

- Modify: `packages/config/src/index.ts` (Zod env schema)
- Modify: `.env.example`

**Interfaces:**

- Produces: `loadEnv().TRACKING_FRESHNESS_SECONDS: number` (validated, default 300), consumed by Task 2's module factory.

Note on testing: `packages/config` has no test harness and is not under the 80% coverage gate; do **not** add a spec file here (scope creep). This task's deliverable is verified by typecheck + build; its runtime effect is exercised by Task 2's e2e default and manual check.

- [ ] **Step 1: Add the env var to the schema**

In `packages/config/src/index.ts`, add this line immediately after `PRESIGNED_URL_TTL_SECONDS` (keep the same style/placement in the object):

```ts
    TRACKING_FRESHNESS_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
```

- [ ] **Step 2: Document it in `.env.example`**

In `.env.example`, add directly under the `PRESIGNED_URL_TTL_SECONDS=300` line:

```
# How fresh (seconds) a client's last activity sample must be to count as "tracking now"
# on the Overview. Default 5 min; range 60–3600.
TRACKING_FRESHNESS_SECONDS=300
```

- [ ] **Step 3: Build the config package to verify it compiles**

Run: `pnpm --filter @timetrack/config build`
Expected: builds clean (the new key is part of the inferred `Env` type).

- [ ] **Step 4: Commit**

```bash
git add packages/config/src/index.ts .env.example
git commit -m "feat(api): add TRACKING_FRESHNESS_SECONDS env var

Freshness window (default 300s) for heartbeat-gated 'tracking now'."
```

---

### Task 2: Gate `tracking` on a recent heartbeat (repo query + DI wiring + tests)

This task is atomic: the repository signature change, the service/module wiring, and the spec updates must land together to compile. TDD is achieved by threading the new parameter and updating the tests **first** (keeping the old SQL, so the new regression case fails red), then changing the SQL (green).

**Files:**

- Modify: `apps/api/src/modules/reports/reports.repository.ts` (`overviewForTeam`, `overviewForSelf`, private `overview`, the `tracking` SQL)
- Modify: `apps/api/src/modules/reports/reports.module.ts` (token + factory provider)
- Modify: `apps/api/src/modules/reports/reports.service.ts` (`@Inject` the number, pass it through)
- Modify: `apps/api/src/modules/reports/reports.service.spec.ts` (construct with the number; update `toHaveBeenCalledWith`)
- Modify: `apps/api/test/reports.e2e-spec.ts` (thread the arg through overview calls; fix the running-entry test; add regression cases)

**Interfaces:**

- Consumes: `loadEnv().TRACKING_FRESHNESS_SECONDS` (Task 1).
- Produces (new repo signatures):
  ```ts
  overviewForTeam(teamId: string, dayStart: Date, dayEnd: Date, freshnessSeconds: number): Promise<OverviewRow[]>
  overviewForSelf(userId: string, dayStart: Date, dayEnd: Date, freshnessSeconds: number): Promise<OverviewRow[]>
  ```
- New DI token (export from `reports.module.ts`): `export const TRACKING_FRESHNESS_SECONDS = Symbol('TRACKING_FRESHNESS_SECONDS');`

- [ ] **Step 1: Thread `freshnessSeconds` through the repository signatures (old SQL unchanged)**

In `reports.repository.ts`, add the 4th param to both public methods and the private helper, and pass it down — but do **not** change the SQL yet:

```ts
  overviewForTeam(teamId: string, dayStart: Date, dayEnd: Date, freshnessSeconds: number): Promise<OverviewRow[]> {
    return this.overview(Prisma.sql`u."teamId" = ${teamId}`, dayStart, dayEnd, freshnessSeconds);
  }

  overviewForSelf(userId: string, dayStart: Date, dayEnd: Date, freshnessSeconds: number): Promise<OverviewRow[]> {
    return this.overview(Prisma.sql`u.id = ${userId}`, dayStart, dayEnd, freshnessSeconds);
  }

  private async overview(scope: Prisma.Sql, dayStart: Date, dayEnd: Date, freshnessSeconds: number): Promise<OverviewRow[]> {
```

Reference `freshnessSeconds` once (e.g. `void freshnessSeconds;`) if needed to satisfy no-unused-vars until Step 5 wires it into the SQL — remove that line in Step 5.

- [ ] **Step 2: Add the DI token + factory provider in the module**

In `reports.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { loadEnv } from '@timetrack/config';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { ReportsRepository } from './reports.repository.js';

export const TRACKING_FRESHNESS_SECONDS = Symbol('TRACKING_FRESHNESS_SECONDS');

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsRepository,
    { provide: TRACKING_FRESHNESS_SECONDS, useFactory: () => loadEnv().TRACKING_FRESHNESS_SECONDS },
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
```

- [ ] **Step 3: Inject the number into the service and pass it to the repo**

In `reports.service.ts`: import `Inject` from `@nestjs/common` and the token from the module, add the constructor param, and pass it into both calls (lines ~42–43):

```ts
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { TRACKING_FRESHNESS_SECONDS } from './reports.module.js';
// ...
  constructor(
    private readonly repo: ReportsRepository,
    private readonly access: ResourceAccessService,
    @Inject(TRACKING_FRESHNESS_SECONDS) private readonly trackingFreshnessSeconds: number,
  ) {}
// ...
      user.role === 'EMPLOYEE'
        ? await this.repo.overviewForSelf(user.id, dayStart, dayEnd, this.trackingFreshnessSeconds)
        : await this.repo.overviewForTeam(user.teamId, dayStart, dayEnd, this.trackingFreshnessSeconds);
```

(If a circular import between service and module is a concern, define the token in a tiny `reports.tokens.ts` and import it from both. Prefer keeping it in the module unless the import cycle actually bites at build.)

- [ ] **Step 4: Update the service unit spec (still env-free)**

In `reports.service.spec.ts`, both hand-built constructions must pass a literal window, and the call assertions must expect the 4th arg. In the `make()` helper:

```ts
return { svc: new ReportsService(repo, access, 300), repo };
```

Update each `toHaveBeenCalledWith(...)` for `overviewForTeam` / `overviewForSelf` to include the 4th argument, e.g.:

```ts
expect(repo.overviewForTeam).toHaveBeenCalledWith(
  't1',
  new Date('2026-07-12T00:00:00.000Z'),
  new Date('2026-07-13T00:00:00.000Z'),
  300,
);
// and the expect.any(Date) variants:
expect(repo.overviewForTeam).toHaveBeenCalledWith('t1', expect.any(Date), expect.any(Date), 300);
expect(repo.overviewForSelf).toHaveBeenCalledWith('u1', expect.any(Date), expect.any(Date), 300);
```

- [ ] **Step 5: Add a heartbeat `seedSample` helper + update/author the e2e tests (author them against the NEW behavior)**

In `apps/api/test/reports.e2e-spec.ts`, in the first `describe('reports repository — overview ...')`:

Add a small window constant and a sample-seeding helper near the top of the describe (mirrors the existing `app-usage` `seedSample`, but minimal — only what these tests need):

```ts
const WINDOW = 300; // freshnessSeconds for these assertions
let sampleSeq = 0;
async function seedSample(userId: string, ts: Date) {
  await db.prisma.activitySample.create({
    data: {
      id: `019797a0-0000-7000-8000-0000000005${String(sampleSeq++).padStart(2, '0')}`,
      userId,
      timestamp: ts,
      appName: 'Code',
      windowTitle: null,
      activityPct: 50,
      category: 'PRODUCTIVE',
    },
  });
}
```

Add `WINDOW` as the 4th arg to **every** `overviewForTeam` / `overviewForSelf` call in this file (current lines 54, 77, 96, 105, 114, 133).

Fix the existing **"a running entry sets tracking=true and counts live elapsed"** test: after creating the open entry, seed a fresh sample so the heartbeat gate passes:

```ts
await seedSample(user.id, new Date()); // fresh heartbeat within WINDOW
const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
expect(row.tracking).toBe(true);
```

Add three regression tests in the same describe:

```ts
it('open entry + fresh heartbeat → tracking=true', async () => {
  const team = await seedTeam();
  const user = await seedUser(team.id, 'Ada', 'ada@example.com');
  const dayStart = new Date(Date.now() - 3_600_000);
  const dayEnd = new Date(Date.now() + 3_600_000);
  await db.prisma.timeEntry.create({
    data: {
      id: '019797a0-0000-7000-8000-000000000110',
      userId: user.id,
      source: 'AUTO',
      startTime: new Date(Date.now() - 60_000),
      endTime: null,
    },
  });
  await seedSample(user.id, new Date()); // now
  const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
  expect(row.tracking).toBe(true);
});

it('open entry + STALE heartbeat → tracking=false (regression)', async () => {
  const team = await seedTeam();
  const user = await seedUser(team.id, 'Ada', 'ada@example.com');
  const dayStart = new Date(Date.now() - 3_600_000);
  const dayEnd = new Date(Date.now() + 3_600_000);
  await db.prisma.timeEntry.create({
    data: {
      id: '019797a0-0000-7000-8000-000000000111',
      userId: user.id,
      source: 'AUTO',
      startTime: new Date(Date.now() - 60_000),
      endTime: null, // open, but…
    },
  });
  await seedSample(user.id, new Date(Date.now() - 10 * 60_000)); // 10 min ago, outside WINDOW
  const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
  expect(row.tracking).toBe(false); // fails against pre-fix SQL (returns true)
});

it('fresh heartbeat but NO open entry → tracking=false', async () => {
  const team = await seedTeam();
  const user = await seedUser(team.id, 'Ada', 'ada@example.com');
  const dayStart = new Date(Date.now() - 3_600_000);
  const dayEnd = new Date(Date.now() + 3_600_000);
  await db.prisma.timeEntry.create({
    data: {
      id: '019797a0-0000-7000-8000-000000000112',
      userId: user.id,
      source: 'AUTO',
      startTime: new Date(Date.now() - 120_000),
      endTime: new Date(Date.now() - 60_000), // closed
    },
  });
  await seedSample(user.id, new Date());
  const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
  expect(row.tracking).toBe(false);
});
```

- [ ] **Step 6: Run the e2e suite and watch the regression test FAIL (old SQL still ignores the heartbeat)**

Run: `cd apps/api && RUN_E2E=1 pnpm test:e2e -- reports.e2e-spec.ts`
Expected: the **"open entry + STALE heartbeat → tracking=false (regression)"** test FAILS (pre-fix SQL returns `tracking=true`). The other overview tests pass (the running-entry test now seeds a fresh sample). This proves the test bites.
(Requires Docker + Testcontainers. If Docker is unavailable in this environment, note it and run in Step 8's full gate.)

- [ ] **Step 7: Change the `tracking` SQL to require a recent heartbeat**

In `reports.repository.ts`, replace the `tracking` SELECT expression (currently line ~56) with:

```sql
        (
          COALESCE(bool_or(te.id IS NOT NULL AND te."endTime" IS NULL), false)
          AND EXISTS (
            SELECT 1 FROM activity_samples a
            WHERE a."userId" = u.id
              AND a."timestamp" > now() - make_interval(secs => ${freshnessSeconds})
          )
        ) AS "tracking",
```

`${freshnessSeconds}` is interpolated by `Prisma.sql` as a **bound parameter** (this query is already a `Prisma.sql` template). Remove the temporary `void freshnessSeconds;` from Step 1. Leave the rest of the query (the `trackedSeconds` clamp, LEFT JOIN, `deactivatedAt` filter, `GROUP BY`, `ORDER BY`) unchanged.

- [ ] **Step 8: Run the e2e suite again — all green**

Run: `cd apps/api && RUN_E2E=1 pnpm test:e2e -- reports.e2e-spec.ts`
Expected: PASS, including the stale-heartbeat regression test now reading `tracking=false`.

- [ ] **Step 9: Full gate**

Run from repo root:

```bash
pnpm --filter @timetrack/contracts... typecheck
pnpm --filter api lint && pnpm --filter api typecheck && pnpm --filter api test && pnpm --filter api build
```

(And `pnpm --filter api test:coverage` if Docker is available — it runs unit+e2e with the 80% gate.)
Expected: all green. The service unit spec passes with the 4-arg assertions; the repo builds with the new signature.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/reports/reports.repository.ts \
        apps/api/src/modules/reports/reports.module.ts \
        apps/api/src/modules/reports/reports.service.ts \
        apps/api/src/modules/reports/reports.service.spec.ts \
        apps/api/test/reports.e2e-spec.ts
git commit -m "fix(api): gate 'tracking now' on a recent activity heartbeat

An open time entry alone marked a user 'tracking' forever. Require an
activity_samples heartbeat within TRACKING_FRESHNESS_SECONDS (default 5 min),
passed from the reports module into the overview query. Regression test: an
open entry with a stale heartbeat now reads tracking=false."
```

---

## Self-Review

**Spec coverage:** §3 definition → Task 2 Step 7 SQL. §4 signatures → Task 2 Steps 1/3. §5 config + wiring → Task 1 + Task 2 Steps 2–4. §6 tests (3 cases + running-entry fix) → Task 2 Step 5. Env var → Task 1. All covered.

**Placeholder scan:** every code step has concrete code; test bodies are complete; the SQL is spelled out. No TBD/TODO.

**Type consistency:** `freshnessSeconds: number` is used identically in repo signatures (Steps 1), service call sites (Step 3), and e2e calls (Step 5, `WINDOW = 300`). The DI token `TRACKING_FRESHNESS_SECONDS` (a `symbol`) is defined in the module (Step 2) and imported by the service (Step 3). Service constructor arity (3) matches the unit-spec constructions (Step 4). The e2e `seedSample` writes an `activitySample` row shaped exactly like the existing app-usage helper.
