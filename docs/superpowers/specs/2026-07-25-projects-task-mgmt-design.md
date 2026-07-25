# Slice 3b — Task management (design)

Date: 2026-07-25
Branch: `feat/projects-task-mgmt`
Scope: `db` + `contracts` + `api` + `dashboard`. One migration column (`Task.archived`); no new dependency; no macOS-client change.

## Context

Slice 3a shipped project colors + project create/recolor/archive. This slice completes management
with **tasks**: a soft-archive `Task.archived` column, an add-task + archive-task surface, and the
task-management UI on the project detail page. `createTask` already exists end-to-end
(`POST /projects/tasks`, service, repo `$transaction`+audit, `CreateTaskSchema`, tests); this slice
adds archive + surfacing + UI.

Key existing facts (from exploration):

- `Task` = `{ id, projectId, name }` + relation to `Project`; **no `archived`**.
- The project archive precedent (`setArchived`, `update`, `@Patch(':id')`, `ProjectArchiveToggle`)
  is the pattern to mirror for tasks.
- **No dashboard UI renders the Task-table rows today.** The detail page's `ProjectDetail.tasks`
  is the per-task **hours** rollup (`ProjectTaskRow[]`), a different shape from `Task[]`.
- The **macOS client** decodes tasks from `GET /projects` with a plain synthesized `Decodable`
  that **ignores unknown keys** — adding `Task.archived` and filtering archived tasks out of the
  nested list needs **zero Swift changes** and correctly hides them from the assignment picker.

## Decisions (from brainstorming)

- **Dedicated `GET /projects/:id/tasks`** returns the editable task list (all tasks incl. archived)
  for the management section — keeps `ProjectDetail` focused on analytics and avoids the confusing
  double-`tasks` naming.
- **Hide archived tasks from assignment**: filter `archived: false` in the `GET /projects`
  (`listByTeam`) nested tasks, so the client stops offering them for new time entries. Historical
  hours are unaffected (the per-task hours rollup LEFT JOINs `tasks` regardless of archived).
