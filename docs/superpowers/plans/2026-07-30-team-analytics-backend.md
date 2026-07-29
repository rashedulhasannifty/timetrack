# Team Analytics Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three team-scoped, range-based read endpoints to the API's `reports` module — `GET /reports/trends`, `GET /reports/team-activity`, `GET /reports/app-usage` — that aggregate existing data to power the redesigned manager Overview.

**Architecture:** Extend the existing `reports` vertical slice (contracts → repository raw SQL → service scope/authz → controller). No new module, no schema change, no worker. Repository correctness is proven against real Postgres in `apps/api/test/*.e2e-spec.ts`; scope/403 logic is unit-tested with a mocked repo in `reports.service.spec.ts`; delegation in `reports.controller.spec.ts`; Zod round-trips in `packages/contracts/src/reports.spec.ts`.

**Tech Stack:** NestJS 11 (Fastify), Prisma 7 `$queryRaw` (pg adapter), Zod 4, Vitest, Testcontainers (real PG 18). Package filters: `pnpm --filter api …`, `pnpm --filter @timetrack/contracts …`.

## Global Constraints

- **Contracts only in `packages/contracts/src/reports.ts`.** Types are `z.infer`, never hand-written. Use Zod 4 top-level helpers (`z.uuid()`, `z.iso.date()`), not `z.string().uuid()`.
- **Prisma only in `*.repository.ts`.** No `PrismaClient` in controller/service.
- **Scope is actor-derived.** The service calls `resolveScope(query, user)` (throws 403) before any query; the repo only translates scope to SQL via the existing private `scopeSql(scope, col)`. A client `teamId`/`userId` can only narrow within what the actor may see.
- **Controller pipe scoped to the parameter:** `@Query(new ZodValidationPipe(Schema))`, never method-level `@UsePipes`.
- **403 tests, not just 200.** A MANAGER passing another team's `teamId` must 403.
- **No mocked Prisma in correctness tests.** Repo tests run against real Postgres via `startTestDb()`.
- **Category values are exactly `PRODUCTIVE | NEUTRAL | UNPRODUCTIVE`** (import `Category` from `packages/contracts/src/enums.js`). `byCategory`/`byApp` JSON values are **minutes** and the map is **partial** (zero categories omitted) → every extraction is `COALESCE((… ->> 'X')::int, 0)`; category **seconds** = `minutes × 60`.
- **Commit hygiene:** Conventional Commits, scope `api` or `contracts`, no AI attribution/co-author/footer. One logical change per commit.
- **Coverage:** the 80% gate is measured by `test:coverage` (unit + e2e together, `RUN_E2E=1` + Docker); `functions` is the binding metric. Every new repo method must be exercised by an e2e test.
- **Branch:** all work lands on `dashboard/team-analytics-backend` (already checked out).

---

## File structure

- `packages/contracts/src/reports.ts` — **modify**: add `TeamTrendDaySchema`, `TeamTrendsSchema`, `TeamActivityRowSchema`, `TeamActivitySchema`, `TeamAppUsageRowSchema`, `TeamAppUsageSchema`, `AppUsageQuerySchema` + inferred types. (Barrel `index.ts` already re-exports `./reports.js` — no barrel edit.)
- `packages/contracts/src/reports.spec.ts` — **modify**: add parse/bounds tests for the new schemas.
- `apps/api/src/modules/reports/reports.repository.ts` — **modify**: add `trends()`, `teamActivity()`, `appUsage()`.
- `apps/api/src/modules/reports/reports.service.ts` — **modify**: add `trends()`, `teamActivity()`, `appUsage()`.
- `apps/api/src/modules/reports/reports.controller.ts` — **modify**: add three `@Get` handlers.
- `apps/api/src/modules/reports/reports.service.spec.ts` — **modify**: scope/403 unit tests (mocked repo).
- `apps/api/src/modules/reports/reports.controller.spec.ts` — **modify**: delegation tests.
- `apps/api/test/reports.e2e-spec.ts` — **modify**: repo correctness against real Postgres.

---

## Interfaces (defined here, consumed by every task)

Contract types (Task 1):

```ts
export type TeamTrendDay = {
  day: string; // 'YYYY-MM-DD'
  trackedSeconds: number;
  productiveSeconds: number;
  neutralSeconds: number;
  unproductiveSeconds: number;
};
export type TeamTrends = { from: string; to: string; days: TeamTrendDay[] };

export type TeamActivityRow = {
  userId: string;
  name: string;
  activeMinutes: number;
  productivePct: number;
  neutralPct: number;
  unproductivePct: number;
  idleMinutes: number;
  idlePct: number;
};
export type TeamActivity = { from: string; to: string; rows: TeamActivityRow[] };

export type TeamAppUsageRow = {
  appName: string;
  seconds: number;
  category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';
};
export type TeamAppUsage = { from: string; to: string; rows: TeamAppUsageRow[] };
export type AppUsageQuery = ReportRangeQuery & { limit: number };
```

