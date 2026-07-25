# Project Detail Page + Deep-Dive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/projects/[projectId]` a real detail page — for one project over a date range: total tracked hours, an hours-over-time trend, a per-member breakdown, and a per-task breakdown — backed by a new `GET /projects/:id/detail` endpoint.

**Architecture:** One new endpoint on the **projects** module (MANAGER/ADMIN, own-team; 404 missing / 403 cross-team) whose service runs three new window-clamp raw-SQL aggregations on `ProjectsRepository` (clones of the existing reports idiom, filtered by `projectId`) and assembles a `ProjectDetail` re-validated through its Zod schema. The dashboard adds a getter, a small trend chart (clone of `ActivityDailyChart`), a pure view helper, and rewrites the stub page — reusing `ProjectHoursChart`, `ReportRangePicker`, `projectColor`, and the Slice-1 page patterns.

**Tech Stack:** NestJS 11 (Fastify), Prisma 7 raw SQL (`$queryRaw` + `Prisma.sql`), Zod 4 contracts, Next.js 16 Server Components, Recharts, Vitest (unit + Testcontainers e2e), Playwright (scaffold).

Spec: `docs/superpowers/specs/2026-07-25-projects-detail-design.md`

## Global Constraints

- Branch: `feat/projects-detail` (already created). Commit per task; Conventional Commits; scope ∈ `contracts | api | dashboard` (pick the one matching the task's files).
- **No AI attribution** in any commit/message/branch/trailer (CLAUDE.md §0). Author = repo's configured git user. (Pre-commit hooks enforce this + gitleaks + conventional-commit + lint-staged — do not bypass.)
- **No new dependencies.** **Zod only** for validation; contract **types are inferred**, never hand-written. `PrismaClient` only in `*.repository.ts`. No `console.log`.
- **Types come from `@timetrack/contracts`** in api and dashboard — never hand-write a response interface.
- **Two authz models exist; use the PROJECTS one here:** own-team for all roles (404 missing / 403 cross-team) via `ProjectsService.findForActor`, PLUS a `@Roles('MANAGER','ADMIN')` gate on the route. Do NOT import the reports `resolveScope`/`ResourceAccessService` path.
- **Zod pipe scoped to the parameter** (`@Query(new ZodValidationPipe(Schema))`), never method-level `@UsePipes`.
- `noUncheckedIndexedAccess` is ON (tsc enforces; Vitest does NOT typecheck specs). Guard array index access.
- Raw SQL uses the existing idiom verbatim: window clamp `GREATEST(EXTRACT(EPOCH FROM (LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz) - GREATEST(te."startTime", ${from}::timestamptz))), 0)`; overlap `te."startTime" < ${to}::timestamptz AND COALESCE(te."endTime", now()) > ${from}::timestamptz`; `FLOOR(SUM(...))::int` then `Number(...)` in the mapper (handles bigint).
- **API e2e is repository-level** (real Postgres via Testcontainers, gated `RUN_E2E=1` + Docker). Nothing boots the HTTP app; the `@Roles` employee-403 gate is decorator-enforced like every sibling manager/admin route (createProject/archive) and is NOT separately e2e-tested. Service-level 404/403 authz is unit-tested with a mocked repo.
- Run before claiming done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. For the API e2e task: Docker up + `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` (the `test:e2e -- <file>` form narrows; plain `test -- <file>` silently skips e2e).

All commands run from repo root `/Users/rashedulhasan/Development/personal/timetracker/timetrack`.

---

### Task 1: Contracts — project-detail schemas

**Files:**

- Modify: `packages/contracts/src/projects.ts` (append schemas + inferred types)
- Create: `packages/contracts/src/projects.spec.ts`

**Interfaces:**

- Consumes: `zod`.
- Produces (all re-exported automatically — `index.ts` already has `export * from './projects.js'`):
  - `ProjectHoursTrendRowSchema` / `ProjectHoursTrendRow` = `{ day: string; trackedSeconds: number }`
  - `ProjectMemberRowSchema` / `ProjectMemberRow` = `{ userId: string; name: string; trackedSeconds: number }`
  - `ProjectTaskRowSchema` / `ProjectTaskRow` = `{ taskId: string | null; name: string; trackedSeconds: number }`
  - `ProjectDetailSchema` / `ProjectDetail` = `{ from, to, projectId, name, archived, totalSeconds, trend[], members[], tasks[] }`
  - `ProjectDetailQuerySchema` / `ProjectDetailQuery` = `{ from: string; to: string }`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/projects.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ProjectDetailSchema, ProjectTaskRowSchema, ProjectDetailQuerySchema } from './projects.js';

