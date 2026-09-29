# Subprojects — Phase 1 (server + dashboard)

**Date:** 2026-09-29
**Status:** Approved design, pending implementation plan
**Scope:** `packages/db`, `packages/contracts`, `apps/api`, `apps/worker`, `apps/dashboard`.
Desktop clients (macOS, Windows) are **Phase 2**, a separate spec.

## 1. Goal

Add a level between Project and Task: **Project → Subproject → Task**.

Decisions made with the product owner:

| Question                          | Decision                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the subproject level optional? | **Required.** Every task belongs to a subproject. Existing tasks move into an auto-created **"General"** subproject per project.                              |
| Nesting depth                     | Exactly one level. Subprojects do not contain subprojects.                                                                                                    |
| Minimum tracking granularity      | **Subproject required** whenever a project is set. Task stays optional. Entries with no project at all remain valid (clients auto-track without a selection). |
| Phasing                           | Phase 1 = DB + API + dashboard. Phase 2 = client pickers.                                                                                                     |
| CSV export                        | New `subproject` column appended **at the end**, so positional parsers keep working.                                                                          |

### Constraints

- `/v1` must not break. Shipped clients send `{ projectId, taskId }` only, read `GET /v1/projects`
  (with nested `tasks[].projectId`), and classify 4xx as permanent (data dropped). No new 4xx may be
  reachable from a shipped client's payload.
- Shipped clients never create tasks; only the dashboard calls `POST /v1/projects/tasks`.
- Response additions are safe: Swift `Codable` and `System.Text.Json` ignore unknown keys.

### Non-goals

- Deleting subprojects (archive only, same as tasks).
- Moving a subproject to another project; moving a task to another project.
- Subproject colors.
- Subproject breakdowns in team/person/other reports beyond the project detail report and CSV.
- Client UI (Phase 2).

## 2. Data model

A new `Subproject` table — **not** a self-referencing `Project.parentId`. Subproject-as-project rows
would appear in the shipped clients' project picker and double-count in project reports.

```prisma
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
  projectId    String     // kept; always equals subproject.projectId (service-maintained)
  subprojectId String     // new, NOT NULL
  name         String
  archived     Boolean    @default(false)
  project      Project    @relation(...)
  subproject   Subproject @relation(...)
  @@map("tasks")
}

model TimeEntry {
  ...
  subprojectId String?    // new
  subproject   Subproject? @relation(...)
}
```

- **Default subproject:** `isDefault = true`, named "General". Exactly one per project, enforced by a
  hand-authored partial unique index `subprojects_one_default_per_project ON subprojects("projectId")
WHERE "isDefault"`. Invisible to Prisma's diff (see the partial-index memory); a violation surfaces as
  P2002 and is mapped to 409 in the repository. The default can be renamed, never archived.
- **`Task.projectId` is kept** — shipped clients read it and reports join on it. The service keeps it
  equal to the subproject's project on create and move.
- **Entry invariant:** `CHECK ("projectId" IS NULL OR "subprojectId" IS NOT NULL)` on `time_entries`.
  `time_entries` is not partitioned, so this is a plain constraint.
- **Project creation** creates its "General" subproject in the same `$transaction`.

### Migration (hand-authored; `prisma migrate dev` cannot run non-interactively here)

One migration, in order:

1. `CREATE TABLE subprojects` + FK + index + partial unique index.
2. `INSERT` one `("General", isDefault = true)` subproject per existing project (ids via
   `uuidv7()` — Postgres 18 built-in).
3. `ALTER TABLE tasks ADD "subprojectId"`, backfill to the project's default, `SET NOT NULL`, add FK +
   index.
4. `ALTER TABLE time_entries ADD "subprojectId"` (nullable) + FK + index; backfill:
   task's subproject when `taskId` is set, else the project's default when `projectId` is set.
5. Add the CHECK constraint.

Applied with `db:deploy`, then `db:generate` and a rebuild of `@timetrack/db`.

### Subproject resolution (single helper in the time-entries service)

Applied on create, sync upsert, edit, and the worker's runaway split:

1. `projectId` null → `subprojectId` null.
2. Request carries `subprojectId` → it must belong to `projectId`, else **422**. Only the new dashboard
   sends this field, so shipped clients cannot reach this error.
3. Else `taskId` set **and** the task belongs to `projectId` → the task's subproject.
4. Else → the project's default subproject.

A task/project mismatch is **not** rejected (current behaviour preserved); it falls back to rule 4.

