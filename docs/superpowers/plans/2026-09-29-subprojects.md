# Subprojects (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required Subproject level between Project and Task (Project → Subproject → Task) across DB, API, worker and dashboard, without breaking the shipped `/v1` desktop clients.

**Architecture:** A new `subprojects` table (one `isDefault` "General" per project, enforced by a partial unique index). `tasks.subprojectId` is required; `time_entries.subprojectId` is nullable and filled server-side by a single resolver in `TimeEntriesService` (explicit → task's → project default). The sync path is lenient (never 422 on subproject), dashboard paths are strict. The dashboard gets subproject management on the project page and a grouped "Assign to" select on entry forms.

**Tech Stack:** Prisma 7.8 (hand-authored migration, PG 18 `uuidv7()`), NestJS 11 + Zod 4, Vitest + Testcontainers, Next 16 server actions.

**Spec:** `docs/superpowers/specs/2026-09-29-subprojects-design.md` (read it first; it carries the _why_).

## Global Constraints

- Never break `/v1`: shipped clients send `{ projectId, taskId }` only, classify 4xx as permanent (data dropped) and 5xx as retry-forever. No new 4xx/5xx may be reachable from a shipped client's payload.
- `subprojectId` on time-entry _request_ schemas is `.nullable().optional()`, added per schema via `.extend()` **before** `.check()`. Never add it to the shared `timeEntryShape`.
- Cross-field rules use `.check()`, never `.refine()` (refine disables `ZodValidationPipe` strict mode).
- Prisma only in `*.repository.ts` (api) and `processors/` (worker). No business logic in repositories.
- Every write to projects/subprojects/tasks writes an `AuditLog` row in the same `$transaction`.
- Default subproject name is the constant `DEFAULT_SUBPROJECT_NAME = 'General'`.
- `prisma migrate dev` cannot run in this harness: hand-author `migration.sql`, then `pnpm db:deploy && pnpm db:generate && pnpm --filter @timetrack/db build`.
- After editing a package (`contracts`, `db`), rebuild its `dist` (`pnpm --filter <pkg> build`) before running app tests — stale dist fakes unrelated failures.
- vitest does not typecheck specs: run `pnpm typecheck` at the end of every task that changes a type.
- Commits: Conventional Commits, scopes from CLAUDE.md, **no AI attribution of any kind**.
- One api e2e spec: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/<file>.e2e-spec.ts` (needs Docker). `test -- file` silently runs nothing for e2e.

## Review Focus

1. **Sync from a shipped client naming a project that no longer exists** (stale id after the 2026-09-21 prod rebuild) → must be stored with `subprojectId = null` and return 2xx, never 500. Pinned in Task 5 (`e2e: unknown project id`).
2. **Sync carrying a `subprojectId` from another project** (Phase 2 client with a stale cache) → 2xx, falls back to task's/default subproject. Pinned in Task 5 (`pickSubproject lenient`).
3. **Archiving a subproject** → its tasks disappear from `GET /v1/projects` nested `tasks` (what clients pick from), but history and names are kept. Pinned in Task 3 (`listByTeam hides tasks of archived subprojects`).
4. **Editing an entry in the dashboard** must keep its task (today every edit wipes `taskId`). Pinned in Task 9 (`assignmentGroups keeps current assignment`, `parseAssignment round-trip`).
5. **Editing an entry whose current subproject/task is archived** → the form still offers the current combination so Save does not silently reassign it. Pinned in Task 9.

---

## File map

| File                                                                                                                                                     | Change                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/db/prisma/schema.prisma`                                                                                                                       | `Subproject` model; `Task.subprojectId`; `TimeEntry.subprojectId`  |
| `packages/db/prisma/migrations/20260929120000_add_subprojects/migration.sql`                                                                             | new, hand-authored                                                 |
| `packages/contracts/src/projects.ts` (+ `.spec.ts`)                                                                                                      | Subproject schemas, task/detail changes, `DEFAULT_SUBPROJECT_NAME` |
| `packages/contracts/src/time-entry.ts` (+ new `time-entry.spec.ts` cases in `time.spec.ts` or `contracts.spec.ts`)                                       | `subprojectId` per schema                                          |
| `apps/api/src/modules/projects/projects.repository.ts`                                                                                                   | subproject CRUD, default on create, task move, detail breakdown    |
| `apps/api/src/modules/projects/projects.service.ts` (+ spec)                                                                                             | authz + rules for subprojects and task move                        |
| `apps/api/src/modules/projects/projects.controller.ts` (+ spec)                                                                                          | 3 new routes; `setTaskArchived` → `updateTask`                     |
| `apps/api/src/modules/time-entries/time-entries.{repository,service}.ts` (+ spec)                                                                        | resolver, candidates query, persist `subprojectId`                 |
| `apps/api/src/modules/reports/{csv-writer,reports.repository}.ts` (+ spec)                                                                               | `subproject` CSV column (last)                                     |
| `apps/api/src/modules/admin/admin.repository.ts`                                                                                                         | export includes `subprojectId`                                     |
| `apps/api/test/{projects,time-entries,reports}.e2e-spec.ts`                                                                                              | new cases + fallout                                                |
| `apps/worker/src/processors/runaway-entry-trim.ts` (+ `test/…e2e-spec.ts`)                                                                               | copy `subprojectId`                                                |
| `apps/dashboard/src/lib/api-client.ts`                                                                                                                   | subproject calls, `moveTask`                                       |
| `apps/dashboard/src/app/(app)/projects/actions.ts`, `archive-toast.ts`                                                                                   | subproject + move actions                                          |
| `apps/dashboard/src/lib/project-detail-view.ts` (+ spec)                                                                                                 | `groupTasksBySubproject`                                           |
| `apps/dashboard/src/components/projects/{NewSubprojectForm,SubprojectArchiveToggle,TaskMoveForm}.tsx`                                                    | new                                                                |
| `apps/dashboard/src/components/projects/{NewTaskForm,ProjectDetailContent,ProjectsList}.tsx`, `lib/projects-index-view.ts`                               | wiring                                                             |
| `apps/dashboard/src/lib/entry-form.ts` (+ spec)                                                                                                          | `encodeAssignment`/`parseAssignment`/`assignmentGroups`            |
| `apps/dashboard/src/components/day/{EntryFormFields,EntryRowActions,AddTimeEntryForm}.tsx`, `app/(app)/me/actions.ts`, `lib/person-day-view.ts` (+ spec) | assignment select + labels                                         |

---

### Task 1: Schema + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (models `Project` ~L145, `Task` ~L158, `TimeEntry` ~L172)
- Create: `packages/db/prisma/migrations/20260929120000_add_subprojects/migration.sql`

**Interfaces:**

- Produces: Prisma models `subproject { id, projectId, name, archived, isDefault }`, `task.subprojectId: string` (required), `timeEntry.subprojectId: string | null`. Relations `Project.subprojects`, `Subproject.tasks`, `Task.subproject`.

- [ ] **Step 1: Edit `schema.prisma`**

In `model Project` add `subprojects Subproject[]` under `tasks Task[]`. Replace `model Task` and add `model Subproject` after it:

```prisma
/// Exactly one `isDefault` subproject ("General") per project, enforced by the raw-SQL partial
/// unique index `subprojects_one_default_per_project` (see migrations). A partial index is
/// invisible to Prisma's diff, so there is no PSL @@unique here.
model Subproject {
  id        String  @id @default(uuid(7))
  projectId String
  name      String
  archived  Boolean @default(false)
  isDefault Boolean @default(false)
  project   Project @relation(fields: [projectId], references: [id])
  tasks     Task[]

  @@index([projectId, archived])
  @@map("subprojects")
}

model Task {
  id           String     @id @default(uuid(7))
  /// Kept alongside subprojectId: shipped clients read tasks[].projectId and reports join on it.
  /// The service keeps it equal to the subproject's project.
  projectId    String
  subprojectId String
  name         String
  archived     Boolean    @default(false)
  project      Project    @relation(fields: [projectId], references: [id])
  subproject   Subproject @relation(fields: [subprojectId], references: [id])

  @@index([subprojectId])
  @@map("tasks")
}
```

In `model TimeEntry`, after `taskId String?` add:

```prisma
  /// Filled by the server (TimeEntriesService.resolveSubproject). Null when the entry has no
  /// project, or names a project that does not exist. No FK and no CHECK, like projectId/taskId:
  /// a constraint here would turn a shipped client's stale project id into a retry-forever 500.
  subprojectId String?
```

and add `@@index([subprojectId])` next to `@@index([projectId])`.

- [ ] **Step 2: Write the migration**

`packages/db/prisma/migrations/20260929120000_add_subprojects/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "subprojects" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "subprojects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subprojects_projectId_archived_idx" ON "subprojects"("projectId", "archived");

-- AddForeignKey
ALTER TABLE "subprojects" ADD CONSTRAINT "subprojects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one default subproject per project. Partial unique index; not expressible in
-- schema.prisma and invisible to Prisma's diff (same as time_entries_one_running_per_user).
CREATE UNIQUE INDEX "subprojects_one_default_per_project"
  ON "subprojects" ("projectId")
  WHERE "isDefault";

-- Backfill: one "General" default per existing project. Ids are UUIDv7 like @default(uuid(7)).
INSERT INTO "subprojects" ("id", "projectId", "name", "archived", "isDefault")
SELECT uuidv7()::text, p."id", 'General', false, true
FROM "projects" p;

-- AlterTable: every task moves into its project's default, then the column becomes required.
ALTER TABLE "tasks" ADD COLUMN "subprojectId" TEXT;

UPDATE "tasks" t
SET "subprojectId" = s."id"
FROM "subprojects" s
WHERE s."projectId" = t."projectId" AND s."isDefault";

ALTER TABLE "tasks" ALTER COLUMN "subprojectId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_subprojectId_idx" ON "tasks"("subprojectId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subprojectId_fkey" FOREIGN KEY ("subprojectId") REFERENCES "subprojects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: nullable, no FK, no CHECK (see schema.prisma). Backfill is re-runnable
-- (WHERE "subprojectId" IS NULL) so rows written by old code during a rollback can be repaired.
ALTER TABLE "time_entries" ADD COLUMN "subprojectId" TEXT;

-- Entries with a task of the SAME project take the task's subproject...
UPDATE "time_entries" te
SET "subprojectId" = t."subprojectId"
FROM "tasks" t
WHERE te."subprojectId" IS NULL
  AND te."taskId" = t."id"
  AND te."projectId" = t."projectId";

-- ...every other entry of an existing project takes that project's default.
UPDATE "time_entries" te
SET "subprojectId" = s."id"
FROM "subprojects" s
WHERE te."subprojectId" IS NULL
  AND s."projectId" = te."projectId"
  AND s."isDefault";

-- CreateIndex
CREATE INDEX "time_entries_subprojectId_idx" ON "time_entries"("subprojectId");
```

- [ ] **Step 3: Apply, generate, rebuild**

Make sure the local stack is up (`docker compose -f infra/docker-compose.yml up -d`) and the local DB has data (projects, tasks, entries). If it is empty, run `pnpm db:seed` and create a few projects/tasks/entries through the dashboard or `psql` first, so the backfill has something to act on.

Run: `pnpm db:deploy && pnpm db:generate && pnpm --filter @timetrack/db build`
Expected: `Applying migration 20260929120000_add_subprojects` … `All migrations have been successfully applied.`, generate succeeds, build exits 0.

- [ ] **Step 4: Verify the backfill on the populated DB**

Run each query with `psql "$DATABASE_URL" -c '<query>'` (DATABASE_URL from the repo-root `.env`). **Each must return 0 rows / count 0:**

```sql
-- 1. projects without exactly one default
SELECT p.id FROM projects p
LEFT JOIN subprojects s ON s."projectId" = p.id AND s."isDefault"
GROUP BY p.id HAVING COUNT(s.id) <> 1;
-- 2. tasks without a subproject (NOT NULL makes this 0 by construction; run it anyway)
SELECT COUNT(*) FROM tasks WHERE "subprojectId" IS NULL;
-- 3. entries of an EXISTING project with no subproject
SELECT COUNT(*) FROM time_entries te JOIN projects p ON p.id = te."projectId"
WHERE te."subprojectId" IS NULL;
-- 4. tasks whose subproject is in another project
SELECT COUNT(*) FROM tasks t JOIN subprojects s ON s.id = t."subprojectId"
WHERE s."projectId" <> t."projectId";
```

Also record, for the PR, `SELECT COUNT(*) FROM subprojects;` (= project count) and `SELECT COUNT(*) FROM time_entries WHERE "subprojectId" IS NOT NULL;`.

- [ ] **Step 5: Prove `schema.prisma` matches the SQL**

Run (shadow DB: create a scratch DB `createdb -h localhost -U <user> tt_shadow` or use any empty PG 18):
`pnpm --filter @timetrack/db exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --shadow-database-url "postgresql://…/tt_shadow" --script`
(If the flag names differ in this Prisma version, check `prisma migrate diff --help`; in Prisma 7 the target flag is `--to-schema`.)
Expected: output that ONLY drops the two partial indexes Prisma cannot see (`subprojects_one_default_per_project`, `time_entries_one_running_per_user`) — or an empty script. Anything else means the PSL and SQL disagree: fix the PSL, not the SQL.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260929120000_add_subprojects
git commit -m "feat(db): add subprojects with one default per project"
```

---

### Task 2: Contracts

**Files:**

- Modify: `packages/contracts/src/projects.ts`, `packages/contracts/src/time-entry.ts`
- Test: `packages/contracts/src/projects.spec.ts`, `packages/contracts/src/time.spec.ts` (grep it for `CreateTimeEntrySchema`; if time-entry schemas are tested in another spec file, add the cases there instead)

**Interfaces:**

- Produces (all exported from `@timetrack/contracts`):
  - `DEFAULT_SUBPROJECT_NAME: 'General'`
  - `SubprojectSchema` / `type Subproject = { id; projectId; name; archived; isDefault }`
  - `CreateSubprojectSchema` / `CreateSubproject = { projectId; name }`
  - `UpdateSubprojectSchema` / `UpdateSubproject = { name?; archived? }` (≥1 key)
  - `TaskSchema` + `subprojectId: string`
  - `ProjectSchema` + `subprojects?: Subproject[]`
  - `CreateTaskSchema` = `{ subprojectId; name }`
  - `UpdateTaskSchema` = `{ archived?; subprojectId? }` (≥1 key)
  - `ProjectSubprojectRowSchema` / `ProjectSubprojectRow = { subprojectId: string|null; name; trackedSeconds }`
  - `ProjectTaskRowSchema` + `subprojectId: string | null`
  - `ProjectDetailSchema` + `subprojects: ProjectSubprojectRow[]`
  - `CreateTimeEntry`, `UpdateTimeEntry`, `CreateManualTimeEntry` + `subprojectId?: string | null`
  - `TimeEntry` + `subprojectId: string | null`

- [ ] **Step 1: Write the failing tests** (append to `projects.spec.ts`; add `SubprojectSchema, CreateSubprojectSchema, UpdateSubprojectSchema, CreateTaskSchema, DEFAULT_SUBPROJECT_NAME` to its import)

```ts
const U1 = '018f9c1e-0000-7000-8000-000000000001';
const U2 = '018f9c1e-0000-7000-8000-000000000002';

describe('subproject schemas', () => {
  it('names the default subproject General', () => {
    expect(DEFAULT_SUBPROJECT_NAME).toBe('General');
  });

  it('SubprojectSchema parses a subproject', () => {
    const v = { id: U1, projectId: U2, name: 'Homepage', archived: false, isDefault: false };
    expect(SubprojectSchema.parse(v)).toEqual(v);
  });

  it('CreateSubprojectSchema requires a 1..200 char name', () => {
    expect(CreateSubprojectSchema.safeParse({ projectId: U1, name: '' }).success).toBe(false);
    expect(CreateSubprojectSchema.safeParse({ projectId: U1, name: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(CreateSubprojectSchema.safeParse({ projectId: U1, name: 'Homepage' }).success).toBe(
      true,
    );
  });

  it('UpdateSubprojectSchema needs at least one field', () => {
    expect(UpdateSubprojectSchema.safeParse({}).success).toBe(false);
    expect(UpdateSubprojectSchema.safeParse({ archived: true }).success).toBe(true);
    expect(UpdateSubprojectSchema.safeParse({ name: 'Checkout' }).success).toBe(true);
  });

  it('UpdateSubprojectSchema injects no defaults', () => {
    expect(UpdateSubprojectSchema.parse({ name: 'A' })).toEqual({ name: 'A' });
  });
});

describe('task schemas with subprojects', () => {
  it('CreateTaskSchema takes a subprojectId, not a projectId', () => {
    expect(CreateTaskSchema.safeParse({ subprojectId: U1, name: 'T' }).success).toBe(true);
    expect(CreateTaskSchema.safeParse({ projectId: U1, name: 'T' }).success).toBe(false);
  });

  it('UpdateTaskSchema accepts archived, a move, or both — but not nothing', () => {
    expect(UpdateTaskSchema.safeParse({}).success).toBe(false);
    expect(UpdateTaskSchema.safeParse({ archived: true }).success).toBe(true);
    expect(UpdateTaskSchema.safeParse({ subprojectId: U1 }).success).toBe(true);
    expect(UpdateTaskSchema.safeParse({ archived: false, subprojectId: U1 }).success).toBe(true);
  });

  it('TaskSchema carries subprojectId', () => {
    const t = { id: U1, projectId: U2, subprojectId: U2, name: 'T', archived: false };
    expect(TaskSchema.parse(t)).toEqual(t);
  });
});
```

In the existing `ProjectDetailSchema` "parses a full valid detail payload" test, add `subprojects: [{ subprojectId: U1-like uuid, name: 'General', trackedSeconds: 9000 }]` to the value and `subprojectId` to each task row; add a test that a `subprojects` row with `subprojectId: null` (the "No subproject" bucket) parses.

Time-entry cases (in the spec file that already tests `CreateTimeEntrySchema`):

```ts
describe('subprojectId on time-entry bodies', () => {
  const base = {
    id: '018f9c1e-0000-7000-8000-0000000000e1',
    projectId: '018f9c1e-0000-7000-8000-000000000001',
    taskId: null,
    startTime: '2026-07-11T09:00:00Z',
    endTime: '2026-07-11T10:00:00Z',
    source: 'AUTO' as const,
  };

  it('sync body without subprojectId still parses — the shipped-client shape', () => {
    expect(CreateTimeEntrySchema.safeParse(base).success).toBe(true);
  });

  it('sync body accepts subprojectId and null', () => {
    expect(CreateTimeEntrySchema.safeParse({ ...base, subprojectId: base.projectId }).success).toBe(
      true,
    );
    expect(CreateTimeEntrySchema.safeParse({ ...base, subprojectId: null }).success).toBe(true);
  });

  it('update and manual bodies accept an optional subprojectId', () => {
    expect(UpdateTimeEntrySchema.safeParse({ subprojectId: base.projectId }).success).toBe(true);
    const { source: _s, ...manual } = base;
    expect(CreateManualTimeEntrySchema.safeParse(manual).success).toBe(true);
    expect(CreateManualTimeEntrySchema.safeParse({ ...manual, subprojectId: null }).success).toBe(
      true,
    );
  });

  it('TimeEntrySchema requires subprojectId (nullable) on responses', () => {
    const resp = { ...base, userId: base.projectId, editedById: null, editedAt: null };
    expect(TimeEntrySchema.safeParse(resp).success).toBe(false);
    expect(TimeEntrySchema.safeParse({ ...resp, subprojectId: null }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @timetrack/contracts test`
Expected: FAIL (missing exports / schema mismatches).

- [ ] **Step 3: Implement `projects.ts`**

Add after `ProjectColorSchema`:

```ts
/** The name every project's default subproject is created with (and the migration backfilled). */
export const DEFAULT_SUBPROJECT_NAME = 'General';

export const SubprojectSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  /** The project's "General" bucket: exactly one per project, never archivable. */
  isDefault: z.boolean(),
});
```

Change `TaskSchema` to add `subprojectId: z.uuid(),` after `projectId`. Add `subprojects: z.array(SubprojectSchema).optional(),` to `ProjectSchema` after `tasks`. Replace `CreateTaskSchema` and `UpdateTaskSchema`:

```ts
/** The project is derived from the subproject server-side, so a task can never straddle two. */
export const CreateTaskSchema = z.object({
  subprojectId: z.uuid(),
  name: z.string().min(1).max(200),
});

/**
 * PATCH /v1/projects/tasks/:id — archive/restore, and/or move to another subproject of the SAME
 * project. `.check()` not `.refine()`, so the pipe keeps strict mode.
 */
export const UpdateTaskSchema = z
  .object({
    archived: z.boolean().optional(),
    subprojectId: z.uuid().optional(),
  })
  .check((ctx) => {
    if (ctx.value.archived === undefined && ctx.value.subprojectId === undefined) {
      ctx.issues.push({ code: 'custom', message: 'Nothing to update', input: ctx.value, path: [] });
    }
  });

export const CreateSubprojectSchema = z.object({
  projectId: z.uuid(),
  name: z.string().min(1).max(200),
});

/** No `.default()`s anywhere: Zod 4 `.partial()`/optional keys would otherwise inject them. */
export const UpdateSubprojectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .check((ctx) => {
    if (ctx.value.name === undefined && ctx.value.archived === undefined) {
      ctx.issues.push({ code: 'custom', message: 'Nothing to update', input: ctx.value, path: [] });
    }
  });
```

Add a row schema before `ProjectDetailSchema`, extend the task row, extend the detail:

```ts
export const ProjectSubprojectRowSchema = z.object({
  subprojectId: z.uuid().nullable(), // null → "No subproject" (entry naming no/unknown subproject)
  name: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});
```

`ProjectTaskRowSchema` gains `subprojectId: z.uuid().nullable(), // the task's subproject; null for "No task"`. `ProjectDetailSchema` gains `subprojects: z.array(ProjectSubprojectRowSchema),` after `members`.

Types at the bottom:

```ts
export type Subproject = z.infer<typeof SubprojectSchema>;
export type CreateSubproject = z.infer<typeof CreateSubprojectSchema>;
export type UpdateSubproject = z.infer<typeof UpdateSubprojectSchema>;
export type ProjectSubprojectRow = z.infer<typeof ProjectSubprojectRowSchema>;
```

- [ ] **Step 4: Implement `time-entry.ts`**

Do NOT touch `timeEntryShape`. Add, near the top after `TimeEntryBase`:

```ts
/**
 * Optional on every REQUEST body and added per schema — never to `timeEntryShape`, which would
 * make it required on the sync upsert and 422 every shipped client's upload (permanent → dropped).
 * The server fills it when absent (TimeEntriesService.resolveSubproject).
 */
const requestSubprojectId = z.uuid().nullable().optional();
```

- `CreateTimeEntrySchema = TimeEntryBase.extend({ subprojectId: requestSubprojectId, platform: … })` (keep the existing platform comment and `.check`).
- `UpdateTimeEntrySchema = TimeEntryBase.partial().omit({ id: true }).extend({ subprojectId: requestSubprojectId }).check(…)` (existing check body unchanged).
- `CreateManualTimeEntrySchema`: add `subprojectId: requestSubprojectId,` after `taskId`.
- `TimeEntrySchema = TimeEntryBase.extend({ subprojectId: z.uuid().nullable(), userId: …, editedById: …, editedAt: … })`.

- [ ] **Step 5: Run tests + coverage + build**

Run: `pnpm --filter @timetrack/contracts test && pnpm --filter @timetrack/contracts test:coverage && pnpm --filter @timetrack/contracts build`
Expected: all PASS; coverage ≥ 80% on branches (the two new `.check()` bodies each have a pass and fail case above).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): add subproject schemas and optional subprojectId"
```

(`pnpm typecheck` will be red in apps until Tasks 3–9 land; that is expected and is checked in Task 10.)

---

### Task 3: Projects repository

**Files:**

- Modify: `apps/api/src/modules/projects/projects.repository.ts`
- Test: `apps/api/test/projects.e2e-spec.ts`, `apps/api/test/reports.e2e-spec.ts:1837` (fallout)

**Interfaces:**

- Consumes: Task 1 models; Task 2 types `Subproject`, `Task`, `Project`, `DEFAULT_SUBPROJECT_NAME`.
- Produces (on `ProjectsRepository`):
  - `createProject(teamId, name, actorId, color?)` — now also creates the default subproject
  - `createSubproject(projectId: string, name: string, actorId: string): Promise<Subproject>`
  - `updateSubproject(id: string, patch: { name?: string; archived?: boolean }, actorId: string): Promise<Subproject>`
  - `findSubprojectForActor(id: string): Promise<(Subproject & { teamId: string }) | null>`
  - `listSubprojectsForProject(projectId: string): Promise<Subproject[]>` (default first, then active, then name)
  - `createTask(subprojectId: string, name: string, actorId: string): Promise<Task>` (**signature change**)
  - `moveTask(taskId: string, subprojectId: string, actorId: string): Promise<Task>`
  - `findTaskForActor(taskId): Promise<(Task & { teamId: string }) | null>` (**now returns the full task**)
  - `subprojectsForProject(projectId, from, to, freshnessSeconds): Promise<{ subprojectId: string | null; name: string; trackedSeconds: number }[]>`
  - `tasksForProject(...)` rows gain `subprojectId: string | null`
  - `listByTeam` projects gain `subprojects`; nested `tasks` exclude tasks of archived subprojects

- [ ] **Step 1: Fix the fallout in existing e2e tests first**

In `apps/api/test/projects.e2e-spec.ts` add a helper after `seedTeam`:

```ts
/** The project's default ("General") subproject — createProject makes exactly one. */
async function generalOf(projectId: string): Promise<string> {
  const s = await db.prisma.subproject.findFirstOrThrow({
    where: { projectId, isDefault: true },
    select: { id: true },
  });
  return s.id;
}
```

and replace every `repo().createTask(project.id, NAME, ACTOR)` with `repo().createTask(await generalOf(project.id), NAME, ACTOR)` (≈9 call sites; `grep -n "createTask(" apps/api/test/projects.e2e-spec.ts`). Update the `findTaskForActor` test's expectation to:

```ts
expect(await repo().findTaskForActor(task.id)).toEqual({
  id: task.id,
  projectId: project.id,
  subprojectId: await generalOf(project.id),
  name: 'Homepage',
  archived: false,
  teamId: team.id,
});
```

In `apps/api/test/reports.e2e-spec.ts` ~L1833, the test creates the project with raw Prisma; create a subproject before the task:

```ts
const sp = await db.prisma.subproject.create({
  data: { projectId: p.id, name: 'General', isDefault: true },
  select: { id: true },
});
const tk = await db.prisma.task.create({
  data: { projectId: p.id, subprojectId: sp.id, name: 'Build' },
  select: { id: true },
});
```

- [ ] **Step 2: Write the failing e2e tests** (append inside the `projects repository — real Postgres` describe)

```ts
describe('subprojects', () => {
  it('createProject also creates exactly one default "General" subproject', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const subs = await repo().listSubprojectsForProject(project.id);
    expect(subs).toEqual([
      expect.objectContaining({
        projectId: project.id,
        name: 'General',
        isDefault: true,
        archived: false,
      }),
    ]);
  });

  it('the partial index refuses a second default for one project', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    await expect(
      db.prisma.subproject.create({
        data: { projectId: project.id, name: 'Dup', isDefault: true },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('createSubproject inserts and audits', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
    expect(sub).toMatchObject({
      projectId: project.id,
      name: 'Checkout',
      isDefault: false,
      archived: false,
    });
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'subproject', targetId: sub.id },
    });
    expect(audit?.action).toBe('subproject.create');
  });

  it('updateSubproject renames/archives and audits the patch', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
    const updated = await repo().updateSubproject(
      sub.id,
      { name: 'Payments', archived: true },
      'actor1',
    );
    expect(updated).toMatchObject({ name: 'Payments', archived: true });
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetType: 'subproject', targetId: sub.id, action: 'subproject.update' },
    });
    expect(audit?.diff).toEqual({ name: 'Payments', archived: true });
  });

  it('listSubprojectsForProject orders default first, then active, then by name', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const z = await repo().createSubproject(project.id, 'Zeta', 'actor1');
    await repo().createSubproject(project.id, 'Alpha', 'actor1');
    await repo().updateSubproject(z.id, { archived: true }, 'actor1');
    await repo().createSubproject(project.id, 'Beta', 'actor1');
    const names = (await repo().listSubprojectsForProject(project.id)).map((s) => s.name);
    expect(names).toEqual(['General', 'Alpha', 'Beta', 'Zeta']);
  });

  it('findSubprojectForActor returns the subproject with its team, or null', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
    expect(await repo().findSubprojectForActor(sub.id)).toEqual({ ...sub, teamId: team.id });
    expect(await repo().findSubprojectForActor('019797a0-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('createTask derives projectId from the subproject', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
    const task = await repo().createTask(sub.id, 'Pay form', 'actor1');
    expect(task).toMatchObject({ projectId: project.id, subprojectId: sub.id, name: 'Pay form' });
  });

  it('moveTask changes the subproject and audits from/to', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const general = await generalOf(project.id);
    const sub = await repo().createSubproject(project.id, 'Checkout', 'actor1');
    const task = await repo().createTask(general, 'Pay form', 'actor1');
    const moved = await repo().moveTask(task.id, sub.id, 'actor1');
    expect(moved.subprojectId).toBe(sub.id);
    const audit = await db.prisma.auditLog.findFirst({
      where: { targetId: task.id, action: 'task.move' },
    });
    expect(audit?.diff).toEqual({ from: general, to: sub.id });
  });

  it('listByTeam returns subprojects and hides tasks of archived subprojects', async () => {
    const team = await seedTeam();
    const project = await repo().createProject(team.id, 'Website', 'actor1');
    const general = await generalOf(project.id);
    const old = await repo().createSubproject(project.id, 'Old', 'actor1');
    const kept = await repo().createTask(general, 'Kept', 'actor1');
    await repo().createTask(old.id, 'Hidden', 'actor1');
    await repo().updateSubproject(old.id, { archived: true }, 'actor1');

    const [active] = await repo().listByTeam(team.id);
    expect(active?.tasks?.map((t) => t.id)).toEqual([kept.id]);
    expect(active?.subprojects?.map((s) => s.name)).toEqual(['General']);

    const [all] = await repo().listByTeam(team.id, true);
    expect(all?.subprojects?.map((s) => s.name)).toEqual(['General', 'Old']);
    expect(all?.tasks?.map((t) => t.id)).toEqual([kept.id]); // still hidden: not assignable
  });
});
```

The existing `tasksForProject buckets by task…` test (it uses `seedEntry(userId, projectId, taskId, startIso, endIso)` and `FROM`/`TO`/`FRESHNESS` from that section) now expects `subprojectId` on each row — change its expectation to:

```ts
const general = await generalOf(project.id);
expect(rows).toEqual([
  { taskId: task.id, subprojectId: general, name: 'Homepage', trackedSeconds: 7200 },
  { taskId: null, subprojectId: null, name: 'No task', trackedSeconds: 1800 },
]);
```

Then add, right after it (same section, so `seedTeam`, `seedUser`, `FROM`, `TO`, `FRESHNESS` are in scope):

```ts
it('subprojectsForProject buckets by subproject and rolls null into "No subproject"', async () => {
  const team = await seedTeam();
  const jane = await seedUser(team.id, 'Jane', 'jane@e.com');
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  const general = await generalOf(project.id);
  const closed = (start: string, end: string, subprojectId: string | null) =>
    db.prisma.timeEntry.create({
      data: {
        id: crypto.randomUUID(),
        userId: jane.id,
        projectId: project.id,
        taskId: null,
        subprojectId,
        source: 'MANUAL',
        startTime: new Date(start),
        endTime: new Date(end),
      },
    });
  await closed('2026-07-14T09:00:00Z', '2026-07-14T10:00:00Z', general); // 1h General
  await closed('2026-07-14T13:00:00Z', '2026-07-14T13:30:00Z', null); // 30m, unresolved
  const rows = await repo().subprojectsForProject(project.id, FROM, TO, FRESHNESS);
  expect(rows).toEqual([
    { subprojectId: general, name: 'General', trackedSeconds: 3600 },
    { subprojectId: null, name: 'No subproject', trackedSeconds: 1800 },
  ]);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts`
Expected: FAIL (`repo().createSubproject is not a function`, etc.).

- [ ] **Step 4: Implement the repository**

At the top, next to `PROJECT_SELECT`:

```ts
const TASK_SELECT = {
  id: true,
  projectId: true,
  subprojectId: true,
  name: true,
  archived: true,
} as const;

const SUBPROJECT_SELECT = {
  id: true,
  projectId: true,
  name: true,
  archived: true,
  isDefault: true,
} as const;
```

Import `DEFAULT_SUBPROJECT_NAME` and `type Subproject` from `@timetrack/contracts`. Replace every inline `{ id: true, projectId: true, name: true, archived: true }` task select with `TASK_SELECT`.

`listByTeam` select becomes:

```ts
      select: {
        ...PROJECT_SELECT,
        subprojects: {
          where: includeArchived ? {} : { archived: false },
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
          select: SUBPROJECT_SELECT,
        },
        // Assignable tasks only. A task in an ARCHIVED subproject is not assignable either — this
        // nested list is what the shipped clients pick from, so it is the only way archiving a
        // subproject reaches them.
        tasks: {
          where: { archived: false, subproject: { archived: false } },
          select: TASK_SELECT,
        },
      },
```

`createProject`: after `tx.project.create`, before the audit:

```ts
// Every project owns exactly one default subproject (partial unique index), created with it.
await tx.subproject.create({
  data: { projectId: project.id, name: DEFAULT_SUBPROJECT_NAME, isDefault: true },
});
```

Replace `createTask`, `findTaskForActor`; add the new methods:

```ts
  async createTask(subprojectId: string, name: string, actorId: string): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subproject.findUniqueOrThrow({
        where: { id: subprojectId },
        select: { projectId: true },
      });
      const task = await tx.task.create({
        data: { projectId: sub.projectId, subprojectId, name },
        select: TASK_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'task.create',
          targetType: 'task',
          targetId: task.id,
          diff: { projectId: sub.projectId, subprojectId, name },
        },
      });
      return task;
    });
  }

  async findTaskForActor(taskId: string): Promise<(Task & { teamId: string }) | null> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { ...TASK_SELECT, project: { select: { teamId: true } } },
    });
    if (!task) return null;
    const { project, ...rest } = task;
    return { ...rest, teamId: project.teamId };
  }

  async moveTask(taskId: string, subprojectId: string, actorId: string): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { subprojectId: true },
      });
      const task = await tx.task.update({
        where: { id: taskId },
        data: { subprojectId },
        select: TASK_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'task.move',
          targetType: 'task',
          targetId: taskId,
          diff: { from: before.subprojectId, to: subprojectId },
        },
      });
      return task;
    });
  }

  async createSubproject(projectId: string, name: string, actorId: string): Promise<Subproject> {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subproject.create({
        data: { projectId, name },
        select: SUBPROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'subproject.create',
          targetType: 'subproject',
          targetId: sub.id,
          diff: { projectId, name },
        },
      });
      return sub;
    });
  }

  async updateSubproject(
    id: string,
    patch: { name?: string; archived?: boolean },
    actorId: string,
  ): Promise<Subproject> {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subproject.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        },
        select: SUBPROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'subproject.update',
          targetType: 'subproject',
          targetId: id,
          diff: { ...patch },
        },
      });
      return sub;
    });
  }

  async findSubprojectForActor(id: string): Promise<(Subproject & { teamId: string }) | null> {
    const sub = await this.prisma.subproject.findUnique({
      where: { id },
      select: { ...SUBPROJECT_SELECT, project: { select: { teamId: true } } },
    });
    if (!sub) return null;
    const { project, ...rest } = sub;
    return { ...rest, teamId: project.teamId };
  }

  listSubprojectsForProject(projectId: string): Promise<Subproject[]> {
    return this.prisma.subproject.findMany({
      where: { projectId },
      orderBy: [{ isDefault: 'desc' }, { archived: 'asc' }, { name: 'asc' }],
      select: SUBPROJECT_SELECT,
    });
  }