Repository method signatures (Tasks 2–4), consumed by the service:

```ts
// ReportScope is the existing exported type: {kind:'team';teamId}|{kind:'user';userId}|{kind:'all'}
trends(scope: ReportScope, from: Date, to: Date): Promise<TeamTrendDay[]>;
teamActivity(scope: ReportScope, from: Date, to: Date): Promise<TeamActivityRow[]>;
appUsage(scope: ReportScope, from: Date, to: Date, limit: number): Promise<TeamAppUsageRow[]>;
```

Service method signatures (Tasks 2–4), consumed by the controller:

```ts
trends(query: ReportRangeQuery, user: SessionUser): Promise<TeamTrends>;
teamActivity(query: ReportRangeQuery, user: SessionUser): Promise<TeamActivity>;
appUsage(query: AppUsageQuery, user: SessionUser): Promise<TeamAppUsage>;
```

---

### Task 1: Contracts — the six response schemas + the app-usage query schema

**Files:**

- Modify: `packages/contracts/src/reports.ts`
- Test: `packages/contracts/src/reports.spec.ts`

**Interfaces:**

- Consumes: existing `ReportRangeQuerySchema` (same file), `Category` from `./enums.js`.
- Produces: the seven schemas + inferred types listed in the Interfaces block above.

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/src/reports.spec.ts`:

```ts
import {
  TeamTrendsSchema,
  TeamActivityRowSchema,
  TeamAppUsageRowSchema,
  AppUsageQuerySchema,
} from './reports.js';

describe('TeamTrendsSchema', () => {
  it('accepts a zero-filled day', () => {
    const parsed = TeamTrendsSchema.parse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
      days: [
        {
          day: '2026-07-01',
          trackedSeconds: 0,
          productiveSeconds: 0,
          neutralSeconds: 0,
          unproductiveSeconds: 0,
        },
      ],
    });
    expect(parsed.days).toHaveLength(1);
  });

  it('rejects a non-date day', () => {
    expect(() =>
      TeamTrendsSchema.parse({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-02T00:00:00.000Z',
        days: [
          {
            day: 'nope',
            trackedSeconds: 0,
            productiveSeconds: 0,
            neutralSeconds: 0,
            unproductiveSeconds: 0,
          },
        ],
      }),
    ).toThrow();
  });
});

describe('TeamActivityRowSchema', () => {
  it('rejects a pct over 100', () => {
    expect(() =>
      TeamActivityRowSchema.parse({
        userId: '019797a0-0000-7000-8000-000000000001',
        name: 'Ada',
        activeMinutes: 10,
        productivePct: 101,
        neutralPct: 0,
        unproductivePct: 0,
        idleMinutes: 0,
        idlePct: 0,
      }),
    ).toThrow();
  });
});

describe('TeamAppUsageRowSchema', () => {
  it('accepts a valid row and rejects a bad category', () => {
    expect(
      TeamAppUsageRowSchema.parse({ appName: 'Code', seconds: 60, category: 'PRODUCTIVE' }).seconds,
    ).toBe(60);
    expect(() =>
      TeamAppUsageRowSchema.parse({ appName: 'Code', seconds: 60, category: 'MEH' }),
    ).toThrow();
  });
});

describe('AppUsageQuerySchema', () => {
  it('defaults limit to 10 and coerces a string limit', () => {
    const d = AppUsageQuerySchema.parse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
    });
    expect(d.limit).toBe(10);
    const c = AppUsageQuerySchema.parse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
      limit: '5',
    });
    expect(c.limit).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @timetrack/contracts test -- reports`
Expected: FAIL — `TeamTrendsSchema`/etc. are not exported.

- [ ] **Step 3: Implement the schemas**

Append to `packages/contracts/src/reports.ts` (the file already imports `z`; add the `Category` import at the top if absent: `import { Category } from './enums.js';`):

```ts
export const TeamTrendDaySchema = z.object({
  day: z.iso.date(),
  trackedSeconds: z.number().int().nonnegative(),
  productiveSeconds: z.number().int().nonnegative(),
  neutralSeconds: z.number().int().nonnegative(),
  unproductiveSeconds: z.number().int().nonnegative(),
});
export const TeamTrendsSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  days: z.array(TeamTrendDaySchema),
});
export type TeamTrendDay = z.infer<typeof TeamTrendDaySchema>;
export type TeamTrends = z.infer<typeof TeamTrendsSchema>;

export const TeamActivityRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  activeMinutes: z.number().int().nonnegative(),
  productivePct: z.number().int().min(0).max(100),
  neutralPct: z.number().int().min(0).max(100),
  unproductivePct: z.number().int().min(0).max(100),
  idleMinutes: z.number().int().nonnegative(),
  idlePct: z.number().int().min(0).max(100),
});
export const TeamActivitySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  rows: z.array(TeamActivityRowSchema),
});
export type TeamActivityRow = z.infer<typeof TeamActivityRowSchema>;
export type TeamActivity = z.infer<typeof TeamActivitySchema>;

