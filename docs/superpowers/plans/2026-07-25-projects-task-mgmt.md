# Task Management (Slice 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soft-archive tasks — add a `Task.archived` column, add/archive-task management on the project detail page, and hide archived tasks from the macOS assignment picker.

**Architecture:** Mirror the Slice-3a project-archive pattern for tasks. New: `Task.archived` (migration), `TaskSchema.archived` + `UpdateTaskSchema`, repo `listTasksForProject`/`findTaskForActor`/`setTaskArchived` + a nested-tasks archived filter in `listByTeam`, service `listTasks`/`setTaskArchived`, `GET /projects/:id/tasks` + `PATCH /projects/tasks/:id`. Dashboard: api-client `createTask`/`listProjectTasks`/`archiveTask`, two Server Actions, `NewTaskForm`/`TaskArchiveToggle`, and a degradeable Tasks section on the detail page. No macOS-client change (its decoder ignores the new key).

**Tech Stack:** Prisma 7 (hand-authored migration + `db:generate`), Zod 4 contracts, NestJS 11, Next.js 16 Server Components + Server Actions, Vitest (unit + Testcontainers e2e), Playwright (scaffold).

Spec: `docs/superpowers/specs/2026-07-25-projects-task-mgmt-design.md`

## Global Constraints

- Branch: `feat/projects-task-mgmt` (already created). Commit per task; Conventional Commits; scope ∈ `db | contracts | api | dashboard`. **No AI attribution** (hooks enforce). Summary line ≤72 chars.
- **No new dependencies.** **Zod only**; contract types **inferred**. `PrismaClient` only in `*.repository.ts`. Server Components by default; `'use client'` only for forms. No `console.log`.
- **`UpdateTaskSchema` is a plain `z.object`** (no `.refine`) so the `ZodValidationPipe`'s `.strict()` applies (it only stricts a `ZodObject`).
- **Authz = projects model:** `@Roles('MANAGER','ADMIN')` + own-team. Project-scoped reads use `findForActor(projectId)`; task-scoped archive uses the new `findTaskForActor(taskId)` (→ `{projectId, teamId}`). 404 missing / 403 cross-team via the existing `this.notFound()`/`this.forbidden()`. No reports-authz.
- **`TaskSchema.archived` is required** → `listByTeam`'s nested tasks select AND `createTask`'s select MUST return `archived`, or `api.listProjects`/`createTask` Zod parses break.
- **Migration** hand-authored + `db:generate` + rebuild `@timetrack/db` (harness can't run `migrate dev`; no running DB needed for the gate). E2e Testcontainers applies the migration folder automatically.
- `noUncheckedIndexedAccess` ON (tsc enforces; Vitest doesn't typecheck specs).
- Gate: `pnpm lint && typecheck && test && build`; API e2e `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` (Docker up); coverage under `test:coverage`.

All commands from repo root `/Users/rashedulhasan/Development/personal/timetracker/timetrack`.

---

### Task 1: DB — `Task.archived` column + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (add `archived Boolean @default(false)` to `model Task`)
- Create: `packages/db/prisma/migrations/20260725130000_add_task_archived/migration.sql`

**Interfaces:** Produces a non-null `archived` (default false) column on `tasks`; regenerated client's `Task` gains `archived: boolean`.

- [ ] **Step 1: Schema** — in `model Task`, add `archived` (keep the rest):

```prisma
model Task {
  id        String  @id @default(uuid(7))
  projectId String
  name      String
  archived  Boolean @default(false)
  project   Project @relation(fields: [projectId], references: [id])

  @@map("tasks")
}
```

- [ ] **Step 2: Migration** — create `packages/db/prisma/migrations/20260725130000_add_task_archived/migration.sql`:

```sql
-- Slice 3b — soft-archive tasks (hidden from assignment; history preserved).
ALTER TABLE "tasks" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Generate + build**
      Run: `pnpm db:generate` then `pnpm --filter @timetrack/db build` — both succeed (no DB needed).

- [ ] **Step 4: Typecheck db**
      Run: `pnpm --filter @timetrack/db typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma "packages/db/prisma/migrations/20260725130000_add_task_archived/migration.sql"
git commit -m "feat(db): add Task.archived column"
```

---

### Task 2: Contracts — `TaskSchema.archived` + `UpdateTaskSchema`

**Files:**

- Modify: `packages/contracts/src/projects.ts`
- Modify: `packages/contracts/src/projects.spec.ts`

**Interfaces:** `TaskSchema` gains `archived: boolean`; new `UpdateTaskSchema`/`UpdateTask` = `{ archived: boolean }`.

- [ ] **Step 1: Failing tests** — append to `packages/contracts/src/projects.spec.ts` (ensure `TaskSchema`, `UpdateTaskSchema` are imported from `./projects.js`):

```ts
describe('Task archived + UpdateTaskSchema', () => {
  it('TaskSchema requires archived', () => {
    const base = {
      id: '018f9c1e-0000-7000-8000-000000000001',
      projectId: '018f9c1e-0000-7000-8000-000000000002',
      name: 'Homepage',
    };
    expect(() => TaskSchema.parse(base)).toThrow(); // missing archived
    expect(TaskSchema.parse({ ...base, archived: false }).archived).toBe(false);
  });

  it('UpdateTaskSchema parses a boolean and rejects empty / non-boolean', () => {
    expect(UpdateTaskSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(() => UpdateTaskSchema.parse({})).toThrow();
    expect(() => UpdateTaskSchema.parse({ archived: 'yes' })).toThrow();
  });
});
```

- [ ] **Step 2: Run to fail**
      Run: `pnpm --filter @timetrack/contracts test -- src/projects.spec.ts` → FAIL (archived not on TaskSchema; `UpdateTaskSchema` missing).

- [ ] **Step 3: Implement** — in `packages/contracts/src/projects.ts`:
      Change `TaskSchema` to add `archived`:

```ts
export const TaskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
});
```

Add `UpdateTaskSchema` after `CreateTaskSchema`:

```ts
export const UpdateTaskSchema = z.object({
  archived: z.boolean(),
});
```

Add the inferred type in the type-export block (near `export type CreateTask`):

```ts
export type UpdateTask = z.infer<typeof UpdateTaskSchema>;
```

- [ ] **Step 4: Run + typecheck + build**
      `pnpm --filter @timetrack/contracts test -- src/projects.spec.ts` → PASS; `... typecheck` → PASS; `... build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/projects.ts packages/contracts/src/projects.spec.ts
git commit -m "feat(contracts): Task.archived + UpdateTaskSchema"
```

---

### Task 3: API repository — task archive, list, authz lookup, nested filter + e2e

**Files:**

- Modify: `apps/api/src/modules/projects/projects.repository.ts`
- Modify: `apps/api/test/projects.e2e-spec.ts`

**Interfaces:** Produces on `ProjectsRepository`:

- `createTask` select includes `archived`.
- `listByTeam` nested tasks filter `archived:false` + select `archived`.
- `listTasksForProject(projectId): Promise<Task[]>` (all incl archived, active-first).
- `findTaskForActor(taskId): Promise<{ projectId: string; teamId: string } | null>`.
- `setTaskArchived(id, archived, actorId): Promise<Task>` (audit `task.archive`/`task.unarchive`).

- [ ] **Step 1: Failing e2e** (Docker + `RUN_E2E=1`) — in `apps/api/test/projects.e2e-spec.ts`, add inside the `describe.runIf(RUN_E2E)` block (the `seedTeam` helper already exists):

```ts
it('setTaskArchived toggles archived and audits archive vs unarchive', async () => {
  const team = await seedTeam();
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  const task = await repo().createTask(project.id, 'Homepage', 'actor1');

  const archived = await repo().setTaskArchived(task.id, true, 'actor1');
  expect(archived.archived).toBe(true);
  const unarchived = await repo().setTaskArchived(task.id, false, 'actor1');
  expect(unarchived.archived).toBe(false);

  const actions = await db.prisma.auditLog.findMany({
    where: { targetType: 'task', targetId: task.id },
    orderBy: { timestamp: 'asc' },
    select: { action: true },
  });
  expect(actions.map((a) => a.action)).toEqual(['task.create', 'task.archive', 'task.unarchive']);
});

it('listByTeam nested tasks exclude archived; listTasksForProject includes them', async () => {
  const team = await seedTeam();
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  const active = await repo().createTask(project.id, 'Active', 'actor1');
  const gone = await repo().createTask(project.id, 'Old', 'actor1');
  await repo().setTaskArchived(gone.id, true, 'actor1');

  const listed = await repo().listByTeam(team.id, true);
  const nestedTaskIds = (listed[0]?.tasks ?? []).map((t) => t.id);
  expect(nestedTaskIds).toEqual([active.id]); // archived filtered from assignment list

  const all = await repo().listTasksForProject(project.id);
  expect(all.map((t) => t.id).sort()).toEqual([active.id, gone.id].sort());
  // active-first ordering: the non-archived task precedes the archived one
  expect(all[0]?.id).toBe(active.id);
});

it('findTaskForActor returns {projectId, teamId}, or null when missing', async () => {
  const team = await seedTeam();
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  const task = await repo().createTask(project.id, 'Homepage', 'actor1');
  expect(await repo().findTaskForActor(task.id)).toEqual({
    projectId: project.id,
    teamId: team.id,
  });
  expect(await repo().findTaskForActor('019797a0-0000-7000-8000-0000000000ff')).toBeNull();
});
```

- [ ] **Step 2: Run e2e to fail**
      Ensure Docker up (`docker info`). Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` → FAIL (methods missing; nested tasks lack archived filter).

- [ ] **Step 3: Implement repository** — in `apps/api/src/modules/projects/projects.repository.ts`:

`createTask` select — add `archived`:

```ts
const task = await tx.task.create({
  data: { projectId, name },
  select: { id: true, projectId: true, name: true, archived: true },
});
```

`listByTeam` nested tasks — filter + select archived:

```ts
      select: {
        ...PROJECT_SELECT,
        tasks: {
          where: { archived: false },
          select: { id: true, projectId: true, name: true, archived: true },
        },
      },
```

Add three methods (after `createTask` / near `findForActor`):

```ts
  listTasksForProject(projectId: string): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ archived: 'asc' }, { name: 'asc' }],
      select: { id: true, projectId: true, name: true, archived: true },
    });
  }

  async findTaskForActor(
    taskId: string,
  ): Promise<{ projectId: string; teamId: string } | null> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true, project: { select: { teamId: true } } },
    });
    return task ? { projectId: task.projectId, teamId: task.project.teamId } : null;
  }

  async setTaskArchived(id: string, archived: boolean, actorId: string): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id },
        data: { archived },
        select: { id: true, projectId: true, name: true, archived: true },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: archived ? 'task.archive' : 'task.unarchive',
          targetType: 'task',
          targetId: id,
          diff: { archived },
        },
      });
      return task;
    });
  }
```

- [ ] **Step 4: Run e2e to pass**
      Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` → PASS (new task tests + all pre-existing green).

- [ ] **Step 5: Typecheck** — `pnpm --filter @timetrack/api typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/projects/projects.repository.ts apps/api/test/projects.e2e-spec.ts
git commit -m "feat(api): task archive/list/authz repository methods"
```

---

### Task 4: API service + controller — listTasks, setTaskArchived, routes

**Files:**

- Modify: `apps/api/src/modules/projects/projects.service.ts`
- Modify: `apps/api/src/modules/projects/projects.controller.ts`
- Modify: `apps/api/src/modules/projects/projects.service.spec.ts`
- Modify: `apps/api/src/modules/projects/projects.controller.spec.ts`

**Interfaces:** `ProjectsService.listTasks(id, actor): Promise<Task[]>`, `ProjectsService.setTaskArchived(taskId, dto: UpdateTask, actor): Promise<Task>`; controller `GET :id/tasks` + `PATCH tasks/:id`.

- [ ] **Step 1: Failing unit tests** — in `apps/api/src/modules/projects/projects.service.spec.ts`, add to the `makeService` repo mock:

```ts
    listTasksForProject: vi.fn(),
    findTaskForActor: vi.fn(),
    setTaskArchived: vi.fn(),
```

Append describes:

```ts
describe('ProjectsService.listTasks', () => {
  it('404 when the project does not exist', async () => {
    const { svc } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.listTasks('p9', manager)).rejects.toBeInstanceOf(NotFoundException);
  });
  it("403 for another team's project", async () => {
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't2', name: 'X', color: null, archived: false }),
    });
    await expect(svc.listTasks('p1', manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.listTasksForProject).not.toHaveBeenCalled();
  });
  it('returns the project tasks when own-team', async () => {
    const tasks = [{ id: 't1', projectId: 'p1', name: 'A', archived: false }];
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't1', name: 'X', color: null, archived: false }),
      listTasksForProject: vi.fn().mockResolvedValue(tasks),
    });
    await expect(svc.listTasks('p1', manager)).resolves.toEqual(tasks);
    expect(repo.listTasksForProject).toHaveBeenCalledWith('p1');
  });
});