```

(If `diff: { ...patch }` fails typecheck against `InputJsonValue`, build it as a `type` alias object — see the Prisma-Json memory: an `interface`-typed value is rejected, a `type` alias is not.)

`tasksForProject`: select `t."subprojectId" AS "subprojectId"`, add `t."subprojectId"` to `GROUP BY`, type the row `subprojectId: string | null`, and map `subprojectId: r.subprojectId`.

Add `subprojectsForProject` right after it:

```ts
  async subprojectsForProject(
    projectId: string,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<{ subprojectId: string | null; name: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ subprojectId: string | null; name: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."subprojectId" AS "subprojectId", COALESCE(s.name, 'No subproject') AS "name",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(${ENTRY_END(freshnessSeconds)}, ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      LEFT JOIN subprojects s ON s.id = te."subprojectId"
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
        AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
      GROUP BY te."subprojectId", s.name
      ORDER BY "trackedSeconds" DESC, "subprojectId" ASC NULLS LAST
    `;
    return rows.map((r) => ({
      subprojectId: r.subprojectId,
      name: r.name,
      trackedSeconds: Number(r.trackedSeconds),
    }));
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` then `… -- test/reports.e2e-spec.ts`
Expected: PASS, both.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/projects/projects.repository.ts apps/api/test/projects.e2e-spec.ts apps/api/test/reports.e2e-spec.ts
git commit -m "feat(api): persist subprojects and default one per new project"
```

---

### Task 4: Projects service + controller

**Files:**

- Modify: `apps/api/src/modules/projects/projects.service.ts`, `projects.controller.ts`
- Test: `projects.service.spec.ts`, `projects.controller.spec.ts`

**Interfaces:**

- Consumes: Task 3 repository methods.
- Produces (on `ProjectsService`):
  - `createSubproject(dto: CreateSubproject, actor): Promise<Subproject>`
  - `updateSubproject(id: string, dto: UpdateSubproject, actor): Promise<Subproject>`
  - `listSubprojects(projectId: string, actor): Promise<Subproject[]>`
  - `createTask(dto: CreateTask, actor): Promise<Task>` (now subproject-based)
  - `updateTask(taskId: string, dto: UpdateTask, actor): Promise<Task>` (replaces `setTaskArchived`)
  - `detail(...)` result gains `subprojects`
- Routes: `POST /v1/projects/subprojects`, `PATCH /v1/projects/subprojects/:id`, `GET /v1/projects/:id/subprojects` (all MANAGER/ADMIN). Controller handler `setTaskArchived` → `updateTask`.

- [ ] **Step 1: Write the failing unit tests**

In `projects.service.spec.ts` add to `makeService`'s stub: `createSubproject, updateSubproject, findSubprojectForActor, listSubprojectsForProject, moveTask, subprojectsForProject` (all `vi.fn()`), and rename every `setTaskArchived` test to call `svc.updateTask`. Replace the `createTask` describe and add:

```ts
const SUB = {
  id: 's1',
  projectId: 'p1',
  name: 'Checkout',
  archived: false,
  isDefault: false,
  teamId: 't1',
};
const TASK = {
  id: 'k1',
  projectId: 'p1',
  subprojectId: 's0',
  name: 'Pay',
  archived: false,
  teamId: 't1',
};

describe('ProjectsService.createTask', () => {
  it('404 when the subproject does not exist', async () => {
    const { svc } = makeService({ findSubprojectForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.createTask({ subprojectId: 's9', name: 'T' }, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("403 when the subproject is in another team's project", async () => {
    const { svc, repo } = makeService({
      findSubprojectForActor: vi.fn().mockResolvedValue({ ...SUB, teamId: 't2' }),
    });
    await expect(svc.createTask({ subprojectId: 's1', name: 'T' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.createTask).not.toHaveBeenCalled();
  });

  it('409 when the subproject is archived', async () => {
    const { svc } = makeService({
      findSubprojectForActor: vi.fn().mockResolvedValue({ ...SUB, archived: true }),
    });
    await expect(svc.createTask({ subprojectId: 's1', name: 'T' }, manager)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates with (subprojectId, name, actorId)', async () => {
    const { svc, repo } = makeService({ findSubprojectForActor: vi.fn().mockResolvedValue(SUB) });
    await svc.createTask({ subprojectId: 's1', name: 'T' }, manager);
    expect(repo.createTask).toHaveBeenCalledWith('s1', 'T', 'm1');
  });
});

describe('ProjectsService subprojects', () => {
  it('createSubproject 404s a missing project and 403s another team', async () => {
    const missing = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(
      missing.svc.createSubproject({ projectId: 'p9', name: 'X' }, manager),
    ).rejects.toBeInstanceOf(NotFoundException);
    const other = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't2' }),
    });
    await expect(
      other.svc.createSubproject({ projectId: 'p1', name: 'X' }, manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(other.repo.createSubproject).not.toHaveBeenCalled();
  });

  it('createSubproject creates own-team', async () => {
    const { svc, repo } = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't1' }),
    });
    await svc.createSubproject({ projectId: 'p1', name: 'X' }, manager);
    expect(repo.createSubproject).toHaveBeenCalledWith('p1', 'X', 'm1');
  });

  it('updateSubproject 404 / 403 / 409-on-archiving-default / ok', async () => {
    const missing = makeService({ findSubprojectForActor: vi.fn().mockResolvedValue(null) });
    await expect(
      missing.svc.updateSubproject('s9', { archived: true }, manager),
    ).rejects.toBeInstanceOf(NotFoundException);

    const other = makeService({
      findSubprojectForActor: vi.fn().mockResolvedValue({ ...SUB, teamId: 't2' }),
    });
    await expect(
      other.svc.updateSubproject('s1', { archived: true }, manager),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const dflt = makeService({
      findSubprojectForActor: vi.fn().mockResolvedValue({ ...SUB, isDefault: true }),
    });
    await expect(
      dflt.svc.updateSubproject('s1', { archived: true }, manager),
    ).rejects.toBeInstanceOf(ConflictException);
    // renaming the default is allowed
    await dflt.svc.updateSubproject('s1', { name: 'Misc' }, manager);
    expect(dflt.repo.updateSubproject).toHaveBeenCalledWith('s1', { name: 'Misc' }, 'm1');
  });

  it('listSubprojects 404 / 403 / ok', async () => {
    const other = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't2' }),
    });
    await expect(other.svc.listSubprojects('p1', manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const own = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't1' }),
      listSubprojectsForProject: vi.fn().mockResolvedValue([SUB]),
    });
    await expect(own.svc.listSubprojects('p1', manager)).resolves.toEqual([SUB]);
  });
});

