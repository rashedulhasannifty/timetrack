# Slice 3a — Project colors + project management (design)

Date: 2026-07-25
Branch: `feat/projects-color-mgmt`
Scope: `db` + `contracts` + `api` + `dashboard`. One migration column (`Project.color`); no new dependency.

## Context

Slices 1–2 shipped the `/projects` index + detail (read surfaces), using a deterministic
`projectColor(id)` fallback everywhere (no stored color). This slice adds a real, editable
project color and the project-management write surface. It is the first of two management slices:

- **3a (this spec):** `Project.color` column; palette + `ProjectColor` enum moved to contracts;
  create-project with a color picker; recolor existing projects; project archive/unarchive UI;
  index & detail render the stored color (`color ?? projectColor(id)`).
- **3b (next):** task management — `Task.archived` column, add/archive-task endpoints, and the
  task-list management UI on the detail page.

The management API mostly EXISTS: `POST /projects` (create), `POST /projects/tasks`, and
`PATCH /projects/:id` (archive), all `@Roles('MANAGER','ADMIN')` + own-team. The dashboard write
patterns to copy are `InviteForm`/`DecideForm` (Server Action + `useActionState`) and the
`setUserActive`/`setUserRole` api-client mutations (same PATCH endpoint, different partial body).

## Decisions (from brainstorming)

- **Palette-constrained color** (8 swatches), modeled as a Zod enum in contracts — matches the
  repo's `Role`/`screenshotBlur` enum convention. `PROJECT_PALETTE` moves to contracts as the
  single source; the dashboard's `project-color.ts` imports+re-exports it and keeps the
  presentational `projectColor(id)` derivation.
- **Recolor allowed** (not create-only) — otherwise existing projects can never get a real color.
- **Migration is hand-authored + `db:deploy`** — `prisma migrate dev` can't run interactively in
  this harness. A fresh migration file is authored (the "never hand-edit" rule applies only to
  already-committed migrations); it is exactly what `migrate dev` would emit for a nullable add.
- **Archive stays a soft toggle** via the existing `PATCH :id`; recolor rides the same endpoint
  with a `{ color }` body (mirrors `setUserActive`/`setUserRole`).

## Non-goals (later)

- Task management (add/archive tasks, `Task.archived`) → Slice 3b.
- Project rename, hard-delete, arbitrary (non-palette) colors, inline recolor on index rows.
- Top apps within a project → Slice 4.

## Design

### 1. DB — `packages/db`

- `prisma/schema.prisma`: add `color String?` to `model Project` (nullable → maps to `TEXT`; existing
  rows stay null → derived fallback). No `@db.*` attr, consistent with the codebase.
- New migration `prisma/migrations/<timestamp>_add_project_color/migration.sql`:
  ```sql
  -- Slice 3a — per-project color (nullable; null → dashboard-derived fallback).
  ALTER TABLE "projects" ADD COLUMN "color" TEXT;
  ```