describe('ProjectDetailSchema', () => {
  it('parses a full valid detail payload', () => {
    const value = {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
      projectId: '018f9c1e-0000-7000-8000-000000000001',
      name: 'Website',
      archived: false,
      totalSeconds: 9000,
      trend: [{ day: '2026-07-13', trackedSeconds: 5400 }],
      members: [
        { userId: '018f9c1e-0000-7000-8000-0000000000a1', name: 'Jane', trackedSeconds: 5400 },
        { userId: '018f9c1e-0000-7000-8000-0000000000a2', name: 'John', trackedSeconds: 3600 },
      ],
      tasks: [
        { taskId: '018f9c1e-0000-7000-8000-0000000000b1', name: 'Homepage', trackedSeconds: 5400 },
        { taskId: null, name: 'No task', trackedSeconds: 3600 },
      ],
    };
    expect(ProjectDetailSchema.parse(value)).toEqual(value);
  });

  it('accepts a task row with a null taskId (the "No task" bucket)', () => {
    expect(
      ProjectTaskRowSchema.parse({ taskId: null, name: 'No task', trackedSeconds: 60 }),
    ).toEqual({ taskId: null, name: 'No task', trackedSeconds: 60 });
  });

  it('rejects a negative trackedSeconds', () => {
    expect(() =>
      ProjectTaskRowSchema.parse({ taskId: null, name: 'x', trackedSeconds: -1 }),
    ).toThrow();
  });

  it('parses the detail query range', () => {
    expect(
      ProjectDetailQuerySchema.parse({
        from: '2026-07-13T00:00:00.000Z',
        to: '2026-07-19T23:59:59.999Z',
      }),
    ).toEqual({ from: '2026-07-13T00:00:00.000Z', to: '2026-07-19T23:59:59.999Z' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/contracts test -- src/projects.spec.ts`
Expected: FAIL — `ProjectDetailSchema` / `ProjectTaskRowSchema` / `ProjectDetailQuerySchema` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/contracts/src/projects.ts` (after the existing exports, before/after the inferred-type block — keep the file's style: schema consts then `export type … = z.infer<…>`):

```ts
export const ProjectHoursTrendRowSchema = z.object({
  day: z.iso.date(), // 'YYYY-MM-DD' — UTC start-day bucket
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectMemberRowSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectTaskRowSchema = z.object({
  taskId: z.uuid().nullable(), // null → the "No task" bucket
  name: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});

export const ProjectDetailSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  projectId: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  totalSeconds: z.number().int().nonnegative(),
  trend: z.array(ProjectHoursTrendRowSchema),
  members: z.array(ProjectMemberRowSchema),
  tasks: z.array(ProjectTaskRowSchema),
});

export const ProjectDetailQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});

export type ProjectHoursTrendRow = z.infer<typeof ProjectHoursTrendRowSchema>;
export type ProjectMemberRow = z.infer<typeof ProjectMemberRowSchema>;
export type ProjectTaskRow = z.infer<typeof ProjectTaskRowSchema>;
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;
export type ProjectDetailQuery = z.infer<typeof ProjectDetailQuerySchema>;
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @timetrack/contracts test -- src/projects.spec.ts` → PASS (4 tests).
Run: `pnpm --filter @timetrack/contracts typecheck` → PASS.

- [ ] **Step 5: Build contracts (api/dashboard consume built output)**

Run: `pnpm --filter @timetrack/contracts build`
Expected: PASS (emits `dist`). Later tasks import these types from the built package.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/projects.ts packages/contracts/src/projects.spec.ts
git commit -m "feat(contracts): project-detail schemas (trend, members, tasks)"
```

---

### Task 2: API repository — aggregations + findForActor name

**Files:**

- Modify: `apps/api/src/modules/projects/projects.repository.ts`
- Modify: `apps/api/test/projects.e2e-spec.ts` (update the `findForActor` assertion; add repo aggregation e2e)

**Interfaces:**

- Consumes: `PrismaService`, `Prisma` from `@timetrack/db`.
- Produces on `ProjectsRepository`:
  - `findForActor(id): Promise<{ id: string; teamId: string; name: string; archived: boolean } | null>` (now includes `name`)
  - `hoursByDay(projectId: string, from: Date, to: Date): Promise<{ day: string; trackedSeconds: number }[]>`
  - `membersForProject(projectId: string, from: Date, to: Date): Promise<{ userId: string; name: string; trackedSeconds: number }[]>`
  - `tasksForProject(projectId: string, from: Date, to: Date): Promise<{ taskId: string | null; name: string; trackedSeconds: number }[]>`

- [ ] **Step 1: Write the failing e2e tests** (real Postgres; needs Docker + `RUN_E2E=1`)

In `apps/api/test/projects.e2e-spec.ts`: (a) update the existing `findForActor` assertion to include `name`; (b) add seeding helpers + aggregation tests. Add these imports at the top are already present (`startTestDb`, `truncateAll`). Update the existing test body:

```ts
it('findForActor returns id/teamId/name/archived, or null when missing', async () => {
  const team = await seedTeam();
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  expect(await repo().findForActor(project.id)).toEqual({
    id: project.id,
    teamId: team.id,
    name: 'Website',
    archived: false,
  });
  expect(await repo().findForActor('019797a0-0000-7000-8000-0000000000ff')).toBeNull();
});
```

Then add, inside the `describe.runIf(RUN_E2E)` block, seeding helpers and the aggregation tests:

```ts
async function seedUser(teamId: string, name: string, email: string) {
  return db.prisma.user.create({
    data: { email, name, passwordHash: 'x', teamId },
    select: { id: true },
  });
}
async function seedEntry(
  userId: string,
  projectId: string,
  taskId: string | null,
  startIso: string,
  endIso: string,
) {
  await db.prisma.timeEntry.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      projectId,
      taskId,
      startTime: new Date(startIso),
      endTime: new Date(endIso),
      source: 'MANUAL',
    },
  });
}

const FROM = new Date('2026-07-13T00:00:00.000Z');
const TO = new Date('2026-07-20T00:00:00.000Z');

it('membersForProject sums per user, descending, with names', async () => {
  const team = await seedTeam();
  const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
  const john = await seedUser(team.id, 'John', 'john@e.com');
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  await seedEntry(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T11:00:00Z'); // 2h
  await seedEntry(john.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z'); // 1h
  const rows = await repo().membersForProject(project.id, FROM, TO);
  expect(rows).toEqual([
    { userId: jane.id, name: 'Jane', trackedSeconds: 7200 },
    { userId: john.id, name: 'John', trackedSeconds: 3600 },
  ]);
});

it('tasksForProject buckets by task and rolls null taskId into "No task"', async () => {
  const team = await seedTeam();
  const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  const task = await repo().createTask(project.id, 'Homepage', 'actor1');
  await seedEntry(jane.id, project.id, task.id, '2026-07-14T09:00:00Z', '2026-07-14T11:00:00Z'); // 2h Homepage
  await seedEntry(jane.id, project.id, null, '2026-07-14T13:00:00Z', '2026-07-14T13:30:00Z'); // 30m No task
  const rows = await repo().tasksForProject(project.id, FROM, TO);
  expect(rows).toEqual([
    { taskId: task.id, name: 'Homepage', trackedSeconds: 7200 },
    { taskId: null, name: 'No task', trackedSeconds: 1800 },
  ]);
});

it('hoursByDay buckets by UTC start-day and clamps to the window', async () => {
  const team = await seedTeam();
  const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  await seedEntry(jane.id, project.id, null, '2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z'); // 1h on 14th
  await seedEntry(jane.id, project.id, null, '2026-07-15T09:00:00Z', '2026-07-15T11:00:00Z'); // 2h on 15th
  // An entry starting before the window: clamped to FROM, bucketed on the window's first day.
  await seedEntry(jane.id, project.id, null, '2026-07-12T23:00:00Z', '2026-07-13T01:00:00Z'); // 1h inside window
  const rows = await repo().hoursByDay(project.id, FROM, TO);
  expect(rows).toEqual([
    { day: '2026-07-13', trackedSeconds: 3600 },
    { day: '2026-07-14', trackedSeconds: 3600 },
    { day: '2026-07-15', trackedSeconds: 7200 },
  ]);
});

it('aggregations return empty for a project with no entries in range', async () => {
  const team = await seedTeam();
  const project = await repo().createProject(team.id, 'Empty', 'actor1');
  expect(await repo().membersForProject(project.id, FROM, TO)).toEqual([]);
  expect(await repo().tasksForProject(project.id, FROM, TO)).toEqual([]);
  expect(await repo().hoursByDay(project.id, FROM, TO)).toEqual([]);
});
```

- [ ] **Step 2: Run the e2e to verify it fails**

Ensure Docker is running (`open -a Docker` then wait until `docker info` succeeds).
Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts`
Expected: FAIL — `membersForProject` / `tasksForProject` / `hoursByDay` are not functions (and the updated `findForActor` test fails on the missing `name`).

- [ ] **Step 3: Implement the repository changes**

In `apps/api/src/modules/projects/projects.repository.ts`: extend `findForActor` and add the three aggregation methods. **Do NOT add a `Prisma` import** — these queries use plain `this.prisma.$queryRaw\`…\``tagged templates (no`Prisma.sql`/`Prisma.empty`), so importing `Prisma` would be an unused import and fail lint. Keep the existing imports as-is.

Replace `findForActor`:

```ts
  findForActor(
    id: string,
  ): Promise<{ id: string; teamId: string; name: string; archived: boolean } | null> {
    return this.prisma.project.findUnique({
      where: { id },
      select: { id: true, teamId: true, name: true, archived: true },
    });
  }
```

Add these three methods (reads only — no `$transaction`). Define the shared SQL fragments once per method inline; keep the clamp/overlap verbatim from the reports idiom:

```ts
  async hoursByDay(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<{ day: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<Array<{ day: string; trackedSeconds: number | bigint }>>`
      SELECT to_char(GREATEST(te."startTime", ${from}::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND COALESCE(te."endTime", now()) > ${from}::timestamptz
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({ day: r.day, trackedSeconds: Number(r.trackedSeconds) }));
  }

  async membersForProject(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<{ userId: string; name: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ userId: string; name: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."userId" AS "userId", u.name AS "name",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      JOIN users u ON u.id = te."userId"
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND COALESCE(te."endTime", now()) > ${from}::timestamptz
      GROUP BY te."userId", u.name
      ORDER BY "trackedSeconds" DESC, u.name ASC
    `;
    return rows.map((r) => ({ userId: r.userId, name: r.name, trackedSeconds: Number(r.trackedSeconds) }));
  }

  async tasksForProject(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<{ taskId: string | null; name: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ taskId: string | null; name: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."taskId" AS "taskId", COALESCE(t.name, 'No task') AS "name",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      LEFT JOIN tasks t ON t.id = te."taskId"
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND COALESCE(te."endTime", now()) > ${from}::timestamptz
      GROUP BY te."taskId", t.name
      ORDER BY "trackedSeconds" DESC, "taskId" ASC NULLS LAST
    `;
    return rows.map((r) => ({ taskId: r.taskId, name: r.name, trackedSeconds: Number(r.trackedSeconds) }));
  }
```

Note: `Prisma` is imported to match the reports repository convention even though these queries use only tagged-template interpolation; if `Prisma` ends up unused, remove the import to satisfy lint. (It is fine to omit the import entirely — `$queryRaw` is a method on the client. Only keep the import if you actually reference `Prisma.sql`.)

- [ ] **Step 4: Run the e2e to verify it passes**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts`
Expected: PASS — updated `findForActor` test + 4 new aggregation tests green, plus the pre-existing repo tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @timetrack/api typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/projects/projects.repository.ts apps/api/test/projects.e2e-spec.ts
git commit -m "feat(api): per-day/member/task project aggregations in repository"
```

---

### Task 3: API service + controller — the detail endpoint

**Files:**

- Modify: `apps/api/src/modules/projects/projects.service.ts`
- Modify: `apps/api/src/modules/projects/projects.controller.ts`
- Modify: `apps/api/src/modules/projects/projects.service.spec.ts`

**Interfaces:**

- Consumes: `ProjectsRepository.findForActor`/`hoursByDay`/`membersForProject`/`tasksForProject` (Task 2); `ProjectDetail`, `ProjectDetailQuery`, `ProjectDetailSchema` (Task 1).
- Produces: `ProjectsService.detail(id, query, actor): Promise<ProjectDetail>` and the `GET /projects/:id/detail` route.

- [ ] **Step 1: Write the failing unit tests**

In `apps/api/src/modules/projects/projects.service.spec.ts`: extend the repo mock with the three aggregation methods, and add a `detail` describe block. Update the `makeService` repo mock object to include:

```ts
    hoursByDay: vi.fn(),
    membersForProject: vi.fn(),
    tasksForProject: vi.fn(),
```

Add at the end of the file:

```ts
describe('ProjectsService.detail', () => {
  const query = { from: '2026-07-13T00:00:00.000Z', to: '2026-07-19T23:59:59.999Z' };

  it('404 when the project does not exist', async () => {
    const { svc } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.detail('p9', query, manager)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("403 for another team's project", async () => {
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't2', name: 'X', archived: false }),
    });
    await expect(svc.detail('p1', query, manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.membersForProject).not.toHaveBeenCalled();
  });

  it('assembles detail with totalSeconds = sum of members', async () => {
    const { svc } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't1', name: 'Website', archived: false }),
      hoursByDay: vi.fn().mockResolvedValue([{ day: '2026-07-14', trackedSeconds: 10800 }]),
      membersForProject: vi.fn().mockResolvedValue([
        { userId: 'u1', name: 'Jane', trackedSeconds: 7200 },
        { userId: 'u2', name: 'John', trackedSeconds: 3600 },
      ]),
      tasksForProject: vi
        .fn()
        .mockResolvedValue([{ taskId: null, name: 'No task', trackedSeconds: 10800 }]),
    });
    const result = await svc.detail('p1', query, manager);
    expect(result.projectId).toBe('p1');
    expect(result.name).toBe('Website');
    expect(result.totalSeconds).toBe(10800);
    expect(result.members).toHaveLength(2);
    expect(result.tasks[0]).toEqual({ taskId: null, name: 'No task', trackedSeconds: 10800 });
    expect(result.from).toBe(query.from);
  });
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `pnpm --filter @timetrack/api test -- src/modules/projects/projects.service.spec.ts`
Expected: FAIL — `svc.detail` is not a function.

- [ ] **Step 3: Implement service + controller**

In `apps/api/src/modules/projects/projects.service.ts`: add the contracts imports and the `detail` method. Update the top imports:

```ts
import type {
  CreateProject,
  CreateTask,
  Project,
  ProjectDetail,
  ProjectDetailQuery,
  Task,
  UpdateProject,
} from '@timetrack/contracts';
import { ProjectDetailSchema } from '@timetrack/contracts';
```

Add the method (after `archive`, before the private helpers):

```ts
  async detail(id: string, query: ProjectDetailQuery, actor: SessionUser): Promise<ProjectDetail> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    if (project.teamId !== actor.teamId) throw this.forbidden();

    const from = new Date(query.from);
    const to = new Date(query.to);
    const [trend, members, tasks] = await Promise.all([
      this.repo.hoursByDay(id, from, to),
      this.repo.membersForProject(id, from, to),
      this.repo.tasksForProject(id, from, to),
    ]);
    const totalSeconds = members.reduce((sum, m) => sum + m.trackedSeconds, 0);

    // Re-validate on the way out (mirrors ReportsService); parse also strips any surprises.
    return ProjectDetailSchema.parse({
      from: query.from,
      to: query.to,
      projectId: id,
      name: project.name,
      archived: project.archived,
      totalSeconds,
      trend,
      members,
      tasks,
    });
  }
```

In `apps/api/src/modules/projects/projects.controller.ts`: add the imports and the route. Update the contracts import to add:

```ts
  ProjectDetailQuerySchema,
  type ProjectDetail,
  type ProjectDetailQuery,
```

Add the route (place it before `@Patch(':id')` for readability; verb/method disambiguation makes order irrelevant to routing):

```ts
  @Get(':id/detail')
  @Roles('MANAGER', 'ADMIN')
  detail(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ProjectDetailQuerySchema)) query: ProjectDetailQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<ProjectDetail> {
    return this.service.detail(id, query, user);
  }
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm --filter @timetrack/api test -- src/modules/projects/projects.service.spec.ts`
Expected: PASS (existing + 3 new detail tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @timetrack/api typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/projects/projects.service.ts apps/api/src/modules/projects/projects.controller.ts apps/api/src/modules/projects/projects.service.spec.ts
git commit -m "feat(api): GET /projects/:id/detail endpoint (manager/admin, own-team)"
```

---

### Task 4: Dashboard — api-client getter, trend chart, view helper

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts`
- Create: `apps/dashboard/src/components/charts/ProjectHoursTrendChart.tsx`
- Create: `apps/dashboard/src/lib/project-detail-view.ts`
- Create: `apps/dashboard/src/lib/project-detail-view.spec.ts`

**Interfaces:**

- Consumes: `ProjectDetail`, `ProjectHoursTrendRow`, `ProjectMemberRow`, `ProjectTaskRow`, `ProjectDetailSchema` from `@timetrack/contracts` (Task 1).
- Produces:
  - `api.getProjectDetail(token, id, params): Promise<ProjectDetail>`
  - `ProjectHoursTrendChart({ data }: { data: { label: string; hours: number }[] })`
  - `toTrendBars(trend): { label: string; hours: number }[]`, `toMemberBars(members): { name: string; hours: number }[]`, `toTaskBars(tasks): { name: string; hours: number }[]`

- [ ] **Step 1: Write the failing test (view helper)**

Create `apps/dashboard/src/lib/project-detail-view.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toTrendBars, toMemberBars, toTaskBars } from './project-detail-view';

describe('toTrendBars', () => {
  it('maps day → MM-DD label and seconds → rounded hours', () => {
    expect(toTrendBars([{ day: '2026-07-13', trackedSeconds: 5400 }])).toEqual([
      { label: '07-13', hours: 1.5 },
    ]);
  });
  it('empty in → empty out', () => {
    expect(toTrendBars([])).toEqual([]);
  });
});

describe('toMemberBars', () => {
  it('maps name + seconds → hours', () => {
    expect(toMemberBars([{ userId: 'u1', name: 'Jane', trackedSeconds: 3600 }])).toEqual([
      { name: 'Jane', hours: 1 },
    ]);
  });
});

describe('toTaskBars', () => {
  it('maps task name (incl. "No task") + seconds → hours', () => {
    expect(toTaskBars([{ taskId: null, name: 'No task', trackedSeconds: 1800 }])).toEqual([
      { name: 'No task', hours: 0.5 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/project-detail-view.spec.ts`
Expected: FAIL — cannot resolve `./project-detail-view`.

- [ ] **Step 3: Implement the view helper**

Create `apps/dashboard/src/lib/project-detail-view.ts`:

```ts
import type { ProjectHoursTrendRow, ProjectMemberRow, ProjectTaskRow } from '@timetrack/contracts';

// Same rounding as reports-view's toProjectBars: seconds → hours to 0.1.
const toHours = (seconds: number): number => Math.round((seconds / 3600) * 10) / 10;

/** Day 'YYYY-MM-DD' → 'MM-DD' axis label; seconds → hours. */
export function toTrendBars(trend: ProjectHoursTrendRow[]): { label: string; hours: number }[] {
  return trend.map((r) => ({ label: r.day.slice(5), hours: toHours(r.trackedSeconds) }));
}

export function toMemberBars(members: ProjectMemberRow[]): { name: string; hours: number }[] {
  return members.map((m) => ({ name: m.name, hours: toHours(m.trackedSeconds) }));
}

export function toTaskBars(tasks: ProjectTaskRow[]): { name: string; hours: number }[] {
  return tasks.map((t) => ({ name: t.name, hours: toHours(t.trackedSeconds) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/project-detail-view.spec.ts` → PASS (4 tests).

- [ ] **Step 5: Add the api-client getter**

In `apps/dashboard/src/lib/api-client.ts`: add `ProjectDetailSchema` + `type ProjectDetail` to the `@timetrack/contracts` import block, and add the getter to the `api` object next to `projectSummary`:

```ts
  getProjectDetail: (token: string, id: string, params: URLSearchParams): Promise<ProjectDetail> =>
    get(`/projects/${id}/detail?${params}`, ProjectDetailSchema, token),
```

- [ ] **Step 6: Create the trend chart**

Create `apps/dashboard/src/components/charts/ProjectHoursTrendChart.tsx` (clone of `ActivityDailyChart`, `{label, hours}`, no fixed Y domain, with an empty state):

```tsx
'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface HoursTrendPoint {
  label: string;
  hours: number;
}

/** Hours tracked per UTC day for one project. One bar per day; no fixed Y domain. */
export function ProjectHoursTrendChart({ data }: { data: HoursTrendPoint[] }) {
  if (data.length === 0) {
    return <p className="text-text-secondary text-body">No time in this range.</p>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="label" fontSize={12} tick={{ fill: 'var(--color-text-secondary)' }} />
          <YAxis fontSize={12} tick={{ fill: 'var(--color-text-secondary)' }} allowDecimals />
          <Tooltip />
          <Bar dataKey="hours" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @timetrack/dashboard typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/lib/api-client.ts apps/dashboard/src/lib/project-detail-view.ts apps/dashboard/src/lib/project-detail-view.spec.ts apps/dashboard/src/components/charts/ProjectHoursTrendChart.tsx
git commit -m "feat(dashboard): project detail api-client getter, trend chart, view helper"
```

---

### Task 5: Dashboard — detail page rewrite

**Files:**

- Modify (replace stub): `apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx`

**Interfaces:**

- Consumes: `api.getProjectDetail` (Task 4), `toTrendBars`/`toMemberBars`/`toTaskBars` (Task 4), `ProjectHoursTrendChart` (Task 4), `ProjectHoursChart` (existing), `ReportRangePicker` (existing, `basePath`), `projectColor` (Slice 1), `formatDuration`, `defaultReportRange`, `getSession`, `ApiError`, `PageHeader`, `ProjectDetail`.
- Produces: the detail page at `/projects/[projectId]`.

- [ ] **Step 1: Replace the stub**

Replace the entire contents of `apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx`:

```tsx
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui/PageHeader';
import { ReportRangePicker } from '../../../../components/reports/ReportRangePicker';
import { ProjectHoursChart } from '../../../../components/charts/ProjectHoursChart';
import { ProjectHoursTrendChart } from '../../../../components/charts/ProjectHoursTrendChart';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';
import { defaultReportRange } from '../../../../lib/reports-view';
import { toTrendBars, toMemberBars, toTaskBars } from '../../../../lib/project-detail-view';
import { projectColor } from '../../../../lib/project-color';
import { formatDuration } from '../../../../lib/format';
import type { ProjectDetail } from '@timetrack/contracts';

// Next 16 — params and searchParams are async. Detail hours come from /projects/:id/detail
// (MANAGER/ADMIN, own-team); 404 → not-found, 403 → not-permitted, mirroring the reports pages.
export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const { projectId } = await params;
  const sp = await searchParams;
  const fallback = defaultReportRange(new Date());
  const from = sp.from ?? fallback.from;
  const to = sp.to ?? fallback.to;

  let detail: ProjectDetail | null = null;
  let state: 'ok' | 'notfound' | 'forbidden' | 'error' = 'ok';
  try {
    detail = await api.getProjectDetail(
      session.accessToken,
      projectId,
      new URLSearchParams({ from, to }),
    );
  } catch (e) {
    detail = null;
    if (e instanceof ApiError && e.status === 404) state = 'notfound';
    else if (e instanceof ApiError && e.status === 403) state = 'forbidden';
    else state = 'error';
  }

  return (
    <>
      <div className="mb-2">
        <Link href="/projects" className="text-text-secondary hover:text-text text-label">
          ← Projects
        </Link>
      </div>

      {detail === null ? (
        <>
          <PageHeader title="Project" />
          <p className="text-text-secondary text-body">
            {state === 'notfound'
              ? 'Project not found.'
              : state === 'forbidden'
                ? 'You’re not permitted to view this project.'
                : 'Something went wrong loading this project. Please try again.'}
          </p>
        </>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-3">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: projectColor(detail.projectId) }}
              aria-hidden="true"
            />
            <h1 className="text-text text-h1 font-display font-semibold">{detail.name}</h1>
            {detail.archived && (
              <span className="text-text-secondary border-separator text-caption rounded-full border px-2 py-0.5">
                Archived
              </span>
            )}
            <span className="tt-numeric text-text-secondary text-label ml-auto">
              {formatDuration(detail.totalSeconds)} tracked · {from.slice(0, 10)} –{' '}
              {to.slice(0, 10)}
            </span>
          </div>

          <div className="mb-6">
            <ReportRangePicker from={from} to={to} basePath={`/projects/${detail.projectId}`} />
          </div>

          <div className="flex flex-col gap-8">
            <section>
              <h2 className="text-text text-h2 mb-3 font-semibold">Hours over time</h2>
              <ProjectHoursTrendChart data={toTrendBars(detail.trend)} />
            </section>
            <section>
              <h2 className="text-text text-h2 mb-3 font-semibold">By member</h2>
              <ProjectHoursChart data={toMemberBars(detail.members)} />
            </section>
            <section>
              <h2 className="text-text text-h2 mb-3 font-semibold">By task</h2>
              <ProjectHoursChart data={toTaskBars(detail.tasks)} />
            </section>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint && pnpm --filter @timetrack/dashboard build`
Expected: PASS; `/projects/[projectId]` remains a dynamic route (reads cookies/searchParams; not statically prerendered, no API call at build).

- [ ] **Step 3: Commit**

```bash
git add "apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx"
git commit -m "feat(dashboard): project detail page (trend, per-member, per-task)"
```

---

### Task 6: Dashboard — extend the e2e scaffold

**Files:**

- Modify: `apps/dashboard/e2e/projects.spec.ts`

**Interfaces:** none (test-only). Matches the repo's skipped-scaffold convention.

- [ ] **Step 1: Append detail-page scaffold cases**

Append a new `test.describe` block to `apps/dashboard/e2e/projects.spec.ts` (keep all `test.skip`, matching the existing style):

```ts
test.describe('project detail', () => {
  test.skip('renders header, three sections, and a back link', async ({ page }) => {
    await page.goto('/projects/some-project-id');
    await expect(page.getByRole('heading', { name: 'Hours over time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By member' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By task' })).toBeVisible();
    await expect(page.getByRole('link', { name: '← Projects' })).toBeVisible();
  });

  test.skip('shows not-found copy for a missing project', async ({ page }) => {
    await page.goto('/projects/00000000-0000-0000-0000-000000000000');
    await expect(page.getByText('Project not found.')).toBeVisible();
  });

  test.skip('an employee sees the not-permitted state', async ({ page }) => {
    await page.goto('/projects/some-project-id');
    await expect(page.getByText('You’re not permitted to view this project.')).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify the e2e suite still passes (all skipped)**

Run: `pnpm --filter @timetrack/dashboard test:e2e`
Expected: PASS with the new tests reported as skipped.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/e2e/projects.spec.ts
git commit -m "test(dashboard): scaffold project detail e2e cases"
```

---

### Final verification (after all tasks — controller runs this)

- [ ] **Full gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green.
- [ ] **API e2e (Docker up):** `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` — repo aggregation tests green.
- [ ] **Coverage:** `apps/api` gate holds under `RUN_E2E=1 pnpm --filter @timetrack/api test:coverage` (functions is the binding metric).
- [ ] **Manual smoke (optional, stack up):** sign in as manager/admin, open a project from `/projects`: header (dot · name · total · range), trend + by-member + by-task sections, range picker updates the URL under `/projects/:id`, "← Projects" returns. A missing id shows "Project not found."

## Notes / risks (carry into review)

- **Two authz models**: this slice deliberately uses the projects-module own-team rule (+ `@Roles('MANAGER','ADMIN')`), NOT reports' ADMIN-all. Confirm no reports-authz import crept in.
- **Start-day trend** buckets by `GREATEST(startTime, from)` in UTC — an entry crossing midnight counts on its start day; a pre-range overlap counts on the range's first day. Documented approximation.
- **`totalSeconds = Σ members`** relies on `TimeEntry.userId` being non-null (schema-guaranteed).
- **`findForActor` now returns `name`** — additive; `createTask`/`archive` ignore it; the existing e2e assertion is updated in Task 2.
- **No index on `time_entries."projectId"`** — aggregations scan by `(userId, startTime)`; fine at current scale, note for a future perf slice.
- **No `Prisma` import in the repository** — the new queries use plain `$queryRaw` tagged templates; importing `Prisma` (as the reports repo does for `Prisma.sql`) would be unused and fail lint.