## 3. Contracts (`packages/contracts`)

All additive on responses.

- `SubprojectSchema { id, projectId, name, archived, isDefault }`.
- `TaskSchema` + `subprojectId`.
- `ProjectSchema` + `subprojects?: Subproject[]`. `tasks` stays a flat array.
- `CreateSubprojectSchema { projectId, name: 1..200 }`.
- `UpdateSubprojectSchema { name?, archived? }` — built from a default-free base (Zod 4 `.partial()`
  keeps defaults); cross-field checks use `.check()`, not `.refine()`, to keep strict mode.
- `CreateTaskSchema` → `{ subprojectId, name }` (projectId derived server-side).
- `UpdateTaskSchema` + optional `subprojectId` (move within the same project; other project → 422).
- Time-entry create / sync / edit schemas + optional `subprojectId`; time-entry response +
  `subprojectId: uuid | null`.
- `ProjectDetailSchema` + `subprojects: [{ subprojectId, name, trackedSeconds }]`;
  `ProjectTaskRowSchema` + `subprojectId` (nullable for the "No task" bucket).

## 4. API (`apps/api/src/modules/projects`, `time-entries`, `reports`)

New routes in the existing `projects` module, same shape as the task routes:

| Route                                | Roles          | Behaviour                                      |
| ------------------------------------ | -------------- | ---------------------------------------------- |
| `POST /v1/projects/subprojects`      | MANAGER, ADMIN | Create in a project the caller may administer. |
| `PATCH /v1/projects/subprojects/:id` | MANAGER, ADMIN | Rename / archive. Archiving the default → 409. |

Changed routes:

- `GET /v1/projects` — each project includes `subprojects` (active only unless `includeArchived`).
- `GET /v1/projects/:id/tasks` — also returns subprojects.
- `POST /v1/projects/tasks` — takes `subprojectId`; archived subproject → 409.
- `PATCH /v1/projects/tasks/:id` — optional move.
- `GET /v1/projects/:id/detail` — adds the per-subproject breakdown.

Authorization reuses the existing project admin check (MANAGER owns the project's team; ADMIN
org-wide). Pipes are scoped per parameter. Prisma stays in `*.repository.ts`.

Archiving a subproject hides it and its tasks from pickers (`includeArchived=false`), and preserves
history. Time-entry writes do not check `archived` for projects or tasks today, and do not check
it for subprojects either — an offline client may legitimately sync time tracked before the archive.

**CSV export:** `subproject` column appended after the last existing column.

## 5. Worker

`runaway-entry-trim` copies `subprojectId` into the split-off entry alongside `projectId`/`taskId`.

## 6. Dashboard (`apps/dashboard`)

- **Project detail (`projects/[projectId]`):** tasks grouped under subprojects, default first, labelled
  _default_ with no archive toggle; per-subproject hours; per-subproject archive toggle; new
  `NewSubprojectForm`; `NewTaskForm` gains a subproject select (defaults to General); per-task
  "Move to…" select. Server actions in `projects/actions.ts`.
- **Projects index:** unchanged except a subproject count per row.
- **Time-entry forms (`/me` actions, day view, entries drawer):** Project → Subproject → Task cascade.
  Picking a project preselects General; picking a task sets its subproject. Labels render
  `Project / Subproject / Task`, omitting the subproject when it is the default.
- Types come from `packages/contracts` only.

## 7. Testing

- **Migration e2e:** after the migration on seeded data, every project has exactly one default, every
  task has a subproject, and every entry with a project has a subproject.
- **Service unit tests:** each resolution rule; 422 on mismatched `subprojectId`; 409 on archiving the
  default; task move within / across projects.
- **API e2e:** 200 + 403 (manager of another team, employee) for each new or changed write route;
  a legacy-shaped sync (no `subprojectId`) still returns 2xx and stores General.
- **Worker e2e:** the runaway split preserves `subprojectId`.
- **Contracts:** stay above the 80% branch gate.
- **Dashboard:** vitest on the pure view transforms (grouping, label rendering), and a local browser
  check of the full flow (create subproject, move task, manual entry, detail report) before the PR.
- Gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus `test:coverage` with
  `RUN_E2E=1` for the api gate.

## 8. Rollout

API and migration deploy together; the dashboard deploys with them. Shipped clients need no change:
they keep sending `{ projectId, taskId }` and receive additive fields. Phase 2 adds the client picker
and sends `subprojectId` explicitly.