export const TeamAppUsageRowSchema = z.object({
  appName: z.string(),
  seconds: z.number().int().nonnegative(),
  category: Category,
});
export const TeamAppUsageSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  rows: z.array(TeamAppUsageRowSchema),
});
export type TeamAppUsageRow = z.infer<typeof TeamAppUsageRowSchema>;
export type TeamAppUsage = z.infer<typeof TeamAppUsageSchema>;

// app-usage takes an extra ?limit; query params arrive as strings, so coerce.
export const AppUsageQuerySchema = ReportRangeQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type AppUsageQuery = z.infer<typeof AppUsageQuerySchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @timetrack/contracts test -- reports`
Expected: PASS. Then `pnpm --filter @timetrack/contracts typecheck && pnpm --filter @timetrack/contracts build` — PASS (apps consume built `dist`).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/reports.ts packages/contracts/src/reports.spec.ts
git commit -m "feat(contracts): team trends, activity, and app-usage report schemas"
```

---

### Task 2: `GET /reports/trends` — daily hours + productivity series

**Files:**

- Modify: `apps/api/src/modules/reports/reports.repository.ts`
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Modify: `apps/api/src/modules/reports/reports.controller.ts`
- Test: `apps/api/test/reports.e2e-spec.ts` (repo correctness), `apps/api/src/modules/reports/reports.service.spec.ts` (scope), `apps/api/src/modules/reports/reports.controller.spec.ts` (delegation)

**Interfaces:**

- Consumes: `ReportScope`, `scopeSql(scope, col)` (existing private repo method), `resolveScope(query, user)` (existing private service method), `TeamTrendsSchema`/`TeamTrendDay` (Task 1).
- Produces: `ReportsRepository.trends`, `ReportsService.trends`, `ReportsController.trends` (signatures in the Interfaces block).

- [ ] **Step 1: Write the failing repo e2e test**

In `apps/api/test/reports.e2e-spec.ts`, add these tests **inside the existing** `describe.runIf(RUN_E2E)('reports repository — overview (real Postgres)', …)` block — that block already owns `db`, the `beforeAll(startTestDb)` / `afterEach(truncateAll)` lifecycle, and the `repo()` / `seedTeam` / `seedUser` helpers, and a **nested** `describe` inherits all of them. Add a nested `describe('trends', …)` with a local `seedSummary` helper:

```ts
// nested describe('trends', () => { … }) — inherits db + lifecycle + seedTeam/seedUser from the parent
async function seedSummary(
  userId: string,
  day: string,
  byCategory: Record<string, number>,
  activeMinutes: number,
) {
  await db.prisma.activityDailySummary.create({
    data: {
      userId,
      day: new Date(`${day}T00:00:00.000Z`),
      avgActivityPct: 50,
      activeMinutes,
      byApp: {},
      byCategory,
    },
  });
}

it('emits one zero-filled row per day and converts category minutes to seconds', async () => {
  const team = await seedTeam();
  const user = await seedUser(team.id, 'Ada', 'ada@example.com');
  await db.prisma.timeEntry.create({
    data: {
      id: '019797a0-0000-7000-8000-000000000201',
      userId: user.id,
      source: 'MANUAL',
      startTime: new Date('2026-07-12T09:00:00.000Z'),
      endTime: new Date('2026-07-12T10:00:00.000Z'), // 3600s on the 12th
    },
  });
  await seedSummary(user.id, '2026-07-12', { PRODUCTIVE: 30, UNPRODUCTIVE: 10 }, 40); // minutes

  const days = await repo().trends(
    { kind: 'team', teamId: team.id },
    new Date('2026-07-11T00:00:00.000Z'),
    new Date('2026-07-13T00:00:00.000Z'),
  );

  expect(days.map((d) => d.day)).toEqual(['2026-07-11', '2026-07-12', '2026-07-13']);
  const d12 = days.find((d) => d.day === '2026-07-12')!;
  expect(d12).toEqual({
    day: '2026-07-12',
    trackedSeconds: 3600,
    productiveSeconds: 30 * 60,
    neutralSeconds: 0,
    unproductiveSeconds: 10 * 60,
  });
  const d11 = days.find((d) => d.day === '2026-07-11')!;
  expect(d11).toEqual({
    day: '2026-07-11',
    trackedSeconds: 0,
    productiveSeconds: 0,
    neutralSeconds: 0,
    unproductiveSeconds: 0,
  });
});

it('clamps a midnight-spanning entry into each day', async () => {
  const team = await seedTeam();
  const user = await seedUser(team.id, 'Ada', 'ada@example.com');
  await db.prisma.timeEntry.create({
    data: {
      id: '019797a0-0000-7000-8000-000000000202',
      userId: user.id,
      source: 'MANUAL',
      startTime: new Date('2026-07-12T23:00:00.000Z'), // 1h on the 12th
      endTime: new Date('2026-07-13T01:00:00.000Z'), // 1h on the 13th
    },
  });
  const days = await repo().trends(
    { kind: 'team', teamId: team.id },
    new Date('2026-07-12T00:00:00.000Z'),
    new Date('2026-07-13T00:00:00.000Z'),
  );
  expect(days.find((d) => d.day === '2026-07-12')!.trackedSeconds).toBe(3600);
  expect(days.find((d) => d.day === '2026-07-13')!.trackedSeconds).toBe(3600);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports` (requires Docker for Testcontainers)