- Apply locally: `pnpm db:deploy` (records + applies the pending migration) → `pnpm db:generate`
  (regenerate the client) → `pnpm --filter @timetrack/db build` (apps consume `dist`). The e2e
  Testcontainers harness applies the migrations dir automatically (seen in Slice 2's run).

### 2. Contracts — `packages/contracts/src/projects.ts` (re-exported via `index.ts`)

```ts
// Single source of the palette (dashboard imports this).
export const PROJECT_PALETTE = [
  '#007aff',
  '#5e5ce6',
  '#30b0c7',
  '#34c759',
  '#ff9500',
  '#ff2d55',
  '#af52de',
  '#ffcc00',
] as const;
export const ProjectColorSchema = z.enum(PROJECT_PALETTE);
export type ProjectColor = z.infer<typeof ProjectColorSchema>;
```

- `ProjectSchema`: add `color: ProjectColorSchema.nullable()`.
- `CreateProjectSchema`: add `color: ProjectColorSchema` (required; the form always sends a swatch).
- `UpdateProjectSchema`: widen from `{ archived: boolean }` to
  `z.object({ archived: z.boolean().optional(), color: ProjectColorSchema.optional() })
 .refine((v) => v.archived !== undefined || v.color !== undefined, 'Provide archived or color')`.
  Explicit optionals (no `.default()`, no `.partial()` of a defaulted base) → avoids the
  Zod-partial-defaults landmine. Test the refine through the pipe.
- `ProjectDetailSchema`: add `color: ProjectColorSchema.nullable()` (so the detail dot uses the
  stored color).

### 3. API — projects module

**Repository** (`projects.repository.ts`):

- `PROJECT_SELECT`: add `color: true` (so every returned `Project` carries color).
- `createProject(teamId, name, color, actorId)`: `data: { teamId, name, color }`, audit
  `diff: { teamId, name, color }`.
- `findForActor(id)`: select+return `color` too → `{ id, teamId, name, color, archived } | null`
  (used by `detail` and `update`; its Slice-2 e2e assertion is updated to include `color`).
- New `setColor(id, color, actorId)`: `$transaction` — `project.update({ data: { color } })` +
  `auditLog.create({ action: 'project.recolor', diff: { color } })`. Returns the updated `Project`.
- `setArchived` unchanged.

**Service** (`projects.service.ts`):

- `createProject`: pass `dto.color` → `repo.createProject(dto.teamId, dto.name, dto.color, actor.id)`.
- Rename `archive(id, dto, actor)` → `update(id, dto: UpdateProject, actor)`: `findForActor` →
  404/403, then apply whichever field(s) present — `if (dto.archived !== undefined) result = await
repo.setArchived(...); if (dto.color !== undefined) result = await repo.setColor(...)` — and
  return the final `Project`. (Form submits one field per action, so typically one repo call.)
- `detail`: include `color: project.color` in the assembled `ProjectDetail`
  (`findForActor` now returns it). `ProjectDetailSchema.parse(...)` still runs on the way out.

**Controller** (`projects.controller.ts`): `@Post()` create — unchanged code, schema now carries
color. `@Patch(':id')` — rename handler `archive`→`update`, keep `@Roles('MANAGER','ADMIN')` +
`@Query`/`@Body(new ZodValidationPipe(UpdateProjectSchema))`, call `service.update`.

### 4. Dashboard

- **`lib/project-color.ts`**: `import { PROJECT_PALETTE } from '@timetrack/contracts'; export {
PROJECT_PALETTE };` and keep `hashString`/`projectColor` (derivation). Remove the local palette
  literal. Its spec keeps importing `{ projectColor, PROJECT_PALETTE }` from `./project-color`.
- **`lib/projects-index-view.ts`**: `color: p.color ?? projectColor(p.id)` (was
  `projectColor(p.id)`). Update `projects-index-view.spec.ts`: assert stored color wins when set,
  derived when null.
- **`lib/api-client.ts`**: add
  ```ts
  createProject: (token, dto: CreateProject): Promise<Project> =>
    send('POST', '/projects', dto, ProjectSchema, token),
  archiveProject: (token, id: string, archived: boolean): Promise<Project> =>
    send('PATCH', `/projects/${id}`, { archived }, ProjectSchema, token),
  recolorProject: (token, id: string, color: ProjectColor): Promise<Project> =>
    send('PATCH', `/projects/${id}`, { color }, ProjectSchema, token),
  ```
  (`ProjectSchema` already imported; add `type CreateProject`, `type ProjectColor`.)
- **`app/(app)/projects/actions.ts`** (`'use server'`): `createProjectAction(_prev, formData)` —
  role-check (`MANAGER|ADMIN` else not-authorized), fetch `teamId` via
  `api.getCurrentTeam(session.accessToken)` (never trust the form), parse
  `CreateProjectSchema.safeParse({ teamId, name, color })`, `api.createProject`,
  `revalidatePath('/projects')`. `archiveProjectAction(id, archived)` and
  `recolorProjectAction(id, color)` — parse via `UpdateProjectSchema`, call api, revalidate
  `/projects` (+ the detail path for recolor). All catch `ApiError` → `{ ok, message }`.
- **Client components** (`components/projects/`):
  - `ProjectColorPicker.tsx` — 8 swatch buttons from `PROJECT_PALETTE`, a hidden `name="color"`
    input carrying the selected value, keyboard-accessible, selected-state ring. Reused by the
    create form and the recolor control.
  - `NewProjectForm.tsx` — `useActionState(createProjectAction)`, a name input + `ProjectColorPicker`
    (defaulting to the first swatch) + submit (`{pending ? 'Creating…' : 'New project'}`), inline
    error `<p role="status">`.
  - `ProjectArchiveToggle.tsx` — `useActionState`, a single submit button ("Archive"/"Unarchive")
    bound to `archiveProjectAction` for a given id + current archived state.
  - `ProjectRecolor.tsx` — `ProjectColorPicker` wired to `recolorProjectAction` (submits on change).
- **Index page** (`projects/page.tsx`): render `<NewProjectForm />` above the list (manager/admin
  reach this page; the action still role-checks); add `<ProjectArchiveToggle>` per row. Rows already
  carry the (now stored-or-derived) color dot from `toProjectIndexRows`.
- **Detail page** (`projects/[projectId]/page.tsx`): dot uses `detail.color ?? projectColor(detail
.projectId)`; add `<ProjectRecolor projectId color>` and `<ProjectArchiveToggle>` in the header/
  management area.
- **E2e scaffold** (`e2e/projects.spec.ts`): append skipped cases — create a project (name+color),
  archive/unarchive a row, recolor on the detail page.

### Data / authz flow

```
New project form → createProjectAction (role-check + getCurrentTeam → teamId)
  → api.createProject({teamId,name,color}) → POST /projects (@Roles MANAGER/ADMIN, own-team)
  → repo.createProject stores color + audit → revalidatePath('/projects')
Archive/Recolor → archive/recolorProjectAction → api.archive/recolorProject
  → PATCH /projects/:id {archived}|{color} → service.update (findForActor 404/403) → setArchived|setColor + audit
Index/detail dot color = project.color ?? projectColor(id)   (stored wins; legacy → derived)
```

## Testing

- **Contracts**: `ProjectColorSchema` accepts a palette value, rejects a non-palette hex;
  `CreateProjectSchema` requires color; `UpdateProjectSchema` accepts `{archived}`-only,
  `{color}`-only, both, and rejects `{}` (the refine); `ProjectSchema`/`ProjectDetailSchema` accept
  `color: null`.
- **API unit** (`projects.service.spec.ts`): `update()` 404 missing / 403 cross-team; `create`
  threads color to the repo; `update({color})` calls `setColor`; `update({archived})` calls
  `setArchived`; `detail` includes `color`. Extend the repo mock with `setColor`. (The existing
  `archive` tests migrate to `update`.)
- **API e2e** (`projects.e2e-spec.ts`, real PG, `RUN_E2E=1`): `createProject` persists color +
  writes `project.create` audit with color in the diff; `setColor` updates color + writes
  `project.recolor` audit; `findForActor` returns color (update the Slice-2 assertion to include it).
- **Dashboard** (`projects-index-view.spec.ts`): stored color wins, null → derived. Page(s) verified
  by typecheck + lint + build. `project-color.spec.ts` still green after the palette moves to
  contracts. Extend the skipped e2e scaffold.
- Run before done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; API e2e via
  `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts`; API coverage under
  `test:coverage`.

## Risks / notes

- **Migration workflow**: hand-authored SQL must match a nullable `TEXT` add exactly; run
  `db:deploy`+`db:generate`+rebuild the db package so the api/dashboard typecheck see `color`.
- **Churn from `archive`→`update` + `findForActor` gaining `color`**: existing projects unit tests
  (`svc.archive` → `svc.update`) and the Slice-2 `findForActor` e2e assertion are updated in the
  same tasks. Contained; call it out in review.
- **`UpdateProjectSchema` refine**: request bodies are strict-parsed by the pipe; the refine must be
  exercised through `ZodValidationPipe` (a `{}` body → 422), per the repo's strict-body convention.
- **Palette drift**: with the palette now in contracts, `z.enum(PROJECT_PALETTE)` means a stored
  color must be one of the 8; if the palette ever changes, previously-stored values could fail the
  enum on read. Acceptable now (palette is stable); note for any future palette edit.
- **Color in `ProjectDetail`** keeps index/detail dots consistent for a colored project.
- **`z.enum(PROJECT_PALETTE)` typing**: `PROJECT_PALETTE` must be `as const` (a readonly tuple of
  string literals) for `z.enum` to infer the literal union. If the Zod 4 overload rejects the
  readonly tuple in this repo's version, fall back to `z.enum([...PROJECT_PALETTE] as [string,
...string[]])` — verify at implementation via `typecheck`, don't assume.

## Definition of done

- `Project.color` migrated; contracts carry `ProjectColor` + color fields; create persists color;
  recolor + archive via `PATCH :id`; index has a working New-project form (name + palette) + per-row
  archive; detail shows stored color + recolor + archive; index/detail dots use `color ?? derived`.
- Contracts + API unit + API e2e + dashboard view tests pass; `lint/typecheck/test/build` green;
  coverage holds. Committed on `feat/projects-color-mgmt`, Conventional Commits (scope
  `db`/`contracts`/`api`/`dashboard`), no AI attribution.