describe('ProjectsService.updateTask — moving', () => {
  it('moves to another subproject of the same project', async () => {
    const { svc, repo } = makeService({
      findTaskForActor: vi.fn().mockResolvedValue(TASK),
      findSubprojectForActor: vi.fn().mockResolvedValue(SUB),
    });
    await svc.updateTask('k1', { subprojectId: 's1' }, manager);
    expect(repo.moveTask).toHaveBeenCalledWith('k1', 's1', 'm1');
  });

  it('422 when the target subproject is in another project', async () => {
    const { svc, repo } = makeService({
      findTaskForActor: vi.fn().mockResolvedValue(TASK),
      findSubprojectForActor: vi.fn().mockResolvedValue({ ...SUB, projectId: 'p2' }),
    });
    await expect(svc.updateTask('k1', { subprojectId: 's1' }, manager)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(repo.moveTask).not.toHaveBeenCalled();
  });

  it('422 when the target subproject does not exist', async () => {
    const { svc } = makeService({
      findTaskForActor: vi.fn().mockResolvedValue(TASK),
      findSubprojectForActor: vi.fn().mockResolvedValue(null),
    });
    await expect(svc.updateTask('k1', { subprojectId: 's9' }, manager)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('409 when the target subproject is archived', async () => {
    const { svc } = makeService({
      findTaskForActor: vi.fn().mockResolvedValue(TASK),
      findSubprojectForActor: vi.fn().mockResolvedValue({ ...SUB, archived: true }),
    });
    await expect(svc.updateTask('k1', { subprojectId: 's1' }, manager)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('a move to the current subproject is a no-op returning the task', async () => {
    const { svc, repo } = makeService({ findTaskForActor: vi.fn().mockResolvedValue(TASK) });
    const { teamId: _t, ...plain } = TASK;
    await expect(svc.updateTask('k1', { subprojectId: 's0' }, manager)).resolves.toEqual(plain);
    expect(repo.moveTask).not.toHaveBeenCalled();
  });

  it("403 moving a task in another team's project", async () => {
    const { svc } = makeService({
      findTaskForActor: vi.fn().mockResolvedValue({ ...TASK, teamId: 't2' }),
    });
    await expect(svc.updateTask('k1', { subprojectId: 's1' }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
```

Import `ConflictException, UnprocessableEntityException` in the spec. In the `detail` test, add `subprojectsForProject: vi.fn().mockResolvedValue([{ subprojectId: 's1', name: 'General', trackedSeconds: 60 }])` and assert `result.subprojects` equals it; add `subprojectId` to the mocked task rows. In `projects.controller.spec.ts`: rename `setTaskArchived` → `updateTask` in the stub, the role list and the delegation test; add `createSubproject`, `updateSubproject`, `listSubprojects` to the stub and to the `it.each` role-gating list, plus one delegation test each, e.g.:

```ts
it('createSubproject passes dto and actor to the service', async () => {
  const { ctrl, service } = make({ createSubproject: vi.fn() });
  await ctrl.createSubproject({ projectId: 'p1', name: 'X' }, actor);
  expect(service.createSubproject).toHaveBeenCalledWith({ projectId: 'p1', name: 'X' }, actor);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @timetrack/api test -- src/modules/projects`
Expected: FAIL.

- [ ] **Step 3: Implement the service**

Imports: add `ConflictException, UnprocessableEntityException` and types `CreateSubproject, Subproject, UpdateSubproject`. Change `notFound()` to take the title: `private notFound(title = 'Project not found'): NotFoundException` and use `title` in the body.

```ts
  async createTask(dto: CreateTask, actor: SessionUser): Promise<Task> {
    const sub = await this.repo.findSubprojectForActor(dto.subprojectId);
    if (!sub) throw this.notFound('Subproject not found');
    this.assertCanAdminister(sub.teamId, actor);
    if (sub.archived) throw this.conflict('Cannot add a task to an archived subproject');
    return this.repo.createTask(dto.subprojectId, dto.name, actor.id);
  }

  async createSubproject(dto: CreateSubproject, actor: SessionUser): Promise<Subproject> {
    const project = await this.repo.findForActor(dto.projectId);
    if (!project) throw this.notFound();
    this.assertCanAdminister(project.teamId, actor);
    return this.repo.createSubproject(dto.projectId, dto.name, actor.id);
  }

  async updateSubproject(id: string, dto: UpdateSubproject, actor: SessionUser): Promise<Subproject> {
    const sub = await this.repo.findSubprojectForActor(id);
    if (!sub) throw this.notFound('Subproject not found');
    this.assertCanAdminister(sub.teamId, actor);
    // The default is where entries with no explicit subproject land; archiving it would leave
    // new time with nowhere assignable to go.
    if (dto.archived === true && sub.isDefault) {
      throw this.conflict('The default subproject cannot be archived');
    }
    return this.repo.updateSubproject(id, dto, actor.id);
  }

  async listSubprojects(projectId: string, actor: SessionUser): Promise<Subproject[]> {
    const project = await this.repo.findForActor(projectId);
    if (!project) throw this.notFound();
    this.assertCanAdminister(project.teamId, actor);
    return this.repo.listSubprojectsForProject(projectId);
  }

  async updateTask(taskId: string, dto: UpdateTask, actor: SessionUser): Promise<Task> {
    const found = await this.repo.findTaskForActor(taskId);
    if (!found) throw this.notFound('Task not found');
    this.assertCanAdminister(found.teamId, actor);
    const { teamId: _teamId, ...task } = found;

    let result: Task = task;
    if (dto.subprojectId !== undefined && dto.subprojectId !== task.subprojectId) {
      const target = await this.repo.findSubprojectForActor(dto.subprojectId);
      // Same project only: moving across projects would silently re-attribute the task's hours.
      if (!target || target.projectId !== task.projectId) {
        throw new UnprocessableEntityException({
          type: 'https://timetrack.internal/errors/unprocessable',
          title: "Subproject is not in this task's project",
          status: 422,
        });
      }
      if (target.archived) throw this.conflict('Cannot move a task into an archived subproject');
      result = await this.repo.moveTask(taskId, dto.subprojectId, actor.id);
    }
    if (dto.archived !== undefined) {
      result = await this.repo.setTaskArchived(taskId, dto.archived, actor.id);
    }
    return result;
  }

  private conflict(title: string): ConflictException {
    return new ConflictException({
      type: 'https://timetrack.internal/errors/conflict',
      title,
      status: 409,
    });
  }
```

Delete `setTaskArchived` from the service. In `detail`, add `this.repo.subprojectsForProject(id, from, to, this.trackingFreshnessSeconds)` to the `Promise.all` (destructure `subprojects`) and pass `subprojects` into `ProjectDetailSchema.parse`.

- [ ] **Step 4: Implement the controller**

Add imports `CreateSubprojectSchema, UpdateSubprojectSchema, type CreateSubproject, type UpdateSubproject, type Subproject`. Add, **before** `@Patch(':id')`:

```ts
  @Post('subprojects')
  @Roles('MANAGER', 'ADMIN')
  createSubproject(
    @Body(new ZodValidationPipe(CreateSubprojectSchema)) dto: CreateSubproject,
    @CurrentUser() actor: SessionUser,
  ): Promise<Subproject> {
    return this.service.createSubproject(dto, actor);
  }

  @Patch('subprojects/:id')
  @Roles('MANAGER', 'ADMIN')
  updateSubproject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSubprojectSchema)) dto: UpdateSubproject,
    @CurrentUser() actor: SessionUser,
  ): Promise<Subproject> {
    return this.service.updateSubproject(id, dto, actor);
  }

  @Get(':id/subprojects')
  @Roles('MANAGER', 'ADMIN')
  listSubprojects(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<Subproject[]> {
    return this.service.listSubprojects(id, user);
  }
```

Rename handler `setTaskArchived` → `updateTask` and call `this.service.updateTask(id, dto, actor)`.

- [ ] **Step 5: Run to verify pass, then typecheck the api**

Run: `pnpm --filter @timetrack/api test -- src/modules/projects && pnpm --filter @timetrack/api typecheck`
Expected: tests PASS. Typecheck may still fail **only** in `time-entries`/`reports`/`admin` (Tasks 5–6); any error in `modules/projects` must be fixed now.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/projects
git commit -m "feat(api): subproject endpoints and task moves between subprojects"
```

---

### Task 5: Time entries — resolve and persist `subprojectId`

**Files:**

- Modify: `apps/api/src/modules/time-entries/time-entries.service.ts`, `time-entries.repository.ts`
- Test: `time-entries.service.spec.ts`, `apps/api/test/time-entries.e2e-spec.ts`

**Interfaces:**

- Consumes: Task 1 columns; Task 2 `TimeEntry.subprojectId`, request `subprojectId?`.
- Produces:
  - `export type SubprojectCandidates = { defaultId: string | null; taskSubprojectId: string | null; requestedBelongs: boolean }` (service file)
  - `export function pickSubproject(input: { projectId: string | null; taskId: string | null; subprojectId?: string | null | undefined }, candidates: SubprojectCandidates | null, mode: 'strict' | 'lenient'): string | null` (service file, pure)
  - `TimeEntriesRepository.subprojectCandidates(projectId: string, taskId: string | null, subprojectId: string | null): Promise<SubprojectCandidates>`
  - `repo.upsert(dto, userId, subprojectId: string | null)`, `repo.createManual(dto, userId, actorId, subprojectId: string | null)`; `repo.update` writes `after.subprojectId` when present; every returned `TimeEntry` has `subprojectId`.

- [ ] **Step 1: Write the failing unit tests** (in `time-entries.service.spec.ts`)

Add `subprojectId: null` to the `existing` fixture and `subprojectCandidates: vi.fn().mockResolvedValue({ defaultId: 'sDef', taskSubprojectId: null, requestedBelongs: false })` to `repoStub`. Import `pickSubproject`. Then:

```ts
describe('pickSubproject', () => {
  const C = { defaultId: 'sDef', taskSubprojectId: 'sTask', requestedBelongs: true };

  it('no project → null, whatever else is sent', () => {
    expect(
      pickSubproject({ projectId: null, taskId: 't', subprojectId: 'sX' }, C, 'strict'),
    ).toBeNull();
  });
  it('project that does not exist (no candidates) → null', () => {
    expect(pickSubproject({ projectId: 'p', taskId: null }, null, 'lenient')).toBeNull();
    expect(
      pickSubproject(
        { projectId: 'p', taskId: null },
        { defaultId: null, taskSubprojectId: null, requestedBelongs: false },
        'lenient',
      ),
    ).toBeNull();
  });
  it('explicit subproject of the project wins', () => {
    expect(pickSubproject({ projectId: 'p', taskId: 't', subprojectId: 'sX' }, C, 'strict')).toBe(
      'sX',
    );
  });
  it('explicit subproject NOT of the project: strict → 422', () => {
    expect(() =>
      pickSubproject(
        { projectId: 'p', taskId: null, subprojectId: 'sX' },
        { ...C, requestedBelongs: false },
        'strict',
      ),
    ).toThrow(UnprocessableEntityException);
  });
  it('explicit subproject NOT of the project: lenient (sync) → falls back, never throws', () => {
    expect(
      pickSubproject(
        { projectId: 'p', taskId: 't', subprojectId: 'sX' },
        { ...C, requestedBelongs: false },
        'lenient',
      ),
    ).toBe('sTask');
    expect(
      pickSubproject(
        { projectId: 'p', taskId: null, subprojectId: 'sX' },
        { ...C, taskSubprojectId: null, requestedBelongs: false },
        'lenient',
      ),
    ).toBe('sDef');
  });
  it("no explicit subproject → task's subproject, else the default", () => {
    expect(pickSubproject({ projectId: 'p', taskId: 't' }, C, 'lenient')).toBe('sTask');
    expect(
      pickSubproject({ projectId: 'p', taskId: null }, { ...C, taskSubprojectId: null }, 'lenient'),
    ).toBe('sDef');
  });
});

describe('TimeEntriesService subproject resolution', () => {
  const syncDto = {
    id: 'e9',
    projectId: 'p1',
    taskId: null,
    startTime: '2026-07-11T09:00:00Z',
    endTime: null,
    source: 'AUTO' as const,
  };

  it('upsert (legacy client shape) stores the default subproject', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    await svc.upsert(syncDto, employee);
    expect(repo.subprojectCandidates).toHaveBeenCalledWith('p1', null, null);
    expect(repo.upsert).toHaveBeenCalledWith(syncDto, 'u1', 'sDef');
  });

  it('upsert with no project skips the lookup entirely (heartbeat hot path)', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    await svc.upsert({ ...syncDto, projectId: null }, employee);
    expect(repo.subprojectCandidates).not.toHaveBeenCalled();
    expect(repo.upsert).toHaveBeenCalledWith({ ...syncDto, projectId: null }, 'u1', null);
  });

  it('upsert never 422s a mismatched subprojectId', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    await expect(svc.upsert({ ...syncDto, subprojectId: 'sX' }, employee)).resolves.toBeDefined();
    expect(repo.upsert).toHaveBeenCalledWith({ ...syncDto, subprojectId: 'sX' }, 'u1', 'sDef');
  });

  it('createManual 422s a mismatched subprojectId', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    await expect(
      svc.createManual(
        {
          id: 'e9',
          projectId: 'p1',
          taskId: null,
          subprojectId: 'sX',
          startTime: '2026-07-11T09:00:00Z',
          endTime: '2026-07-11T10:00:00Z',
        },
        employee,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.createManual).not.toHaveBeenCalled();
  });

  it('edit re-resolves when the project changes and records the subproject in the diff', async () => {
    const repo = repoStub({
      findForEdit: vi
        .fn()
        .mockResolvedValue({ ...existing, projectId: 'pOld', subprojectId: 'sOld' }),
    });
    const svc = new TimeEntriesService(repo, accessStub());
    await svc.edit('e1', { projectId: 'p1' }, employee);
    expect(repo.update).toHaveBeenCalledWith(
      'e1',
      { projectId: 'p1', subprojectId: 'sDef' },
      { projectId: 'pOld', subprojectId: 'sOld' },
      'u1',
    );
  });

  it('edit touching only note does not look up subprojects', async () => {
    const repo = repoStub();
    const svc = new TimeEntriesService(repo, accessStub());
    await svc.edit('e1', { note: 'x' }, employee);
    expect(repo.subprojectCandidates).not.toHaveBeenCalled();
  });

  it('edit sending the SAME assignment is still a no-op 422', async () => {
    const repo = repoStub({
      findForEdit: vi
        .fn()
        .mockResolvedValue({ ...existing, projectId: 'p1', subprojectId: 'sDef' }),
    });
    const svc = new TimeEntriesService(repo, accessStub());
    await expect(
      svc.edit('e1', { projectId: 'p1', taskId: null, subprojectId: 'sDef' }, employee),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
```

(For the last test the stub must say `requestedBelongs: true`; override `subprojectCandidates` there with `mockResolvedValue({ defaultId: 'sDef', taskSubprojectId: null, requestedBelongs: true })`.)

Fix every existing `repo.upsert` / `repo.createManual` call expectation in this spec to include the new trailing argument (`null` where `projectId` is null).

- [ ] **Step 2: Write the failing e2e tests** (in `apps/api/test/time-entries.e2e-spec.ts`)

Add a helper that creates a project + default + task via raw Prisma (this spec does not use `ProjectsRepository`):

```ts
async function seedProject(teamId: string) {
  const project = await db.prisma.project.create({
    data: { teamId, name: 'P' },
    select: { id: true },
  });
  const general = await db.prisma.subproject.create({
    data: { projectId: project.id, name: 'General', isDefault: true },
    select: { id: true },
  });
  const other = await db.prisma.subproject.create({
    data: { projectId: project.id, name: 'Other' },
    select: { id: true },
  });
  const task = await db.prisma.task.create({
    data: { projectId: project.id, subprojectId: other.id, name: 'T' },
    select: { id: true },
  });
  return { projectId: project.id, generalId: general.id, otherId: other.id, taskId: task.id };
}
```

(`seedUser` returns `teamId`.) Tests:

```ts
describe('subprojectCandidates', () => {
  it('reports the default, the task subproject (same project only), and requested membership', async () => {
    const user = await seedUser();
    const a = await seedProject(user.teamId);
    const b = await seedProject(user.teamId);
    expect(await repo().subprojectCandidates(a.projectId, a.taskId, a.otherId)).toEqual({
      defaultId: a.generalId,
      taskSubprojectId: a.otherId,
      requestedBelongs: true,
    });
    // task and requested subproject from ANOTHER project don't count
    expect(await repo().subprojectCandidates(a.projectId, b.taskId, b.otherId)).toEqual({
      defaultId: a.generalId,
      taskSubprojectId: null,
      requestedBelongs: false,
    });
  });

  it('an unknown project yields no candidates (entry keeps a null subproject, never a 500)', async () => {
    expect(
      await repo().subprojectCandidates('019797a0-0000-7000-8000-0000000000ff', null, null),
    ).toEqual({ defaultId: null, taskSubprojectId: null, requestedBelongs: false });
  });
});

it('upsert stores subprojectId on create and does not overwrite it on a later heartbeat', async () => {
  const user = await seedUser();
  const a = await seedProject(user.teamId);
  const id = '019797a0-0000-7000-8000-000000000301';
  const first = await repo().upsert(
    { ...createDto(id), projectId: a.projectId },
    user.id,
    a.generalId,
  );
  expect(first.subprojectId).toBe(a.generalId);
  const beat = await repo().upsert(
    { ...createDto(id), projectId: a.projectId },
    user.id,
    a.otherId,
  );
  expect(beat.subprojectId).toBe(a.generalId); // sync never re-assigns; edits go through PATCH
});

it('upsert with an unknown project id stores null subproject', async () => {
  const user = await seedUser();
  const row = await repo().upsert(
    {
      ...createDto('019797a0-0000-7000-8000-000000000302'),
      projectId: '019797a0-0000-7000-8000-0000000000ff',
    },
    user.id,
    null,
  );
  expect(row.subprojectId).toBeNull();
});

it('update writes subprojectId and audits it', async () => {
  const user = await seedUser();
  const a = await seedProject(user.teamId);
  const id = '019797a0-0000-7000-8000-000000000303';
  await repo().upsert(
    { ...createDto(id, { endTime: '2026-07-11T10:00:00Z' }), projectId: a.projectId },
    user.id,
    a.generalId,
  );
  const row = await repo().update(
    id,
    { subprojectId: a.otherId },
    { subprojectId: a.generalId },
    user.id,
  );
  expect(row.subprojectId).toBe(a.otherId);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @timetrack/api test -- src/modules/time-entries` and `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/time-entries.e2e-spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the repository**

Add `subprojectId: true` to `TIME_ENTRY_SELECT` (after `taskId`), `subprojectId: string | null` to `serialize`'s param type and `subprojectId: row.subprojectId` to its result.

- `upsert(dto, userId, subprojectId: string | null)` → pass it to `upsertEntry`; in `upsertEntry`'s `create` add `subprojectId,` after `taskId`. **Do not** add it to `update` (sync never re-assigns; a comment should say so, mirroring the `note` comment).
- `createManual(dto, userId, actorId, subprojectId: string | null)` → `data.subprojectId = subprojectId`, and add `subprojectId` to the audit `diff`.
- `update`: add `if ('subprojectId' in after) data.subprojectId = after.subprojectId ?? null;`.
- New method:

```ts
  /**
   * Everything the service needs to pick an entry's subproject, in ONE round trip — it runs on
   * every sync upsert that names a project, heartbeats included. Pure lookups: which subproject
   * to use is TimeEntriesService's decision (pickSubproject), not this query's.
   *
   * An unknown project yields all-null/false, which the service turns into a null subproject:
   * shipped clients can hold ids of projects that no longer exist, and failing that write would
   * be a retry-forever 500.
   */
  async subprojectCandidates(
    projectId: string,
    taskId: string | null,
    subprojectId: string | null,
  ): Promise<{ defaultId: string | null; taskSubprojectId: string | null; requestedBelongs: boolean }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ defaultId: string | null; taskSubprojectId: string | null; requestedBelongs: boolean }>
    >`
      SELECT
        (SELECT s.id FROM subprojects s
          WHERE s."projectId" = ${projectId} AND s."isDefault") AS "defaultId",
        (SELECT t."subprojectId" FROM tasks t
          WHERE t.id = ${taskId}::text AND t."projectId" = ${projectId}) AS "taskSubprojectId",
        EXISTS (SELECT 1 FROM subprojects s
          WHERE s.id = ${subprojectId}::text AND s."projectId" = ${projectId}) AS "requestedBelongs"
    `;
    const r = rows[0];
    return {
      defaultId: r?.defaultId ?? null,
      taskSubprojectId: r?.taskSubprojectId ?? null,
      requestedBelongs: r?.requestedBelongs ?? false,
    };
  }
```

- [ ] **Step 5: Implement the service**

Add at module level (below `EDITABLE_KEYS`; leave `EDITABLE_KEYS` unchanged — subproject is derived, handled separately):

```ts
export type SubprojectCandidates = {
  defaultId: string | null;
  taskSubprojectId: string | null;
  requestedBelongs: boolean;
};

/**
 * Which subproject an entry belongs to (spec §2 "Subproject resolution"):
 *   1. no project → none;
 *   2. an explicit subproject of that project → it. One from another project is a 422 on the
 *      dashboard paths ('strict') but ignored on the sync path ('lenient'): a 4xx is permanent to
 *      the uploader and would drop recorded time;
 *   3. the task's subproject, when the task is in that project;
 *   4. the project's default. A project that does not exist has no default → none.
 */
export function pickSubproject(
  input: {
    projectId: string | null;
    taskId: string | null;
    subprojectId?: string | null | undefined;
  },
  candidates: SubprojectCandidates | null,
  mode: 'strict' | 'lenient',
): string | null {
  if (input.projectId === null || candidates === null) return null;
  if (input.subprojectId) {
    if (candidates.requestedBelongs) return input.subprojectId;
    if (mode === 'strict') {
      throw new UnprocessableEntityException({
        type: 'https://timetrack.internal/errors/unprocessable',
        title: 'Subproject does not belong to the project',
        status: 422,
      });
    }
  }
  return candidates.taskSubprojectId ?? candidates.defaultId;
}
```

In the class:

```ts
  private async resolveSubproject(
    input: { projectId: string | null; taskId: string | null; subprojectId?: string | null | undefined },
    mode: 'strict' | 'lenient',
  ): Promise<string | null> {
    // No lookup for an entry with no project — that is most auto-tracked heartbeats.
    if (input.projectId === null) return null;
    const candidates = await this.repo.subprojectCandidates(
      input.projectId,
      input.taskId,
      input.subprojectId ?? null,
    );
    return pickSubproject(input, candidates, mode);
  }
```

- `upsert`: `const subprojectId = await this.resolveSubproject(dto, 'lenient'); return this.repo.upsert(dto, user.id, subprojectId);`
- `createManual`: after the overlap check, `const subprojectId = await this.resolveSubproject(dto, 'strict');` then `this.repo.createManual(dto, targetUserId, actor.id, subprojectId)`.
- `edit`: replace the block from `const { before, after } = diffChangedFields(current, dto);` to the empty-check with:

```ts
    const { before, after } = diffChangedFields(current, dto);
    // The subproject is derived, not free-form: re-resolve whenever the assignment is touched.
    // An explicit subprojectId in the patch is validated (strict); a project/task change without
    // one re-derives it (task's subproject, else the project's default).
    if ('projectId' in dto || 'taskId' in dto || 'subprojectId' in dto) {
      const projectId = 'projectId' in dto ? (dto.projectId ?? null) : current.projectId;
      const taskId = 'taskId' in dto ? (dto.taskId ?? null) : current.taskId;
      const requested =
        'subprojectId' in dto
          ? (dto.subprojectId ?? null)
          : 'projectId' in dto || 'taskId' in dto
            ? null
            : current.subprojectId;
      const resolved = await this.resolveSubproject({ projectId, taskId, subprojectId: requested }, 'strict');
      if (resolved !== current.subprojectId) {
        before.subprojectId = current.subprojectId;
        after.subprojectId = resolved;
      }
    }
    if (Object.keys(after).length === 0) { …existing 422… }
```

(`before`/`after` are typed `UpdateTimeEntry`, which now has `subprojectId?: string | null`, so the assignments typecheck.)

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @timetrack/api test -- src/modules/time-entries && RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/time-entries.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/time-entries apps/api/test/time-entries.e2e-spec.ts
git commit -m "feat(api): derive and store the subproject of every time entry"
```

---

### Task 6: CSV export column + admin export field

**Files:**

- Modify: `apps/api/src/modules/reports/csv-writer.ts`, `reports.repository.ts` (streamEntries ~L585–670), `apps/api/src/modules/admin/admin.repository.ts:~196`
- Test: `apps/api/src/modules/reports/csv-writer.spec.ts`, `apps/api/test/reports.e2e-spec.ts` (the "joins user/project/task names" test ~L1830)

**Interfaces:**

- Produces: `CSV_COLUMNS` ends with `'subproject'`; `CsvEntryRow.subproject: string | null`.

- [ ] **Step 1: Write the failing tests**

In `csv-writer.spec.ts`: update the header expectation to `'entryId,user,project,task,startTime,endTime,durationSeconds,source,note,subproject\r\n'`, add `subproject` to every row fixture, and add:

```ts
it('appends subproject as the LAST column so positional parsers keep working', () => {
  expect(CSV_COLUMNS.indexOf('task')).toBe(3);
  expect(CSV_COLUMNS.at(-1)).toBe('subproject');
});

it('neutralizes a formula-leading subproject name', () => {
  const line = formatCsvRow({ ...row, subproject: '=HYPERLINK("x")' });
  expect(line.trimEnd().endsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
});
```

(`row` = the spec's existing base row fixture; read the spec and use its name.) In `reports.e2e-spec.ts`'s "joins user/project/task names" test, set `subprojectId: sp.id` on the time entry (sp from Task 3 Step 1) and expect `subproject: 'General'` on the streamed row.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @timetrack/api test -- src/modules/reports/csv-writer.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`csv-writer.ts`: append `'subproject',` to `CSV_COLUMNS` (after `'note'`), add `subproject: string | null;` to `CsvEntryRow`, append `textCell(row.subproject),` as the last element of `fields`.

`reports.repository.ts` streamEntries: add `subproject: string | null;` to `StreamEntriesRow`, `s.name AS "subproject",` to the SELECT list (after `t.name AS "task"`), `LEFT JOIN subprojects s ON s.id = te."subprojectId"` after the tasks join, and `subproject: r.subproject,` to the yielded object.

`admin.repository.ts` `streamTimeEntries`: add `subprojectId: true,` after `taskId: true` (the per-user data export should carry the column the entry now has).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @timetrack/api test -- src/modules/reports && RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/reports.e2e-spec.ts && RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/admin-export.e2e-spec.ts`
Expected: PASS. If admin-export asserts an exact key list, add `subprojectId` there.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports apps/api/src/modules/admin/admin.repository.ts apps/api/test/reports.e2e-spec.ts apps/api/test/admin-export.e2e-spec.ts
git commit -m "feat(api): export the subproject as the last CSV column"
```

---

### Task 7: Worker — runaway split keeps the subproject

**Files:**

- Modify: `apps/worker/src/processors/runaway-entry-trim.ts` (~L167–260)
- Test: `apps/worker/test/runaway-entry-trim.e2e-spec.ts`

- [ ] **Step 1: Write the failing test** (after "splits the span into the stretches…")

```ts
it('copies project, task and subproject onto every split-off entry', async () => {
  const user = await seedUser();
  await seedRunaway(user.id);
  // No FKs on these columns — arbitrary ids are enough to prove they are carried over.
  const assignment = {
    projectId: '019797a0-0000-7000-8000-0000000000a1',
    taskId: '019797a0-0000-7000-8000-0000000000a2',
    subprojectId: '019797a0-0000-7000-8000-0000000000a3',
  };
  await env.prisma.timeEntry.update({ where: { id: RUNAWAY }, data: assignment });

  await trimRunawayEntries(env.prisma, { minHours: 12, apply: true, now: NOW });

  const rows = await env.prisma.timeEntry.findMany({
    select: { projectId: true, taskId: true, subprojectId: true },
  });
  expect(rows).toHaveLength(2);
  for (const r of rows) expect(r).toEqual(assignment);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `RUN_E2E=1 pnpm --filter @timetrack/worker test:e2e -- test/runaway-entry-trim.e2e-spec.ts`
Expected: FAIL (split-off row has `subprojectId: null`).

- [ ] **Step 3: Implement** — add `subprojectId: true,` to the candidates `select` (after `taskId`) and `subprojectId: entry.subprojectId,` to each `added` row (after `taskId`).

- [ ] **Step 4: Run to verify pass** (same command) — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/processors/runaway-entry-trim.ts apps/worker/test/runaway-entry-trim.e2e-spec.ts
git commit -m "fix(worker): keep the subproject on split-off runaway entries"
```

---

### Task 8: Dashboard — subprojects on the project page

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts` (~L306–320), `app/(app)/projects/actions.ts`, `app/(app)/projects/archive-toast.ts`, `lib/project-detail-view.ts`, `components/projects/NewTaskForm.tsx`, `components/projects/ProjectDetailContent.tsx`, `lib/projects-index-view.ts`, `components/projects/ProjectsList.tsx`
- Create: `components/projects/NewSubprojectForm.tsx`, `components/projects/SubprojectArchiveToggle.tsx`, `components/projects/TaskMoveForm.tsx`
- Test: `lib/project-detail-view.spec.ts`, `lib/projects-index-view.spec.ts`, `app/(app)/projects/actions.spec.ts`

**Interfaces:**

- Consumes: Task 2 contracts; Task 4 routes.
- Produces:
  - `api.listProjectSubprojects(token, projectId): Promise<Subproject[]>`, `api.createSubproject(token, dto: CreateSubproject): Promise<Subproject>`, `api.archiveSubproject(token, id, archived): Promise<Subproject>`, `api.moveTask(token, id, subprojectId): Promise<Task>`
  - `groupTasksBySubproject(subprojects: Subproject[], tasks: Task[], hours: ProjectSubprojectRow[]): SubprojectGroup[]` where `SubprojectGroup = { subproject: Subproject; trackedSeconds: number; tasks: Task[] }`
  - Server actions `createSubprojectAction`, `archiveSubprojectAction`, `moveTaskAction` (same `(prev, formData) => Promise<ProjectActionState>` shape)
  - `ProjectIndexRow.subprojectCount: number`

- [ ] **Step 1: Write the failing view tests**

`lib/project-detail-view.spec.ts`:

```ts
import { groupTasksBySubproject } from './project-detail-view';

const sub = (
  id: string,
  name: string,
  extra: Partial<{ archived: boolean; isDefault: boolean }> = {},
) => ({
  id,
  projectId: 'p',
  name,
  archived: false,
  isDefault: false,
  ...extra,
});
const task = (id: string, subprojectId: string, name: string) => ({
  id,
  projectId: 'p',
  subprojectId,
  name,
  archived: false,
});

describe('groupTasksBySubproject', () => {
  it('keeps the API order (default first), nests tasks, and attaches hours', () => {
    const groups = groupTasksBySubproject(
      [sub('g', 'General', { isDefault: true }), sub('c', 'Checkout')],
      [task('t1', 'c', 'Pay'), task('t2', 'g', 'Kickoff')],
      [{ subprojectId: 'c', name: 'Checkout', trackedSeconds: 3600 }],
    );
    expect(
      groups.map((g) => [g.subproject.name, g.trackedSeconds, g.tasks.map((t) => t.name)]),
    ).toEqual([
      ['General', 0, ['Kickoff']],
      ['Checkout', 3600, ['Pay']],
    ]);
  });

  it('drops tasks whose subproject is not in the list rather than crashing', () => {
    expect(
      groupTasksBySubproject(
        [sub('g', 'General', { isDefault: true })],
        [task('t', 'zz', 'Orphan')],
        [],
      )[0]?.tasks,
    ).toEqual([]);
  });
});
```

`lib/projects-index-view.spec.ts`: add a case that a project with `subprojects: [General(active), Old(archived), Checkout(active)]` yields `subprojectCount: 2`, and one without `subprojects` yields `0`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/project-detail-view.spec.ts src/lib/projects-index-view.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement views**

`lib/project-detail-view.ts`:

```ts
import type { ProjectSubprojectRow, Subproject, Task } from '@timetrack/contracts';

export type SubprojectGroup = { subproject: Subproject; trackedSeconds: number; tasks: Task[] };

/** Tasks nested under their subproject, in the order the API lists subprojects (default first). */
export function groupTasksBySubproject(
  subprojects: Subproject[],
  tasks: Task[],
  hours: ProjectSubprojectRow[],
): SubprojectGroup[] {
  const secondsById = new Map(hours.map((h) => [h.subprojectId, h.trackedSeconds]));
  return subprojects.map((subproject) => ({
    subproject,
    trackedSeconds: secondsById.get(subproject.id) ?? 0,
    tasks: tasks.filter((t) => t.subprojectId === subproject.id),
  }));
}
```

`lib/projects-index-view.ts`: add `subprojectCount: number;` (doc: "Active subprojects, including the default") to the row type and compute `subprojectCount: (p.subprojects ?? []).filter((s) => !s.archived).length`.

- [ ] **Step 4: Run to verify pass** (same command) — Expected: PASS.

- [ ] **Step 5: API client + actions**

`lib/api-client.ts` — import `SubprojectSchema, type Subproject, type CreateSubproject` and add next to the task calls:

```ts
  listProjectSubprojects: (token: string, id: string): Promise<Subproject[]> =>
    get(`/projects/${id}/subprojects`, z.array(SubprojectSchema), token),
  createSubproject: (token: string, dto: CreateSubproject): Promise<Subproject> =>
    send('POST', '/projects/subprojects', dto, SubprojectSchema, token),
  archiveSubproject: (token: string, id: string, archived: boolean): Promise<Subproject> =>
    send('PATCH', `/projects/subprojects/${id}`, { archived }, SubprojectSchema, token),
  moveTask: (token: string, id: string, subprojectId: string): Promise<Task> =>
    send('PATCH', `/projects/tasks/${id}`, { subprojectId }, TaskSchema, token),
```

`archive-toast.ts`: widen the noun to `'Project' | 'Subproject' | 'Task'`.

`projects/actions.ts` — import `CreateSubprojectSchema, UpdateSubprojectSchema`. Replace `createTaskAction`'s parse with:

```ts
const rawProjectId = formData.get('projectId');
const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';
const parsed = CreateTaskSchema.safeParse({
  subprojectId: formData.get('subprojectId'),
  name: formData.get('name'),
});
if (!parsed.success) return { ok: false, message: 'Enter a task name.' };
```

(`projectId` stays a hidden field only for `revalidatePath`.) Add:

```ts
export async function createSubprojectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const parsed = CreateSubprojectSchema.safeParse({
    projectId: formData.get('projectId'),
    name: formData.get('name'),
  });
  if (!parsed.success) return { ok: false, message: 'Enter a subproject name.' };

  try {
    await api.createSubproject(session.accessToken, parsed.data);
    revalidatePath(`/projects/${parsed.data.projectId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof ApiError ? e.message : 'Could not add the subproject.',
    };
  }
}

export async function archiveSubprojectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const rawProjectId = formData.get('projectId');
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';
  const archived = formData.get('archived') === 'true';
  const parsed = UpdateSubprojectSchema.safeParse({ archived });
  if (!id || !parsed.success) return { ok: false, message: 'Invalid request.' };

  try {
    await api.archiveSubproject(session.accessToken, id, archived);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    return { ok: true, archived };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}

export async function moveTaskAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const rawProjectId = formData.get('projectId');
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';
  const parsed = UpdateTaskSchema.safeParse({ subprojectId: formData.get('subprojectId') });
  if (!id || !parsed.success || parsed.data.subprojectId === undefined) {
    return { ok: false, message: 'Pick a subproject.' };
  }

  try {
    await api.moveTask(session.accessToken, id, parsed.data.subprojectId);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Move failed.' };
  }
}
```

In `actions.spec.ts` follow its existing mocking pattern (read it) and add: `createTaskAction` sends `{ subprojectId, name }` (no `projectId`) to `api.createTask`; `createSubprojectAction` refuses an EMPLOYEE session with "Not authorized." and calls `api.createSubproject` for a MANAGER; `moveTaskAction` rejects a missing `subprojectId` with "Pick a subproject." without calling the API.

- [ ] **Step 6: Components**

`NewSubprojectForm.tsx` — copy `NewTaskForm.tsx`'s structure exactly, with `createSubprojectAction`, toast `'Subproject added'`, placeholder `New subproject`, button `Add subproject` / `Adding…`, hidden `projectId`.

`SubprojectArchiveToggle.tsx` — copy `TaskArchiveToggle.tsx`, with `archiveSubprojectAction` and `archiveToastMessage('Subproject', s)`.

`NewTaskForm.tsx` — add prop `subprojects: Subproject[]` (active ones only are passed in) and, before the name input:

```tsx
<select
  name="subprojectId"
  required
  defaultValue={subprojects.find((s) => s.isDefault)?.id ?? subprojects[0]?.id}
  aria-label="Subproject"
  className="bg-surface border-separator text-text focus:border-accent rounded-md border px-2.5 py-1.5 text-label outline-none"
>
  {subprojects.map((s) => (
    <option key={s.id} value={s.id}>
      {s.name}
    </option>
  ))}
</select>
```

`TaskMoveForm.tsx` (`'use client'`, `useToastAction(moveTaskAction, INITIAL, 'Task moved')`): a form with hidden `id` and `projectId`, a `<select name="subprojectId" aria-label="Move to subproject">` of the given active `subprojects` with `defaultValue={currentSubprojectId}`, and a small secondary `Move` button (same classes as `TaskArchiveToggle`'s button). Props: `{ id: string; projectId: string; currentSubprojectId: string; subprojects: Subproject[] }`.

`ProjectDetailContent.tsx`:

- `loadProjectDetail`: fetch subprojects alongside tasks, degradeable in the same try:
  ```ts
  let subprojects: Subproject[] = [];
  …
      [tasks, subprojects] = await Promise.all([
        api.listProjectTasks(session.accessToken, projectId),
        api.listProjectSubprojects(session.accessToken, projectId),
      ]);
  ```
  (on catch set both to `[]`) and return `subprojects`.
- Replace the `Tasks` section with a `Subprojects & tasks` section: header row with `<NewSubprojectForm projectId=…/>` and `<NewTaskForm projectId=… subprojects={active}/>` where `const active = subprojects.filter((s) => !s.archived)`. Then `groupTasksBySubproject(subprojects, tasks, detail.subprojects).map(group => …)` renders one bordered list per group: header shows the name, a `Default` pill when `isDefault`, an `Archived` pill when archived, `formatDuration(group.trackedSeconds)`, and `SubprojectArchiveToggle` **only when `!isDefault`**. Rows are the existing task row markup plus `<TaskMoveForm … subprojects={active} currentSubprojectId={task.subprojectId}/>` before `TaskArchiveToggle`. Empty group → `No tasks yet.` caption. Keep the `By task` chart.

`ProjectsList.tsx` (~L73): render `${row.subprojectCount} subproject(s) · ` before the existing task-count text:

```tsx
                  {row.subprojectCount} {row.subprojectCount === 1 ? 'subproject' : 'subprojects'} ·{' '}
                  {row.taskCount === 0 ? 'no tasks' : `${row.taskCount} ${row.taskCount === 1 ? 'task' : 'tasks'}`}
```

(and widen `min-w-[130px]` to `min-w-[190px]`). Update `ProjectsList.spec.tsx` fixtures with `subprojectCount`.

- [ ] **Step 7: Run dashboard checks**

Run: `pnpm --filter @timetrack/dashboard test && pnpm --filter @timetrack/dashboard typecheck`
Expected: PASS. Typecheck errors may remain only in `/me`/day-view files (Task 9).

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/lib apps/dashboard/src/app/\(app\)/projects apps/dashboard/src/components/projects
git commit -m "feat(dashboard): manage subprojects and move tasks on the project page"
```

---

### Task 9: Dashboard — assign entries to a subproject/task

**Files:**

- Modify: `apps/dashboard/src/lib/entry-form.ts`, `components/day/EntryFormFields.tsx`, `components/day/EntryRowActions.tsx` (~L114), `components/day/AddTimeEntryForm.tsx` (~L72), `app/(app)/me/actions.ts` (~L113–180), `lib/person-day-view.ts`
- Test: `lib/entry-form.spec.ts`, `lib/person-day-view.spec.ts` (grep for the existing label tests), `app/(app)/me/actions.spec.ts`

**Interfaces:**

- Produces (in `lib/entry-form.ts`):
  - `type Assignment = { projectId: string | null; subprojectId: string | null; taskId: string | null }`
  - `encodeAssignment(a: Assignment): string` — `''` when `projectId` is null, else `` `${projectId}|${subprojectId ?? ''}|${taskId ?? ''}` ``
  - `parseAssignment(raw: FormDataEntryValue | null): Assignment | null` — `null` = malformed
  - `type AssignmentGroup = { label: string; options: { value: string; label: string }[] }`
  - `assignmentGroups(projects: Project[], current: Assignment | null): AssignmentGroup[]`
- `DayEntryRow` gains `subprojectId: string | null` and `subprojectName: string | null`.

- [ ] **Step 1: Write the failing tests** (`lib/entry-form.spec.ts`)

```ts
import { assignmentGroups, encodeAssignment, parseAssignment } from './entry-form';

const P = '018f9c1e-0000-7000-8000-000000000001';
const G = '018f9c1e-0000-7000-8000-000000000002';
const C = '018f9c1e-0000-7000-8000-000000000003';
const T = '018f9c1e-0000-7000-8000-000000000004';

const project = (over: Record<string, unknown> = {}) => ({
  id: P,
  teamId: P,
  name: 'Website',
  color: null,
  archived: false,
  subprojects: [
    { id: G, projectId: P, name: 'General', archived: false, isDefault: true },
    { id: C, projectId: P, name: 'Checkout', archived: false, isDefault: false },
  ],
  tasks: [{ id: T, projectId: P, subprojectId: C, name: 'Pay form', archived: false }],
  ...over,
});

describe('assignment encoding', () => {
  it('round-trips a full and a partial assignment', () => {
    for (const a of [
      { projectId: P, subprojectId: C, taskId: T },
      { projectId: P, subprojectId: G, taskId: null },
      { projectId: null, subprojectId: null, taskId: null },
    ]) {
      expect(parseAssignment(encodeAssignment(a))).toEqual(a);
    }
  });

  it('rejects malformed values', () => {
    expect(parseAssignment('nope')).toBeNull();
    expect(parseAssignment(`${P}|x|`)).toBeNull();
    expect(parseAssignment(null)).toEqual({ projectId: null, subprojectId: null, taskId: null });
  });
});

describe('assignmentGroups', () => {
  it('one group per project; a subproject option then its tasks, default first', () => {
    expect(assignmentGroups([project()], null)).toEqual([
      {
        label: 'Website',
        options: [
          { value: `${P}|${G}|`, label: 'General' },
          { value: `${P}|${C}|`, label: 'Checkout' },
          { value: `${P}|${C}|${T}`, label: 'Checkout › Pay form' },
        ],
      },
    ]);
  });

  it('omits archived projects and subprojects…', () => {
    const p = project({
      subprojects: [
        { id: G, projectId: P, name: 'General', archived: false, isDefault: true },
        { id: C, projectId: P, name: 'Checkout', archived: true, isDefault: false },
      ],
    });
    expect(assignmentGroups([p], null)[0]?.options.map((o) => o.label)).toEqual(['General']);
    expect(assignmentGroups([project({ archived: true })], null)).toEqual([]);
  });

  it('…but keeps the CURRENT assignment so saving an edit never silently reassigns it', () => {
    const p = project({
      subprojects: [
        { id: G, projectId: P, name: 'General', archived: false, isDefault: true },
        { id: C, projectId: P, name: 'Checkout', archived: true, isDefault: false },
      ],
      tasks: [],
    });
    const current = { projectId: P, subprojectId: C, taskId: T };
    const values = assignmentGroups([p], current).flatMap((g) => g.options.map((o) => o.value));
    expect(values).toContain(encodeAssignment(current));
  });

  it('keeps a current assignment whose project is not in the list', () => {
    const current = { projectId: T, subprojectId: null, taskId: null };
    const groups = assignmentGroups([], current);
    expect(groups).toEqual([
      {
        label: 'Current',
        options: [{ value: encodeAssignment(current), label: 'Current assignment' }],
      },
    ]);
  });
});
```

In the person-day-view spec, add: an entry with `projectId: P, subprojectId: C, taskId: T` and no note labels `'Website · Checkout · Pay form'`; with `subprojectId: G` (default) and no task labels `'Website'`. Add `subprojectId: null` to every existing `TimeEntry` fixture in that file.

In `me/actions.spec.ts` (follow its mocking pattern): `updateEntryAction` with `assignment = "${P}|${C}|${T}"` calls `api.updateTimeEntry` with `projectId: P, subprojectId: C, taskId: T`; with `assignment = ''` sends all three `null`; with `assignment = 'garbage'` returns `{ ok: false, message: 'Pick a project.' }` and does not call the API. Same three cases for `createManualEntryAction`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/entry-form.spec.ts src/lib/person-day-view.spec.ts "src/app/(app)/me/actions.spec.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement `entry-form.ts` helpers** (append; add `import type { Project } from '@timetrack/contracts';`)

```ts
/**
 * An entry's assignment, carried by ONE grouped <select> as `projectId|subprojectId|taskId` so
 * the form needs no client-side cascade. '' means "No project".
 */
export type Assignment = {
  projectId: string | null;
  subprojectId: string | null;
  taskId: string | null;
};
export type AssignmentGroup = { label: string; options: { value: string; label: string }[] };

const NONE: Assignment = { projectId: null, subprojectId: null, taskId: null };
const ID = /^[0-9a-f-]{36}$/i;

export function encodeAssignment(a: Assignment): string {
  if (a.projectId === null) return '';
  return `${a.projectId}|${a.subprojectId ?? ''}|${a.taskId ?? ''}`;
}

/** null = malformed (a tampered or stale form); the caller refuses rather than guessing. */
export function parseAssignment(raw: FormDataEntryValue | null): Assignment | null {
  if (raw === null || raw === '') return NONE;
  if (typeof raw !== 'string') return null;
  const parts = raw.split('|');
  if (parts.length !== 3) return null;
  const [projectId, subprojectId, taskId] = parts as [string, string, string];
  if (!ID.test(projectId)) return null;
  if (subprojectId !== '' && !ID.test(subprojectId)) return null;
  if (taskId !== '' && !ID.test(taskId)) return null;
  return { projectId, subprojectId: subprojectId || null, taskId: taskId || null };
}

/**
 * The select's options: per project, each subproject (default first, as the API orders them)
 * followed by its tasks as `Subproject › Task`. Archived projects/subprojects are not offered —
 * EXCEPT the entry's current assignment, which is always present so that saving an unrelated
 * change (a time, a note) can never silently move the entry.
 */
export function assignmentGroups(
  projects: Project[],
  current: Assignment | null,
): AssignmentGroup[] {
  const currentValue = current && current.projectId !== null ? encodeAssignment(current) : null;
  let currentOffered = false;

  const groups: AssignmentGroup[] = [];
  for (const p of projects) {
    const isCurrentProject = current?.projectId === p.id;
    if (p.archived && !isCurrentProject) continue;
    const options: AssignmentGroup['options'] = [];
    for (const s of p.subprojects ?? []) {
      if (s.archived && current?.subprojectId !== s.id) continue;
      options.push({
        value: encodeAssignment({ projectId: p.id, subprojectId: s.id, taskId: null }),
        label: s.name,
      });
      for (const t of (p.tasks ?? []).filter((t) => t.subprojectId === s.id)) {
        options.push({
          value: encodeAssignment({ projectId: p.id, subprojectId: s.id, taskId: t.id }),
          label: `${s.name} › ${t.name}`,
        });
      }
    }
    if (currentValue && options.some((o) => o.value === currentValue)) currentOffered = true;
    if (isCurrentProject && currentValue && !currentOffered) {
      options.push({ value: currentValue, label: 'Current assignment' });
      currentOffered = true;
    }
    if (options.length > 0) groups.push({ label: p.name, options });
  }
  if (currentValue && !currentOffered) {
    groups.push({
      label: 'Current',
      options: [{ value: currentValue, label: 'Current assignment' }],
    });
  }
  return groups;
}
```

- [ ] **Step 4: Form + actions**

`EntryFormFields.tsx`: replace `projectId: string | null` in `defaults` with `assignment: Assignment | null`, and replace the Project `<label>` block with:

```tsx
<label className="flex flex-col gap-1">
  <span className="text-caption text-text-secondary">Assign to</span>
  <select
    name="assignment"
    defaultValue={defaults.assignment ? encodeAssignment(defaults.assignment) : ''}
    className="border-separator bg-surface text-text rounded-md border px-2.5 py-1.5 text-[13px]"
  >
    <option value="">No project</option>
    {assignmentGroups(projects, defaults.assignment).map((g) => (
      <optgroup key={g.label} label={g.label}>
        {g.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
    ))}
  </select>
</label>
```

(import `assignmentGroups, encodeAssignment, type Assignment` from `../../lib/entry-form`). Update the component's doc comment ("The four inputs…" → mention the assignment select).

`EntryRowActions.tsx`: `assignment: { projectId: entry.projectId, subprojectId: entry.subprojectId, taskId: entry.taskId }`. `AddTimeEntryForm.tsx`: `assignment: null`.

`me/actions.ts`: import `parseAssignment`. In both actions, after the `times` check:

```ts
const assignment = parseAssignment(formData.get('assignment'));
if (!assignment) return { ok: false, message: 'Pick a project.' };
```

and replace the `projectId:`/`taskId:` lines in both API calls with `projectId: assignment.projectId, subprojectId: assignment.subprojectId, taskId: assignment.taskId,`. (This also fixes the pre-existing bug where every edit sent `taskId: null`.)

- [ ] **Step 5: Day-view labels** (`lib/person-day-view.ts`)

Add `subprojectId: string | null;` and `subprojectName: string | null;` to `DayEntryRow` (after `taskId` / `taskName`). In `personDayView` build:

```ts
// Only NON-default subprojects are named: "Website · General" is noise, not information.
const subprojectNames = new Map(
  projects.flatMap((p) =>
    (p.subprojects ?? []).filter((s) => !s.isDefault).map((s) => [s.id, s.name] as const),
  ),
);
```

Pass it to `entryLabel(entry, projectNames, subprojectNames, taskNames)` and push the subproject name between project and task:

```ts
const subprojectName = entry.subprojectId ? subprojectNames.get(entry.subprojectId) : undefined;
if (subprojectName) parts.push(subprojectName);
```

In the row mapping add `subprojectId: p.entry.subprojectId,` and `subprojectName: p.entry.subprojectId ? (subprojectNames.get(p.entry.subprojectId) ?? null) : null,`. If `TimeEntriesDrawerList.tsx` renders `projectName`/`taskName` separately, render `subprojectName` between them the same way (read it; keep its markup).

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @timetrack/dashboard test && pnpm --filter @timetrack/dashboard typecheck`
Expected: PASS. (`exactOptionalPropertyTypes` is on: `subprojectId: assignment.subprojectId` is `string | null`, never `undefined`, so it is fine; do not introduce `string | undefined` values for optional keys.)

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/lib apps/dashboard/src/components/day apps/dashboard/src/app/\(app\)/me
git commit -m "feat(dashboard): assign time entries to a subproject and task"
```

---

### Task 10: Full verification, browser check, PR

- [ ] **Step 1: Fallout sweep**

Run `pnpm typecheck` and fix every error. Expected hotspots (vitest doesn't typecheck specs): `TimeEntry` fixtures missing `subprojectId: null` (api time-entries/reports/approvals specs, dashboard day-view/drawer/overview specs); `Task` fixtures missing `subprojectId`; `ProjectDetail` fixtures missing `subprojects`. Fix fixtures only — no production changes in this step.

- [ ] **Step 2: Full gate**

Run: `pnpm --filter @timetrack/contracts build && pnpm --filter @timetrack/db build && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. Then `RUN_E2E=1 pnpm --filter @timetrack/api test:coverage` → functions/branches/lines ≥ 80%, and `RUN_E2E=1 pnpm --filter @timetrack/worker test:e2e`. Paste the real summary lines into the PR body.

- [ ] **Step 3: Browser check on the local stack**

Stop any stale `pnpm dev` (the API is on 3001; a surviving old API silently blanks the dashboard), then `pnpm dev`. As a MANAGER in the dashboard:

1. Open a project → see "General · Default" group holding all pre-existing tasks.
2. Add subproject "Checkout" → appears; add a task into it via the subproject select.
3. Move an existing task from General to Checkout → it moves; reload persists.
4. Archive Checkout → group shows Archived; `curl -H "Authorization: Bearer <employee token>" localhost:3001/v1/projects` no longer lists its tasks. Try archiving General → the toggle is absent; `PATCH /v1/projects/subprojects/<generalId> {"archived":true}` returns 409.
5. On /me add a manual entry assigned `Checkout › <task>` → label reads `Project · Checkout · Task`. Edit only its note → task is still set (the old wipe bug is gone).
6. `curl -X POST localhost:3001/v1/time-entries` with a legacy body `{id, projectId, taskId:null, startTime, endTime:null, source:"AUTO"}` → 2xx, response `subprojectId` = General's id. Repeat with a random non-existent `projectId` → 2xx, `subprojectId: null`.
7. Export CSV from Reports → last column is `subproject`.

Take screenshots of steps 1–5. If the browser tooling cannot reach localhost, verify via the API and say in the PR that the visual check is unconfirmed.

- [ ] **Step 4: Push and open the PR** (work account; check `gh auth status` first)

```bash
git push -u origin feat/subprojects
gh pr create --base main --title "feat(api): project subprojects (phase 1)" --body "<summary, spec/plan links, spec amendments, migration verification output, gate output, screenshots>"
```

No AI attribution anywhere. Hand the merge to the user.