- **Soft-archive only** — no task rename or hard-delete. No macOS-client change this slice.
- **Migration** hand-authored + `db:generate` (harness can't run `migrate dev`); e2e Testcontainers
  applies the migration folder automatically.

## Non-goals

- Task rename / hard-delete; a client-visible archived badge in the Swift picker; per-task hours
  changes; Slice 4 (top-apps).

## Design

### 1. DB — `packages/db`

- `schema.prisma` `model Task`: add `archived Boolean @default(false)`.
- Migration `prisma/migrations/20260725130000_add_task_archived/migration.sql`:
  ```sql
  -- Slice 3b — soft-archive tasks (hidden from assignment; history preserved).
  ALTER TABLE "tasks" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
  ```
  `NOT NULL DEFAULT false` is safe on existing rows (they backfill to false). Apply via
  `db:generate` + `pnpm --filter @timetrack/db build` (no running DB needed for the gate). No index
  (tasks-per-project is small; the nested filter scans few rows).

### 2. Contracts — `packages/contracts/src/projects.ts`

- `TaskSchema`: add `archived: z.boolean()`.
- New `UpdateTaskSchema = z.object({ archived: z.boolean() })` — plain `z.object` (strict-pipe
  safe; `archived` required, the only task update). `type UpdateTask = z.infer<...>`.
- The `GET /projects/:id/tasks` response reuses `z.array(TaskSchema)` — no new response schema.
- Note: `ProjectSchema.tasks` (`z.array(TaskSchema).optional()`) now carries `archived` on each
  task; `listByTeam`'s nested select must return it or the dashboard's `api.listProjects` Zod parse
  fails.

### 3. API — projects module

**Repository** (`projects.repository.ts`):

- `createTask`: add `archived: true` to the `select` (returns `archived: false`; `data` unchanged).
- `listByTeam` nested tasks → `tasks: { where: { archived: false }, select: { id: true,
projectId: true, name: true, archived: true } }` (active-only for assignment; still returns the
  field so `TaskSchema` parses).
- `listTasksForProject(projectId): Promise<Task[]>` — ALL tasks incl. archived:
  `select { id, projectId, name, archived }`, `orderBy: [{ archived: 'asc' }, { name: 'asc' }]`
  (active first, then alphabetical).
- `findTaskForActor(taskId): Promise<{ projectId: string; teamId: string } | null>` — task→project
  →team lookup for authz: `task.findUnique({ where: { id }, select: { projectId: true,
project: { select: { teamId: true } } } })` mapped to `{ projectId, teamId }` (or null).
- `setTaskArchived(id, archived, actorId): Promise<Task>` — `$transaction`: `task.update({ data:
{ archived }, select: {…archived} })` + `auditLog.create({ action: archived ? 'task.archive' :
'task.unarchive', targetType: 'task', targetId: id, diff: { archived } })`. Mirrors project
  `setArchived`.

**Service** (`projects.service.ts`):

- `listTasks(id, actor): Promise<Task[]>` — `findForActor(id)` → 404 missing / 403 cross-team →
  `repo.listTasksForProject(id)`.
- `setTaskArchived(taskId, dto: UpdateTask, actor): Promise<Task>` — `findTaskForActor(taskId)` →
  404 missing / 403 cross-team (reuse `this.notFound()`/`this.forbidden()`) →
  `repo.setTaskArchived(taskId, dto.archived, actor.id)`.
- `createTask` unchanged (now returns `Task` with `archived`).

**Controller** (`projects.controller.ts`):

- `@Get(':id/tasks')` `@Roles('MANAGER','ADMIN')` → `service.listTasks(id, user)`.
- `@Patch('tasks/:id')` `@Roles('MANAGER','ADMIN')` `@Body(new ZodValidationPipe(UpdateTaskSchema))`
  → `service.setTaskArchived(id, dto, actor)`.
- Route ordering: `tasks/:id` (two segments) and `:id/tasks` don't collide with `:id` / `:id/detail`
  (distinct path shapes). Add the new service method to the controller-spec `it.each` delegation.

### 4. Dashboard

- **api-client** (`lib/api-client.ts`): import `type CreateTask, type Task, TaskSchema`; add
  ```ts
  createTask: (token, dto: CreateTask): Promise<Task> =>
    send('POST', '/projects/tasks', dto, TaskSchema, token),
  listProjectTasks: (token, id: string): Promise<Task[]> =>
    get(`/projects/${id}/tasks`, z.array(TaskSchema), token),
  archiveTask: (token, id: string, archived: boolean): Promise<Task> =>
    send('PATCH', `/projects/tasks/${id}`, { archived }, TaskSchema, token),
  ```
- **Server Actions** (append to `app/(app)/projects/actions.ts`): `createTaskAction` (role-check;
  `CreateTaskSchema.safeParse({ projectId, name })`; `api.createTask`; `revalidatePath(
`/projects/${projectId}`)`), `archiveTaskAction` (role-check; `UpdateTaskSchema.safeParse({
archived })`; `api.archiveTask(id, archived)`; revalidate the detail path). Both read `projectId`
  from a hidden form field (for revalidation) and catch `ApiError`.
- **Components** (`components/projects/`): `NewTaskForm` (name input + submit + hidden `projectId`,
  `useActionState(createTaskAction)`), `TaskArchiveToggle` (hidden `id` + `projectId` + flipped
  `archived`, single toggle button) — mirror `ProjectArchiveToggle`.
- **Detail page** (`app/(app)/projects/[projectId]/page.tsx`): after `getProjectDetail` succeeds,
  fetch `listProjectTasks` as a **degradeable** secondary call (its own try/catch → `[]` on
  failure, so a task hiccup never blanks the analytics). Add a **"Tasks"** `<section>` in the
  content block: a list of tasks (name · "Archived" badge when archived · `<TaskArchiveToggle>`),
  and a `<NewTaskForm projectId={detail.projectId} />`. Empty state: "No tasks yet."

### Data / authz flow

```
Detail page (manager/admin, own-team via getProjectDetail 404/403)
  → getProjectDetail (analytics)  +  listProjectTasks (degradeable → [] on error)
Add task  → createTaskAction → api.createTask → POST /projects/tasks (findForActor 404/403) → revalidate
Archive   → archiveTaskAction → api.archiveTask → PATCH /projects/tasks/:id (findTaskForActor 404/403) → revalidate
GET /projects (client) nested tasks: archived:false only → archived tasks vanish from assignment
```

## Testing

- **Contracts:** `TaskSchema` accepts `archived`; `UpdateTaskSchema` parses `{archived:true}` and
  rejects `{}` / non-boolean.
- **API unit** (`projects.service.spec.ts`): `setTaskArchived` 404 (findTaskForActor null) / 403
  (cross-team) / happy (calls repo); `listTasks` 404/403/happy; extend the repo mock with
  `findTaskForActor`, `setTaskArchived`, `listTasksForProject`. `controller.spec.ts` `it.each`
  gains `setTaskArchived`/`listTasks` delegation.
- **API e2e** (`projects.e2e-spec.ts`, real PG): `setTaskArchived` audit sequence
  `['task.create','task.archive','task.unarchive']`; `listByTeam` nested tasks exclude archived
  (create task, archive it, assert it's absent from the nested list, present via
  `listTasksForProject`); `listTasksForProject` returns all incl archived, ordered active-first;
  `findTaskForActor` returns `{projectId, teamId}` / null.
- **Dashboard:** detail page via typecheck/lint/build; extend the skipped `e2e/projects.spec.ts`
  scaffold with add-task + archive-task cases.
- Gate: `pnpm lint && typecheck && test && build`; API e2e `RUN_E2E=1 pnpm --filter @timetrack/api
test:e2e -- test/projects.e2e-spec.ts`; coverage under `test:coverage`.

## Risks / notes

- **`TaskSchema.archived` is required** → `listByTeam` nested select MUST return `archived` or
  `api.listProjects` Zod-parse breaks. Covered by the nested-select change.
- **macOS client:** no change needed (synthesized decoder ignores the new key; filtering shrinks the
  picker). Caveat: a live time entry already on a now-archived task keeps its historical
  attribution; the picker just won't offer that task for NEW entries.
- **Route ordering:** `@Patch('tasks/:id')` and `@Get(':id/tasks')` are distinct from `:id` /
  `:id/detail`; verify at build/e2e that PATCH `/projects/tasks/<uuid>` hits the task route.
- **`UpdateTaskSchema` plain `z.object`** (no `.refine`) so the pipe's `.strict()` applies
  (mass-assignment safe) — same reasoning as Slice 3a's `UpdateProjectSchema`.
- **Detail page second fetch degradeable** so tasks-endpoint issues don't blank the analytics.
- **Non-UUID `:id`/`tasks/:id`** still 500s (no param pipe) — pre-existing backlog item, unchanged.

## Definition of done

- `Task.archived` migrated; `TaskSchema.archived` + `UpdateTaskSchema` in contracts; `GET
/projects/:id/tasks` + `PATCH /projects/tasks/:id` live (MANAGER/ADMIN own-team, 404/403);
  `listByTeam` hides archived tasks from assignment; detail page has a Tasks section (add + archive/
  unarchive); api-client + Server Actions + components added.
- Contracts + API unit + API e2e + dashboard build all pass; `lint/typecheck/test/build` green;
  coverage holds. Committed on `feat/projects-task-mgmt`, Conventional Commits (scope
  `db`/`contracts`/`api`/`dashboard`), no AI attribution.