describe('ProjectsService.setTaskArchived', () => {
  it('404 when the task does not exist', async () => {
    const { svc } = makeService({ findTaskForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.setTaskArchived('t9', { archived: true }, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it("403 for a task in another team's project", async () => {
    const { svc, repo } = makeService({
      findTaskForActor: vi.fn().mockResolvedValue({ projectId: 'p1', teamId: 't2' }),
    });
    await expect(svc.setTaskArchived('t1', { archived: true }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.setTaskArchived).not.toHaveBeenCalled();
  });
  it('archives when own-team', async () => {
    const updated = { id: 't1', projectId: 'p1', name: 'A', archived: true };
    const { svc, repo } = makeService({
      findTaskForActor: vi.fn().mockResolvedValue({ projectId: 'p1', teamId: 't1' }),
      setTaskArchived: vi.fn().mockResolvedValue(updated),
    });
    await expect(svc.setTaskArchived('t1', { archived: true }, manager)).resolves.toEqual(updated);
    expect(repo.setTaskArchived).toHaveBeenCalledWith('t1', true, 'm1');
  });
});
```

In `apps/api/src/modules/projects/projects.controller.spec.ts`: add `listTasks` + `setTaskArchived` to the `make()` service mock, add them to the role-gate `it.each`, and add delegation tests:

```ts
// in make(): add to the service object
    listTasks: vi.fn().mockResolvedValue([]),
    setTaskArchived: vi.fn(),
```

```ts
it.each(['createProject', 'createTask', 'update', 'setTaskArchived', 'listTasks'] as const)(
  'gates %s to MANAGER/ADMIN',
  (handler) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(ROLES, ProjectsController.prototype[handler]);
    expect(meta).toEqual(['MANAGER', 'ADMIN']);
  },
);
```

```ts
it('setTaskArchived passes id, dto, and actor to the service', async () => {
  const { ctrl, service } = make();
  await ctrl.setTaskArchived('t1', { archived: true }, actor);
  expect(service.setTaskArchived).toHaveBeenCalledWith('t1', { archived: true }, actor);
});

it('listTasks passes id and user to the service', async () => {
  const { ctrl, service } = make();
  await ctrl.listTasks('p1', actor);
  expect(service.listTasks).toHaveBeenCalledWith('p1', actor);
});
```

- [ ] **Step 2: Run unit to fail**
      Run: `pnpm --filter @timetrack/api test -- src/modules/projects/projects.service.spec.ts src/modules/projects/projects.controller.spec.ts` → FAIL (methods missing).

- [ ] **Step 3: Implement service** — in `apps/api/src/modules/projects/projects.service.ts`:
      Update the contracts type import to add `UpdateTask`:

```ts
import type {
  CreateProject,
  CreateTask,
  Project,
  ProjectDetail,
  ProjectDetailQuery,
  Task,
  UpdateProject,
  UpdateTask,
} from '@timetrack/contracts';
```

Add two methods (after `createTask`):

```ts
  async listTasks(id: string, actor: SessionUser): Promise<Task[]> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    if (project.teamId !== actor.teamId) throw this.forbidden();
    return this.repo.listTasksForProject(id);
  }

  async setTaskArchived(taskId: string, dto: UpdateTask, actor: SessionUser): Promise<Task> {
    const task = await this.repo.findTaskForActor(taskId);
    if (!task) throw this.notFound();
    if (task.teamId !== actor.teamId) throw this.forbidden();
    return this.repo.setTaskArchived(taskId, dto.archived, actor.id);
  }
```

- [ ] **Step 4: Implement controller** — in `apps/api/src/modules/projects/projects.controller.ts`:
      Add to the contracts import: `UpdateTaskSchema,` and `type UpdateTask,` (Task type already imported).
      Add two routes (after `createTask`, before `@Get(':id/detail')`):

```ts
  @Get(':id/tasks')
  @Roles('MANAGER', 'ADMIN')
  listTasks(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<Task[]> {
    return this.service.listTasks(id, user);
  }

  @Patch('tasks/:id')
  @Roles('MANAGER', 'ADMIN')
  setTaskArchived(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) dto: UpdateTask,
    @CurrentUser() actor: SessionUser,
  ): Promise<Task> {
    return this.service.setTaskArchived(id, dto, actor);
  }
```

(Route note: `@Patch('tasks/:id')` — a literal `tasks` segment — does not collide with `@Patch(':id')`; `@Get(':id/tasks')` is distinct from `@Get(':id/detail')`.)

- [ ] **Step 5: Run unit to pass**
      Run: `pnpm --filter @timetrack/api test -- src/modules/projects/projects.service.spec.ts src/modules/projects/projects.controller.spec.ts` → PASS.

- [ ] **Step 6: Typecheck** — `pnpm --filter @timetrack/api typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/projects/projects.service.ts apps/api/src/modules/projects/projects.controller.ts apps/api/src/modules/projects/projects.service.spec.ts apps/api/src/modules/projects/projects.controller.spec.ts
git commit -m "feat(api): GET project tasks + PATCH task archive routes"
```

---

### Task 5: Dashboard — api-client task helpers

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts`

**Interfaces:** `api.createTask(token, dto)`, `api.listProjectTasks(token, id)`, `api.archiveTask(token, id, archived)`.

- [ ] **Step 1: Implement** — in the `@timetrack/contracts` import block add `type CreateTask,`, `type Task,`, and `TaskSchema,`. Then add to the `api` object after `recolorProject`:

```ts
  createTask: (token: string, dto: CreateTask): Promise<Task> =>
    send('POST', '/projects/tasks', dto, TaskSchema, token),
  listProjectTasks: (token: string, id: string): Promise<Task[]> =>
    get(`/projects/${id}/tasks`, z.array(TaskSchema), token),
  archiveTask: (token: string, id: string, archived: boolean): Promise<Task> =>
    send('PATCH', `/projects/tasks/${id}`, { archived }, TaskSchema, token),
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @timetrack/dashboard typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/lib/api-client.ts
git commit -m "feat(dashboard): task create/list/archive api-client helpers"
```

---

### Task 6: Dashboard — Server Actions + task components

**Files:**

- Modify: `apps/dashboard/src/app/(app)/projects/actions.ts`
- Create: `apps/dashboard/src/components/projects/NewTaskForm.tsx`
- Create: `apps/dashboard/src/components/projects/TaskArchiveToggle.tsx`

**Interfaces:** `createTaskAction`, `archiveTaskAction`; `NewTaskForm`, `TaskArchiveToggle`.

- [ ] **Step 1: Server Actions** — in `apps/dashboard/src/app/(app)/projects/actions.ts`, extend the contracts import to add `CreateTaskSchema, UpdateTaskSchema`, and append:

```ts
export async function createTaskAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawProjectId = formData.get('projectId');
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';
  const parsed = CreateTaskSchema.safeParse({ projectId, name: formData.get('name') });
  if (!parsed.success) return { ok: false, message: 'Enter a task name.' };

  try {
    await api.createTask(session.accessToken, parsed.data);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Could not add the task.' };
  }
}

export async function archiveTaskAction(
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
  const parsed = UpdateTaskSchema.safeParse({ archived });
  if (!id || !parsed.success) return { ok: false, message: 'Invalid request.' };

  try {
    await api.archiveTask(session.accessToken, id, archived);
    if (projectId) revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}
```

- [ ] **Step 2: NewTaskForm** — create `apps/dashboard/src/components/projects/NewTaskForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { createTaskAction, type ProjectActionState } from '../../app/(app)/projects/actions';

const INITIAL: ProjectActionState = { ok: false };

export function NewTaskForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(createTaskAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input
        name="name"
        required
        maxLength={200}
        placeholder="New task"
        className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-1.5 text-label outline-none transition-colors"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-accent hover:bg-accent-hover text-label rounded-md px-3 py-1.5 font-medium text-white transition-colors disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add task'}
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 3: TaskArchiveToggle** — create `apps/dashboard/src/components/projects/TaskArchiveToggle.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { archiveTaskAction, type ProjectActionState } from '../../app/(app)/projects/actions';

const INITIAL: ProjectActionState = { ok: false };

export function TaskArchiveToggle({
  id,
  projectId,
  archived,
}: {
  id: string;
  projectId: string;
  archived: boolean;
}) {
  const [state, formAction, pending] = useActionState(archiveTaskAction, INITIAL);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="border-separator text-text-secondary hover:bg-surface hover:text-text rounded-md border px-2 py-0.5 text-caption font-medium transition-colors disabled:opacity-50"
      >
        {archived ? 'Unarchive' : 'Archive'}
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 4: Typecheck + lint** — `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/dashboard/src/app/(app)/projects/actions.ts" apps/dashboard/src/components/projects/NewTaskForm.tsx apps/dashboard/src/components/projects/TaskArchiveToggle.tsx
git commit -m "feat(dashboard): task create/archive server actions + components"
```

---

### Task 7: Dashboard — Tasks section on the detail page

**Files:**

- Modify: `apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx`

**Interfaces:** Renders a Tasks management section from a degradeable `listProjectTasks` fetch.

- [ ] **Step 1: Implement** — in `apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx`:
      Add imports:

```ts
import { NewTaskForm } from '../../../../components/projects/NewTaskForm';
import { TaskArchiveToggle } from '../../../../components/projects/TaskArchiveToggle';
import type { ProjectDetail, Task } from '@timetrack/contracts';
```

(replace the existing `import type { ProjectDetail } from '@timetrack/contracts';` line with the combined one above.)

After the detail try/catch block (before `return (`), add the degradeable tasks fetch:

```ts
// Editable task list for the management section. Degradeable: a task-fetch hiccup shows an
// empty Tasks section rather than blanking the analytics.
let tasks: Task[] = [];
if (detail) {
  try {
    tasks = await api.listProjectTasks(session.accessToken, projectId);
  } catch {
    tasks = [];
  }
}
```

Add a Tasks `<section>` at the end of the `flex flex-col gap-8` block (after the "By task" chart section, before the closing `</div>`):

```tsx
<section>
  <div className="mb-3 flex items-center justify-between gap-4">
    <h2 className="text-text text-h2 font-semibold">Tasks</h2>
    <NewTaskForm projectId={detail.projectId} />
  </div>
  {tasks.length === 0 ? (
    <p className="text-text-secondary text-body">No tasks yet.</p>
  ) : (
    <ul className="bg-surface-raised border-separator divide-separator divide-y rounded-lg border shadow-e1">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-text truncate">{task.name}</span>
            {task.archived && (
              <span className="text-text-secondary border-separator text-caption rounded-full border px-2 py-0.5">
                Archived
              </span>
            )}
          </span>
          <TaskArchiveToggle id={task.id} projectId={detail.projectId} archived={task.archived} />
        </li>
      ))}
    </ul>
  )}
</section>
```

- [ ] **Step 2: Typecheck + lint + build**
      Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint && pnpm --filter @timetrack/dashboard build`
      Expected: PASS; `/projects/[projectId]` remains dynamic.

- [ ] **Step 3: Commit**

```bash
git add "apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx"
git commit -m "feat(dashboard): tasks management section on project detail"
```

---

### Task 8: Dashboard — extend the e2e scaffold

**Files:**

- Modify: `apps/dashboard/e2e/projects.spec.ts`

**Interfaces:** none (skipped scaffold).

- [ ] **Step 1: Append** — add to `apps/dashboard/e2e/projects.spec.ts`:

```ts
test.describe('task management', () => {
  test.skip('add a task on the detail page', async ({ page }) => {
    await page.goto('/projects/some-project-id');
    await page.getByPlaceholder('New task').fill('Homepage');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByText('Homepage')).toBeVisible();
  });

  test.skip('archive a task from the detail page', async ({ page }) => {
    await page.goto('/projects/some-project-id');
    await page.getByRole('button', { name: 'Archive' }).last().click();
    await expect(page.getByText('Archived').last()).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify** — `pnpm --filter @timetrack/dashboard test:e2e` → PASS with the new tests skipped (a pre-existing `session.spec.ts` live-test failure is unrelated/environmental; do not fix it).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/e2e/projects.spec.ts
git commit -m "test(dashboard): scaffold task management e2e cases"
```

---

### Final verification (after all tasks — controller runs this)

- [ ] **Full gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green.
- [ ] **API e2e (Docker up):** `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` — task tests green.
- [ ] **Coverage:** `RUN_E2E=1 pnpm --filter @timetrack/api test:coverage` holds.
- [ ] **Manual smoke (optional):** as manager/admin on a project detail page, add a task (appears in the Tasks list), archive it (badge shows), unarchive it; confirm archived tasks no longer appear in the macOS assignment picker.

## Notes / risks (carry into review)

- **`TaskSchema.archived` required** → `createTask` + `listByTeam` nested selects must return `archived` (both changed in Task 3); otherwise `api.createTask`/`api.listProjects` Zod-parse breaks.
- **Route ordering:** `@Patch('tasks/:id')` vs `@Patch(':id')`, `@Get(':id/tasks')` vs `@Get(':id/detail')` — distinct path shapes; verify at build/e2e a PATCH to `/projects/tasks/<uuid>` hits the task route (not project update).
- **`findTaskForActor`** authorizes task archive via task→project→team; do not use `findForActor` (project-only).
- **Degradeable tasks fetch** so a tasks-endpoint issue never blanks the detail analytics.
- **macOS client:** unchanged (decoder ignores the new key; nested filter shrinks the picker). Live entries on a now-archived task keep historical attribution.
- **Backlog (unchanged):** UUID param pipe (bad `:id`→500); `time_entries(projectId)` index; naive-timestamp/UTC-session idiom; NewProjectForm reset/success; picker arrow-key a11y.