Expected: FAIL — `repo().trends` is not a function.

- [ ] **Step 3: Implement the repository method**

Add to `ReportsRepository` (after `teamSummary`). Day boundaries are built as explicit UTC so the result is independent of the session timezone:

```ts
async trends(scope: ReportScope, from: Date, to: Date): Promise<TeamTrendDay[]> {
  const rows = await this.prisma.$queryRaw<
    Array<{
      day: string;
      trackedSeconds: number | bigint;
      productiveSeconds: number | bigint;
      neutralSeconds: number | bigint;
      unproductiveSeconds: number | bigint;
    }>
  >`
    WITH days AS (
      SELECT generate_series(
        (${from}::timestamptz)::date,
        (${to}::timestamptz)::date,
        interval '1 day'
      )::date AS day
    ),
    cat AS (
      SELECT ads."day" AS day,
             SUM(COALESCE((ads."byCategory"->>'PRODUCTIVE')::int, 0))   * 60 AS "productiveSeconds",
             SUM(COALESCE((ads."byCategory"->>'NEUTRAL')::int, 0))      * 60 AS "neutralSeconds",
             SUM(COALESCE((ads."byCategory"->>'UNPRODUCTIVE')::int, 0)) * 60 AS "unproductiveSeconds"
      FROM activity_daily_summaries ads
      WHERE ads."day" BETWEEN (${from}::timestamptz)::date AND (${to}::timestamptz)::date
        AND (${this.scopeSql(scope, Prisma.sql`ads."userId"`)})
      GROUP BY ads."day"
    ),
    tracked AS (
      SELECT d.day,
             FLOOR(SUM(GREATEST(
               EXTRACT(EPOCH FROM (
                 LEAST(COALESCE(te."endTime", now()), ((d.day + 1)::timestamp) AT TIME ZONE 'UTC')
                 - GREATEST(te."startTime", (d.day::timestamp) AT TIME ZONE 'UTC')
               )), 0
             )))::int AS "trackedSeconds"
      FROM days d
      JOIN time_entries te
        ON te."startTime" < ((d.day + 1)::timestamp) AT TIME ZONE 'UTC'
       AND COALESCE(te."endTime", now()) > (d.day::timestamp) AT TIME ZONE 'UTC'
       AND (${this.scopeSql(scope, Prisma.sql`te."userId"`)})
      GROUP BY d.day
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS "day",
           COALESCE(t."trackedSeconds", 0)       AS "trackedSeconds",
           COALESCE(c."productiveSeconds", 0)    AS "productiveSeconds",
           COALESCE(c."neutralSeconds", 0)       AS "neutralSeconds",
           COALESCE(c."unproductiveSeconds", 0)  AS "unproductiveSeconds"
    FROM days d
    LEFT JOIN cat     c ON c.day = d.day
    LEFT JOIN tracked t ON t.day = d.day
    ORDER BY d.day ASC
  `;
  return rows.map((r) => ({
    day: r.day,
    trackedSeconds: Number(r.trackedSeconds),
    productiveSeconds: Number(r.productiveSeconds),
    neutralSeconds: Number(r.neutralSeconds),
    unproductiveSeconds: Number(r.unproductiveSeconds),
  }));
}
```

Add the import at the top of the file: `import type { TeamTrendDay } from '@timetrack/contracts';` (extend the existing type import).

- [ ] **Step 4: Run the repo e2e to verify it passes**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports`
Expected: PASS (both new trends cases).

- [ ] **Step 5: Write the failing service + controller unit tests**

In `reports.service.spec.ts`, extend the `makeReports()` repo mock with `trends: vi.fn().mockResolvedValue([])` and add:

```ts
describe('ReportsService.trends', () => {
  it('scopes a MANAGER with no params to their own team', async () => {
    const { svc, repo } = makeReports();
    await svc.trends(range, manager);
    expect(repo.trends).toHaveBeenCalledWith(
      { kind: 'team', teamId: 't1' },
      new Date(range.from),
      new Date(range.to),
    );
  });

  it('throws 403 when a MANAGER targets another team', async () => {
    const { svc } = makeReports();
    await expect(svc.trends({ ...range, teamId: 'other' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('gives an ADMIN the all-teams scope', async () => {
    const { svc, repo } = makeReports();
    await svc.trends(range, admin);
    expect(repo.trends).toHaveBeenCalledWith({ kind: 'all' }, expect.any(Date), expect.any(Date));
  });
});
```

In `reports.controller.spec.ts`, extend the service mock with `trends: vi.fn().mockResolvedValue({ from: 'x', to: 'y', days: [] })` and add:

```ts
it('trends delegates query + user', async () => {
  const { ctrl, service } = make();
  const query = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-14T00:00:00.000Z' };
  await ctrl.trends(query, user);
  expect(service.trends).toHaveBeenCalledWith(query, user);
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm --filter api test -- reports.service reports.controller`
Expected: FAIL — `svc.trends` / `ctrl.trends` are not functions.

- [ ] **Step 7: Implement service + controller**

In `reports.service.ts` add the import `TeamTrendsSchema, type TeamTrends` (and later `TeamActivitySchema`, `TeamAppUsageSchema`, `AppUsageQuery` for Tasks 3–4), then:

```ts
async trends(query: ReportRangeQuery, user: SessionUser): Promise<TeamTrends> {
  const scope = await this.resolveScope(query, user);
  const days = await this.repo.trends(scope, new Date(query.from), new Date(query.to));
  return TeamTrendsSchema.parse({ from: query.from, to: query.to, days });
}
```

In `reports.controller.ts` add (imports: `TeamTrendsSchema`? no — the query uses `ReportRangeQuerySchema`; add return type `type TeamTrends`):

```ts
@Get('trends')
trends(
  @Query(new ZodValidationPipe(ReportRangeQuerySchema)) query: ReportRangeQuery,
  @CurrentUser() user: SessionUser,
): Promise<TeamTrends> {
  return this.service.trends(query, user);
}
```

- [ ] **Step 8: Run to verify unit tests pass**

Run: `pnpm --filter api test -- reports.service reports.controller`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/reports apps/api/test/reports.e2e-spec.ts
git commit -m "feat(api): GET /reports/trends daily hours + productivity series"
```

---

### Task 3: `GET /reports/team-activity` — per-person category + idle rollup

**Files:** same four as Task 2.

**Interfaces:**

- Consumes: `ReportScope`, `scopeSql`, `resolveScope`, `TeamActivitySchema`/`TeamActivityRow` (Task 1).
- Produces: `ReportsRepository.teamActivity`, `ReportsService.teamActivity`, `ReportsController.teamActivity`.

- [ ] **Step 1: Write the failing repo e2e test**

Add a nested `describe('team-activity', …)` inside the same existing `describe.runIf(RUN_E2E)` block (inherits `db`, lifecycle, `seedTeam`, `seedUser`), with a local idle seeder:

```ts
async function seedIdle(userId: string, id: string, start: string, end: string) {
  await db.prisma.idleEvent.create({
    data: {
      id,
      userId,
      startTime: new Date(start),
      endTime: new Date(end),
      resolvedAction: 'KEEP',
    },
  });
}

it('computes category % of categorized minutes and idle % of idle+active', async () => {
  const team = await seedTeam();
  const user = await seedUser(team.id, 'Ada', 'ada@example.com');
  // 60 categorized min: 45 productive, 15 neutral; 90 active min total.
  await db.prisma.activityDailySummary.create({
    data: {
      userId: user.id,
      day: new Date('2026-07-12T00:00:00.000Z'),
      avgActivityPct: 70,
      activeMinutes: 90,
      byApp: {},
      byCategory: { PRODUCTIVE: 45, NEUTRAL: 15 },
    },
  });
  await seedIdle(
    user.id,
    '019797a0-0000-7000-8000-000000000301',
    '2026-07-12T12:00:00.000Z',
    '2026-07-12T12:10:00.000Z',
  ); // 10 min

  const rows = await repo().teamActivity(
    { kind: 'team', teamId: team.id },
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-07-31T00:00:00.000Z'),
  );

  expect(rows).toEqual([
    {
      userId: user.id,
      name: 'Ada',
      activeMinutes: 90,
      productivePct: 75,
      neutralPct: 25,
      unproductivePct: 0, // 45/60, 15/60
      idleMinutes: 10,
      idlePct: 10, // 10/(90+10)
    },
  ]);
});

it('omits a user with no activity or idle in range', async () => {
  const team = await seedTeam();
  await seedUser(team.id, 'Ghost', 'ghost@example.com');
  const rows = await repo().teamActivity(
    { kind: 'team', teamId: team.id },
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-07-31T00:00:00.000Z'),
  );
  expect(rows).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports`
Expected: FAIL — `repo().teamActivity` is not a function.

- [ ] **Step 3: Implement the repository method**

Add to `ReportsRepository`. Idle duration is window-clamped (mirrors the module's time-entry clamp); percentages use `NULLIF` to avoid divide-by-zero:

```ts
async teamActivity(scope: ReportScope, from: Date, to: Date): Promise<TeamActivityRow[]> {
  const rows = await this.prisma.$queryRaw<
    Array<{
      userId: string; name: string;
      activeMinutes: number | bigint;
      productivePct: number | bigint; neutralPct: number | bigint; unproductivePct: number | bigint;
      idleMinutes: number | bigint; idlePct: number | bigint;
    }>
  >`
    WITH cat AS (
      SELECT ads."userId" AS uid,
             SUM(ads."activeMinutes") AS active_min,
             SUM(COALESCE((ads."byCategory"->>'PRODUCTIVE')::int, 0))   AS prod,
             SUM(COALESCE((ads."byCategory"->>'NEUTRAL')::int, 0))      AS neut,
             SUM(COALESCE((ads."byCategory"->>'UNPRODUCTIVE')::int, 0)) AS unprod
      FROM activity_daily_summaries ads
      WHERE ads."day" BETWEEN (${from}::timestamptz)::date AND (${to}::timestamptz)::date
        AND (${this.scopeSql(scope, Prisma.sql`ads."userId"`)})
      GROUP BY ads."userId"
    ),
    idle AS (
      SELECT ie."userId" AS uid,
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(ie."endTime", ${to}::timestamptz) - GREATEST(ie."startTime", ${from}::timestamptz)
             )), 0)) / 60)::int AS idle_min
      FROM idle_events ie
      WHERE ie."startTime" < ${to}::timestamptz
        AND ie."endTime" > ${from}::timestamptz
        AND (${this.scopeSql(scope, Prisma.sql`ie."userId"`)})
      GROUP BY ie."userId"
    ),
    scoped AS (
      SELECT u.id, u.name FROM users u
      WHERE (${this.scopeSql(scope, Prisma.sql`u.id`)})
        AND (EXISTS (SELECT 1 FROM cat WHERE uid = u.id) OR EXISTS (SELECT 1 FROM idle WHERE uid = u.id))
    )
    SELECT s.id AS "userId", s.name AS "name",
           COALESCE(c.active_min, 0)::int AS "activeMinutes",
           COALESCE(ROUND(c.prod::numeric   * 100 / NULLIF(c.prod + c.neut + c.unprod, 0)), 0)::int AS "productivePct",
           COALESCE(ROUND(c.neut::numeric   * 100 / NULLIF(c.prod + c.neut + c.unprod, 0)), 0)::int AS "neutralPct",
           COALESCE(ROUND(c.unprod::numeric * 100 / NULLIF(c.prod + c.neut + c.unprod, 0)), 0)::int AS "unproductivePct",
           COALESCE(i.idle_min, 0)::int AS "idleMinutes",
           COALESCE(ROUND(COALESCE(i.idle_min, 0)::numeric * 100 / NULLIF(COALESCE(c.active_min, 0) + COALESCE(i.idle_min, 0), 0)), 0)::int AS "idlePct"
    FROM scoped s
    LEFT JOIN cat  c ON c.uid = s.id
    LEFT JOIN idle i ON i.uid = s.id
    ORDER BY s.name ASC
  `;
  return rows.map((r) => ({
    userId: r.userId, name: r.name,
    activeMinutes: Number(r.activeMinutes),
    productivePct: Number(r.productivePct),
    neutralPct: Number(r.neutralPct),
    unproductivePct: Number(r.unproductivePct),
    idleMinutes: Number(r.idleMinutes),
    idlePct: Number(r.idlePct),
  }));
}
```

Extend the top-of-file type import to include `TeamActivityRow`.

- [ ] **Step 4: Run the repo e2e to verify it passes**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports`
Expected: PASS.

- [ ] **Step 5: Write the failing service + controller unit tests**

In `reports.service.spec.ts` extend the repo mock with `teamActivity: vi.fn().mockResolvedValue([])` and add a `describe('ReportsService.teamActivity', …)` with the same three cases as Task 2 Step 5 (manager→own team, manager foreign team→403, admin→all), calling `svc.teamActivity(...)` / asserting `repo.teamActivity`.

In `reports.controller.spec.ts` extend the service mock with `teamActivity: vi.fn().mockResolvedValue({ from: 'x', to: 'y', rows: [] })` and add a delegation test calling `ctrl.teamActivity(query, user)`.

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm --filter api test -- reports.service reports.controller`
Expected: FAIL.

- [ ] **Step 7: Implement service + controller**

Service:

```ts
async teamActivity(query: ReportRangeQuery, user: SessionUser): Promise<TeamActivity> {
  const scope = await this.resolveScope(query, user);
  const rows = await this.repo.teamActivity(scope, new Date(query.from), new Date(query.to));
  return TeamActivitySchema.parse({ from: query.from, to: query.to, rows });
}
```

Controller:

```ts
@Get('team-activity')
teamActivity(
  @Query(new ZodValidationPipe(ReportRangeQuerySchema)) query: ReportRangeQuery,
  @CurrentUser() user: SessionUser,
): Promise<TeamActivity> {
  return this.service.teamActivity(query, user);
}
```

Add `TeamActivitySchema, type TeamActivity` to the service import and `type TeamActivity` to the controller import.

- [ ] **Step 8: Run to verify unit tests pass**

Run: `pnpm --filter api test -- reports.service reports.controller`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/reports apps/api/test/reports.e2e-spec.ts
git commit -m "feat(api): GET /reports/team-activity category + idle rollup"
```

---

### Task 4: `GET /reports/app-usage` — team-wide website/app breakdown

**Files:** same four as Task 2.

**Interfaces:**

- Consumes: `ReportScope`, `scopeSql`, `resolveScope`, `TeamAppUsageSchema`/`TeamAppUsageRow`, `AppUsageQuerySchema`/`AppUsageQuery` (Task 1). `ACTIVITY_SAMPLE_INTERVAL_SECONDS` is 60 (already assumed by the `topApps` precedent; the query hardcodes `* 60`).
- Produces: `ReportsRepository.appUsage`, `ReportsService.appUsage`, `ReportsController.appUsage`.

- [ ] **Step 1: Write the failing repo e2e test**

Add a nested `describe('app-usage', …)` inside the same existing `describe.runIf(RUN_E2E)` block (inherits `db`, lifecycle, `seedTeam`, `seedUser`), with a local sample seeder (seed within July 2026 — the `activity_samples_2026_07` partition exists):

```ts
let sampleSeq = 0;
async function seedSample(
  userId: string,
  appName: string,
  category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE',
  ts: string,
) {
  await db.prisma.activitySample.create({
    data: {
      id: `019797a0-0000-7000-8000-0000000004${String(sampleSeq++).padStart(2, '0')}`,
      userId,
      timestamp: new Date(ts),
      appName,
      windowTitle: null,
      activityPct: 50,
      category,
    },
  });
}

it('ranks apps by total seconds and picks the dominant category', async () => {
  const team = await seedTeam();
  const user = await seedUser(team.id, 'Ada', 'ada@example.com');
  // Code: 3 samples (2 PRODUCTIVE, 1 UNPRODUCTIVE) -> 180s, dominant PRODUCTIVE
  await seedSample(user.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:00:00.000Z');
  await seedSample(user.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:01:00.000Z');
  await seedSample(user.id, 'Code', 'UNPRODUCTIVE', '2026-07-12T09:02:00.000Z');
  // Slack: 1 sample NEUTRAL -> 60s
  await seedSample(user.id, 'Slack', 'NEUTRAL', '2026-07-12T09:03:00.000Z');

  const rows = await repo().appUsage(
    { kind: 'team', teamId: team.id },
    new Date('2026-07-12T00:00:00.000Z'),
    new Date('2026-07-13T00:00:00.000Z'),
    10,
  );

  expect(rows).toEqual([
    { appName: 'Code', seconds: 180, category: 'PRODUCTIVE' },
    { appName: 'Slack', seconds: 60, category: 'NEUTRAL' },
  ]);
});

it('honors the limit', async () => {
  const team = await seedTeam();
  const user = await seedUser(team.id, 'Ada', 'ada@example.com');
  await seedSample(user.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:00:00.000Z');
  await seedSample(user.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:01:00.000Z');
  await seedSample(user.id, 'Slack', 'NEUTRAL', '2026-07-12T09:02:00.000Z');
  const rows = await repo().appUsage(
    { kind: 'team', teamId: team.id },
    new Date('2026-07-12T00:00:00.000Z'),
    new Date('2026-07-13T00:00:00.000Z'),
    1,
  );
  expect(rows).toEqual([{ appName: 'Code', seconds: 120, category: 'PRODUCTIVE' }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports`
Expected: FAIL — `repo().appUsage` is not a function.

- [ ] **Step 3: Implement the repository method**

Add to `ReportsRepository`. `DISTINCT ON` picks the dominant category, tie-broken `UNPRODUCTIVE > NEUTRAL > PRODUCTIVE`. `limit` is a plain number, interpolated as a bound parameter:

```ts
async appUsage(scope: ReportScope, from: Date, to: Date, limit: number): Promise<TeamAppUsageRow[]> {
  const rows = await this.prisma.$queryRaw<
    Array<{ appName: string; seconds: number | bigint; category: string }>
  >`
    WITH per AS (
      SELECT a."appName" AS app, a.category::text AS cat, COUNT(*) * 60 AS secs
      FROM activity_samples a
      WHERE a."timestamp" >= ${from}::timestamptz
        AND a."timestamp" <  ${to}::timestamptz
        AND (${this.scopeSql(scope, Prisma.sql`a."userId"`)})
      GROUP BY a."appName", a.category
    ),
    totals AS (
      SELECT app, SUM(secs)::int AS total FROM per GROUP BY app
    ),
    dominant AS (
      SELECT DISTINCT ON (app) app, cat
      FROM per
      ORDER BY app, secs DESC,
        CASE cat WHEN 'UNPRODUCTIVE' THEN 3 WHEN 'NEUTRAL' THEN 2 ELSE 1 END DESC
    )
    SELECT t.app AS "appName", t.total AS "seconds", d.cat AS "category"
    FROM totals t
    JOIN dominant d ON d.app = t.app
    ORDER BY t.total DESC, t.app ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    appName: r.appName,
    seconds: Number(r.seconds),
    category: r.category as TeamAppUsageRow['category'],
  }));
}
```

Extend the top-of-file type import to include `TeamAppUsageRow`.

- [ ] **Step 4: Run the repo e2e to verify it passes**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- reports`
Expected: PASS.

- [ ] **Step 5: Write the failing service + controller unit tests**

In `reports.service.spec.ts` extend the repo mock with `appUsage: vi.fn().mockResolvedValue([])` and add `describe('ReportsService.appUsage', …)`. The query now carries `limit`; assert it is forwarded:

```ts
const appRange = { ...range, limit: 5 };
it('scopes a MANAGER to their own team and forwards the limit', async () => {
  const { svc, repo } = makeReports();
  await svc.appUsage(appRange, manager);
  expect(repo.appUsage).toHaveBeenCalledWith(
    { kind: 'team', teamId: 't1' },
    new Date(range.from),
    new Date(range.to),
    5,
  );
});
it('throws 403 when a MANAGER targets another team', async () => {
  const { svc } = makeReports();
  await expect(svc.appUsage({ ...appRange, teamId: 'other' }, manager)).rejects.toBeInstanceOf(
    ForbiddenException,
  );
});
```

In `reports.controller.spec.ts` extend the service mock with `appUsage: vi.fn().mockResolvedValue({ from: 'x', to: 'y', rows: [] })` and add:

```ts
it('appUsage delegates query + user', async () => {
  const { ctrl, service } = make();
  const query = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-14T00:00:00.000Z', limit: 10 };
  await ctrl.appUsage(query, user);
  expect(service.appUsage).toHaveBeenCalledWith(query, user);
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm --filter api test -- reports.service reports.controller`
Expected: FAIL.

- [ ] **Step 7: Implement service + controller**

Service:

```ts
async appUsage(query: AppUsageQuery, user: SessionUser): Promise<TeamAppUsage> {
  const scope = await this.resolveScope(query, user);
  const rows = await this.repo.appUsage(scope, new Date(query.from), new Date(query.to), query.limit);
  return TeamAppUsageSchema.parse({ from: query.from, to: query.to, rows });
}
```

`resolveScope` accepts a `ReportRangeQuery`; `AppUsageQuery` is a superset (adds `limit`), so it is assignable — no signature change needed.

Controller (note the **`AppUsageQuerySchema`** pipe, not `ReportRangeQuerySchema`, so `limit` is coerced/defaulted):

```ts
@Get('app-usage')
appUsage(
  @Query(new ZodValidationPipe(AppUsageQuerySchema)) query: AppUsageQuery,
  @CurrentUser() user: SessionUser,
): Promise<TeamAppUsage> {
  return this.service.appUsage(query, user);
}
```

Add `AppUsageQuerySchema, TeamAppUsageSchema, type AppUsageQuery, type TeamAppUsage` to the controller/service imports as needed.

- [ ] **Step 8: Run to verify unit tests pass**

Run: `pnpm --filter api test -- reports.service reports.controller`
Expected: PASS.

- [ ] **Step 9: Full gate**

Run: `pnpm --filter api typecheck && pnpm --filter api build && pnpm --filter @timetrack/contracts build`
Then the coverage-bearing run (Docker required): `RUN_E2E=1 pnpm --filter api test:coverage`
Expected: all PASS; `functions` coverage on `apps/api` still ≥ 80%.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/reports apps/api/test/reports.e2e-spec.ts
git commit -m "feat(api): GET /reports/app-usage team website/app breakdown"
```

---

## Notes for the executor

- **Docker is required** for every `RUN_E2E=1` step (Testcontainers spins a real Postgres 18). Without it, `describe.runIf(RUN_E2E)` blocks are skipped — the repo methods then go **unexercised** and the coverage gate will drop. Do not claim a task done on a skipped e2e.
- **Run one e2e file at a time:** `pnpm --filter api test:e2e -- reports` (per the repo convention — `test -- reports` silently excludes e2e specs).
- The `reports.e2e-spec.ts` describe blocks currently gate on `RUN_E2E`; keep new blocks inside `describe.runIf(RUN_E2E)` so a no-Docker `pnpm test` stays green.
- `scopeSql` and `resolveScope` are **existing private members** of the repo/service — call them from the new methods in the same class; do not re-implement.
- Do not touch the existing `overview` / `team-summary` / `projects` / `export.csv` handlers.

```

```
