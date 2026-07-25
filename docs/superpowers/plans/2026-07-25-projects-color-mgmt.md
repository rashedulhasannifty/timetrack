# Project Colors + Project Management (Slice 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable per-project color (palette of 8) and the project-management write surface — create-project (with color picker), recolor, and archive/unarchive — across db → contracts → api → dashboard.

**Architecture:** A nullable `Project.color` column (hand-authored migration). The palette + a write-only `ProjectColor` enum move to contracts; **reads** type color as `string | null` (matches the DB column, no enum casts, robust to palette drift); **writes** (create/recolor) are enum-constrained. The existing projects module already has create/archive endpoints — thread color through create, add `setColor`, and generalize `archive`→`update`. The dashboard adds api-client mutations, Server-Action forms (copying `InviteForm`/`DecideForm`/`useActionState`), and a swatch picker, and switches the dot color to `color ?? projectColor(id)`.

**Tech Stack:** Prisma 7 (hand-authored migration + `db:generate`), Zod 4 contracts, NestJS 11, Next.js 16 Server Components + Server Actions, Vitest (unit + Testcontainers e2e), Playwright (scaffold).

Spec: `docs/superpowers/specs/2026-07-25-projects-color-mgmt-design.md`

## Global Constraints

- Branch: `feat/projects-color-mgmt` (already created). Commit per task; Conventional Commits; scope ∈ `db | contracts | api | dashboard` (match the task's files). **No AI attribution** (pre-commit hooks enforce + gitleaks + conventional-commit).
- **No new dependencies.** **Zod only**; contract types **inferred**. `PrismaClient` only in `*.repository.ts`. Server Components by default; `'use client'` only for interactive forms. No `console.log`.
- **Color model:** palette lives in contracts as `PROJECT_PALETTE` (`as const`); `ProjectColorSchema = z.enum(PROJECT_PALETTE)` is the **write** constraint (create/recolor). **Read** schemas (`ProjectSchema.color`, `ProjectDetailSchema.color`) use `z.string().nullable()` to match the DB `String?` column — do NOT type reads as the enum (Prisma returns `string`, which isn't assignable to the enum union).
- **`UpdateProjectSchema` MUST stay a plain `z.object`** (no `.refine`, no `.partial()` of a defaulted base). The `ZodValidationPipe` applies `.strict()` only when the schema `instanceof ZodObject`; a `.refine()` returns a `ZodEffects` and would silently disable strict-body (mass-assignment) protection. Enforce "at least one field" in the service (empty body → no-op returning the current project), not via refine.
- **Authz:** create/update are `@Roles('MANAGER','ADMIN')` + own-team (`findForActor` → 404 missing / 403 cross-team) — the projects model, NOT reports. Server Actions role-check and read `teamId` server-side via `getCurrentTeam` (never trust the form).
- **Migration:** hand-author the migration folder (this harness can't run `migrate dev` interactively); `db:generate` + rebuild `@timetrack/db` make the client type-aware (no running DB needed for typecheck/build). The e2e Testcontainers harness applies the migrations dir automatically.
- `noUncheckedIndexedAccess` ON (tsc enforces; Vitest does not typecheck specs).
- Gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; API e2e via `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` (Docker up); coverage under `test:coverage`.

All commands run from repo root `/Users/rashedulhasan/Development/personal/timetracker/timetrack`.

---

### Task 1: DB — `Project.color` column + migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (add `color String?` to `model Project`)
- Create: `packages/db/prisma/migrations/20260725120000_add_project_color/migration.sql`

**Interfaces:**

- Produces: a `color` (nullable `TEXT`) column on `projects`, and a regenerated `@timetrack/db` client whose `Project` type includes `color: string | null`.

- [ ] **Step 1: Add the field to the schema**

In `packages/db/prisma/schema.prisma`, `model Project` — add `color` (keep the rest unchanged):

```prisma
model Project {
  id       String  @id @default(uuid(7))
  teamId   String
  name     String
  color    String?
  archived Boolean @default(false)
  team     Team    @relation(fields: [teamId], references: [id])
  tasks    Task[]

  @@index([teamId, archived])
  @@map("projects")
}
```

- [ ] **Step 2: Hand-author the migration**

Create `packages/db/prisma/migrations/20260725120000_add_project_color/migration.sql`:

```sql
-- Slice 3a — per-project color (nullable; null → dashboard-derived fallback color).
ALTER TABLE "projects" ADD COLUMN "color" TEXT;
```

- [ ] **Step 3: Regenerate the client + rebuild the package**

Run: `pnpm db:generate` (regenerates the Prisma client from the schema — no running DB required).
Run: `pnpm --filter @timetrack/db build`
Expected: both succeed. (Optional local smoke, needs the compose DB up: `pnpm db:deploy` applies the migration to the dev DB. Not required for the gate/tests — the e2e Testcontainers harness applies migrations itself.)

- [ ] **Step 4: Verify the db package typechecks**

Run: `pnpm --filter @timetrack/db typecheck`
Expected: PASS. (Downstream api/dashboard typecheck in later tasks will confirm `Project.color` is visible.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma "packages/db/prisma/migrations/20260725120000_add_project_color/migration.sql"
git commit -m "feat(db): add nullable Project.color column"
```

---

### Task 2: Contracts — palette, ProjectColor enum, color fields

**Files:**

- Modify: `packages/contracts/src/projects.ts`
- Modify: `packages/contracts/src/projects.spec.ts`

**Interfaces:**

- Produces (re-exported via `index.ts`): `PROJECT_PALETTE` (`readonly [...8 hex]`), `ProjectColorSchema`/`ProjectColor` (write enum); `ProjectSchema.color: string | null`; `CreateProjectSchema.color: ProjectColor`; `UpdateProjectSchema` = `{ archived?: boolean; color?: ProjectColor }` (plain object); `ProjectDetailSchema.color: string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/src/projects.spec.ts` (add imports at the top of the existing file: `CreateProjectSchema, UpdateProjectSchema, ProjectSchema, ProjectColorSchema, PROJECT_PALETTE` from `./projects.js`):

```ts
describe('ProjectColor + color fields', () => {
  it('ProjectColorSchema accepts a palette value and rejects a non-palette hex', () => {
    expect(ProjectColorSchema.parse(PROJECT_PALETTE[0])).toBe(PROJECT_PALETTE[0]);
    expect(() => ProjectColorSchema.parse('#123456')).toThrow();
  });

  it('CreateProjectSchema requires a palette color', () => {
    const base = { teamId: '018f9c1e-0000-7000-8000-000000000001', name: 'Website' };
    expect(() => CreateProjectSchema.parse(base)).toThrow(); // missing color
    expect(CreateProjectSchema.parse({ ...base, color: PROJECT_PALETTE[1] }).color).toBe(
      PROJECT_PALETTE[1],
    );
  });

  it('UpdateProjectSchema accepts archived-only, color-only, or both', () => {
    expect(UpdateProjectSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(UpdateProjectSchema.parse({ color: PROJECT_PALETTE[2] })).toEqual({
      color: PROJECT_PALETTE[2],
    });
    expect(UpdateProjectSchema.parse({ archived: false, color: PROJECT_PALETTE[3] })).toEqual({
      archived: false,
      color: PROJECT_PALETTE[3],
    });
  });

  it('ProjectSchema.color accepts null and any stored string (read is permissive)', () => {
    const base = {
      id: '018f9c1e-0000-7000-8000-000000000001',
      teamId: '018f9c1e-0000-7000-8000-000000000002',
      name: 'Website',
      archived: false,
    };
    expect(ProjectSchema.parse({ ...base, color: null }).color).toBeNull();
    expect(ProjectSchema.parse({ ...base, color: '#legacy' }).color).toBe('#legacy');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @timetrack/contracts test -- src/projects.spec.ts`
Expected: FAIL — `ProjectColorSchema`/`PROJECT_PALETTE` not exported; `color` not on the schemas.

- [ ] **Step 3: Implement the contract changes**

In `packages/contracts/src/projects.ts`:

Add near the top (after `import { z }`):

```ts
// Single source of the project palette (dashboard imports this). `as const` → z.enum infers the union.
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

// WRITE constraint (create/recolor). Reads stay permissive strings (DB column is TEXT).
export const ProjectColorSchema = z.enum(PROJECT_PALETTE);
export type ProjectColor = z.infer<typeof ProjectColorSchema>;
```

(If `z.enum(PROJECT_PALETTE)` fails to typecheck on this Zod version, use `z.enum([...PROJECT_PALETTE] as [string, ...string[]])`.)

Change `ProjectSchema` to add `color` (read-permissive):

```ts
export const ProjectSchema = z.object({
  id: z.uuid(),
  teamId: z.uuid(),
  name: z.string(),
  color: z.string().nullable(),
  archived: z.boolean(),
  tasks: z.array(TaskSchema).optional(),
});
```

Change `CreateProjectSchema` to require a palette color:

```ts
export const CreateProjectSchema = z.object({
  teamId: z.uuid(),
  name: z.string().min(1).max(200),
  color: ProjectColorSchema,
});
```

Change `UpdateProjectSchema` to a plain widened object (NO `.refine` — see Global Constraints):

```ts
export const UpdateProjectSchema = z.object({
  archived: z.boolean().optional(),
  color: ProjectColorSchema.optional(),
});
```

In `ProjectDetailSchema`, add `color: z.string().nullable()` (place it after `name`):

```ts
  name: z.string(),
  color: z.string().nullable(),
  archived: z.boolean(),
```

(The `ProjectColor` type is exported above; keep the existing `z.infer` type exports. `UpdateProject`/`CreateProject`/`Project`/`ProjectDetail` inferred types update automatically.)

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @timetrack/contracts test -- src/projects.spec.ts` → PASS.
Run: `pnpm --filter @timetrack/contracts typecheck` → PASS.
Run: `pnpm --filter @timetrack/contracts build` → PASS (apps consume `dist`).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/projects.ts packages/contracts/src/projects.spec.ts
git commit -m "feat(contracts): project color palette enum + color fields"
```

---

### Task 3: API repository — color + setColor + e2e

**Files:**

- Modify: `apps/api/src/modules/projects/projects.repository.ts`
- Modify: `apps/api/test/projects.e2e-spec.ts`

**Interfaces:**

- Produces on `ProjectsRepository`:
  - `PROJECT_SELECT` includes `color`.
  - `createProject(teamId, name, actorId, color?: string | null)` — color defaults `null` (keeps existing 3-arg callers working); audit diff `{ teamId, name, color }`.
  - `findForActor(id): { id; teamId; name; color: string | null; archived } | null`.
  - `setColor(id, color: string, actorId): Promise<Project>` — audit `project.recolor`.
  - `setArchived` unchanged.

- [ ] **Step 1: Write the failing e2e tests** (Docker up + `RUN_E2E=1`)

In `apps/api/test/projects.e2e-spec.ts`:

Update the existing `findForActor` assertion to include `color: null` (search for the `findForActor returns` test):

```ts
expect(await repo().findForActor(project.id)).toEqual({
  id: project.id,
  teamId: team.id,
  name: 'Website',
  color: null,
  archived: false,
});
```

Add new tests inside the `describe.runIf(RUN_E2E)` block:

```ts
it('createProject persists a color and records it in the audit diff', async () => {
  const team = await seedTeam();
  const project = await repo().createProject(team.id, 'Website', 'actor1', '#5e5ce6');
  expect(project.color).toBe('#5e5ce6');
  const audit = await db.prisma.auditLog.findFirst({
    where: { targetType: 'project', targetId: project.id, action: 'project.create' },
  });
  expect((audit?.diff as { color?: string } | null)?.color).toBe('#5e5ce6');
});

it('createProject defaults color to null when omitted', async () => {
  const team = await seedTeam();
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  expect(project.color).toBeNull();
});

it('setColor updates the color and writes a project.recolor audit row', async () => {
  const team = await seedTeam();
  const project = await repo().createProject(team.id, 'Website', 'actor1');
  const recolored = await repo().setColor(project.id, '#ff2d55', 'actor1');
  expect(recolored.color).toBe('#ff2d55');
  const audit = await db.prisma.auditLog.findFirst({
    where: { targetType: 'project', targetId: project.id, action: 'project.recolor' },
  });
  expect((audit?.diff as { color?: string } | null)?.color).toBe('#ff2d55');
});
```

- [ ] **Step 2: Run e2e to verify it fails**

Ensure Docker is up (`docker info`).
Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts`
Expected: FAIL — `setColor` is not a function; `project.color` undefined; `findForActor` lacks `color`.

- [ ] **Step 3: Implement the repository changes**

In `apps/api/src/modules/projects/projects.repository.ts`:

Add `color` to `PROJECT_SELECT`:

```ts
const PROJECT_SELECT = {
  id: true,
  teamId: true,
  name: true,
  color: true,
  archived: true,
} as const;
```

Change `createProject` (trailing optional `color`, keeps 3-arg callers valid):

```ts
  async createProject(
    teamId: string,
    name: string,
    actorId: string,
    color: string | null = null,
  ): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { teamId, name, color },
        select: PROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'project.create',
          targetType: 'project',
          targetId: project.id,
          diff: { teamId, name, color },
        },
      });
      return project;
    });
  }
```

Change `findForActor` to include `color`:

```ts
  findForActor(
    id: string,
  ): Promise<{ id: string; teamId: string; name: string; color: string | null; archived: boolean } | null> {
    return this.prisma.project.findUnique({
      where: { id },
      select: { id: true, teamId: true, name: true, color: true, archived: true },
    });
  }
```

Add `setColor` (after `setArchived`):

```ts
  async setColor(id: string, color: string, actorId: string): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id },
        data: { color },
        select: PROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'project.recolor',
          targetType: 'project',
          targetId: id,
          diff: { color },
        },
      });
      return project;
    });
  }
```

- [ ] **Step 4: Run e2e to verify it passes**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts`
Expected: PASS — new color tests + updated `findForActor` + all pre-existing projects repo tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @timetrack/api typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/projects/projects.repository.ts apps/api/test/projects.e2e-spec.ts
git commit -m "feat(api): persist project color + setColor in repository"
```

---

### Task 4: API service + controller — create-color, update, detail color

**Files:**

- Modify: `apps/api/src/modules/projects/projects.service.ts`
- Modify: `apps/api/src/modules/projects/projects.controller.ts`
- Modify: `apps/api/src/modules/projects/projects.service.spec.ts`

**Interfaces:**

- Consumes: repo `createProject(…, color)`, `setColor`, `findForActor` (with color) from Task 3; `UpdateProject`/`CreateProject` (with color) from Task 2.
- Produces: `ProjectsService.createProject` threads color; `ProjectsService.update(id, dto, actor)` (was `archive`) dispatches archived→`setArchived`, color→`setColor`; `detail` includes `color`; controller `PATCH :id` → `service.update`.

- [ ] **Step 1: Update the unit tests (RED)**

In `apps/api/src/modules/projects/projects.service.spec.ts`:

Add `setColor: vi.fn(),` to the repo mock in `makeService`.

In `ProjectsService.createProject` describe, update both tests for the new signature (color required in `CreateProject`, repo called with 4 args):

```ts
it('rejects creating a project for another team (403)', async () => {
  const { svc, repo } = makeService();
  await expect(
    svc.createProject({ teamId: 't2', name: 'X', color: '#007aff' }, manager),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(repo.createProject).not.toHaveBeenCalled();
});

it('creates when the team matches the actor, threading color', async () => {
  const created = { id: 'p1', teamId: 't1', name: 'X', color: '#007aff', archived: false };
  const { svc, repo } = makeService({ createProject: vi.fn().mockResolvedValue(created) });
  await expect(
    svc.createProject({ teamId: 't1', name: 'X', color: '#007aff' }, manager),
  ).resolves.toEqual(created);
  expect(repo.createProject).toHaveBeenCalledWith('t1', 'X', 'm1', '#007aff');
});
```

Replace the `ProjectsService.archive` describe block with an `update` block:

```ts
describe('ProjectsService.update', () => {
  it("403 when updating another team's project", async () => {
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't2', name: 'X', color: null, archived: false }),
    });
    await expect(svc.update('p1', { archived: true }, manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.setArchived).not.toHaveBeenCalled();
  });

  it('404 when the project does not exist', async () => {
    const { svc } = makeService({ findForActor: vi.fn().mockResolvedValue(null) });
    await expect(svc.update('p9', { archived: true }, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('dispatches archived → setArchived', async () => {
    const updated = { id: 'p1', teamId: 't1', name: 'X', color: null, archived: true };
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't1', name: 'X', color: null, archived: false }),
      setArchived: vi.fn().mockResolvedValue(updated),
    });
    await expect(svc.update('p1', { archived: true }, manager)).resolves.toEqual(updated);
    expect(repo.setArchived).toHaveBeenCalledWith('p1', true, 'm1');
    expect(repo.setColor).not.toHaveBeenCalled();
  });

  it('dispatches color → setColor', async () => {
    const updated = { id: 'p1', teamId: 't1', name: 'X', color: '#ff2d55', archived: false };
    const { svc, repo } = makeService({
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: 'p1', teamId: 't1', name: 'X', color: null, archived: false }),
      setColor: vi.fn().mockResolvedValue(updated),
    });
    await expect(svc.update('p1', { color: '#ff2d55' }, manager)).resolves.toEqual(updated);
    expect(repo.setColor).toHaveBeenCalledWith('p1', '#ff2d55', 'm1');
    expect(repo.setArchived).not.toHaveBeenCalled();
  });
});
```

In the `ProjectsService.detail` happy-path test, add `color` to the `findForActor` mock and assert it flows through:

```ts
      findForActor: vi
        .fn()
        .mockResolvedValue({ id: projectId, teamId: 't1', name: 'Website', color: '#34c759', archived: false }),
```

and add: `expect(result.color).toBe('#34c759');`

- [ ] **Step 2: Run unit to verify it fails**

Run: `pnpm --filter @timetrack/api test -- src/modules/projects/projects.service.spec.ts`
Expected: FAIL — `svc.update` not a function; `createProject` arity; `detail` lacks color.

- [ ] **Step 3: Implement service + controller**

In `apps/api/src/modules/projects/projects.service.ts`:

`createProject` — thread color:

```ts
  async createProject(dto: CreateProject, actor: SessionUser): Promise<Project> {
    if (dto.teamId !== actor.teamId) throw this.forbidden();
    return this.repo.createProject(dto.teamId, dto.name, actor.id, dto.color);
  }
```

Rename `archive` → `update` and dispatch:

```ts
  async update(id: string, dto: UpdateProject, actor: SessionUser): Promise<Project> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    if (project.teamId !== actor.teamId) throw this.forbidden();

    // Form submits one field per action; an empty body is a harmless no-op.
    let result: Project = project;
    if (dto.archived !== undefined) result = await this.repo.setArchived(id, dto.archived, actor.id);
    if (dto.color !== undefined) result = await this.repo.setColor(id, dto.color, actor.id);
    return result;
  }
```

(`project` from `findForActor` is `{ id, teamId, name, color: string|null, archived }` — assignable to `Project` since `tasks` is optional and `color` is `string | null` on both.)

`detail` — include color in the assembled object:

```ts
return ProjectDetailSchema.parse({
  from: query.from,
  to: query.to,
  projectId: id,
  name: project.name,
  color: project.color,
  archived: project.archived,
  totalSeconds,
  trend,
  members,
  tasks,
});
```

In `apps/api/src/modules/projects/projects.controller.ts` — rename the `@Patch(':id')` handler `archive`→`update` and call `service.update` (decorators + Zod pipe unchanged):

```ts
  @Patch(':id')
  @Roles('MANAGER', 'ADMIN')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) dto: UpdateProject,
    @CurrentUser() actor: SessionUser,
  ): Promise<Project> {
    return this.service.update(id, dto, actor);
  }
```

- [ ] **Step 4: Run unit to verify it passes**

Run: `pnpm --filter @timetrack/api test -- src/modules/projects/projects.service.spec.ts` → PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @timetrack/api typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/projects/projects.service.ts apps/api/src/modules/projects/projects.controller.ts apps/api/src/modules/projects/projects.service.spec.ts
git commit -m "feat(api): create-with-color, project update (archive+recolor), detail color"
```

---

### Task 5: Dashboard — color plumbing + api-client mutations

**Files:**

- Modify: `apps/dashboard/src/lib/project-color.ts`
- Modify: `apps/dashboard/src/lib/projects-index-view.ts`
- Modify: `apps/dashboard/src/lib/projects-index-view.spec.ts`
- Modify: `apps/dashboard/src/lib/api-client.ts`

**Interfaces:**

- `project-color.ts` re-exports `PROJECT_PALETTE` from contracts; `projectColor` unchanged.
- `toProjectIndexRows` uses `p.color ?? projectColor(p.id)`.
- api-client: `createProject(token, dto)`, `archiveProject(token, id, archived)`, `recolorProject(token, id, color)`.

- [ ] **Step 1: Update the index-view spec (RED)**

In `apps/dashboard/src/lib/projects-index-view.spec.ts`: update the `P` helper to carry color, and add a stored-color test:

```ts
const P = (id: string, name: string, archived = false, color: string | null = null): Project => ({
  id,
  teamId: '018f9c1e-0000-7000-8000-0000000000aa',
  name,
  color,
  archived,
});
```

Add a test:

```ts
it('uses the stored color when present, else the derived fallback', () => {
  const { rows } = toProjectIndexRows([P('p1', 'Alpha', false, '#ff2d55')], []);
  expect(rows[0]?.color).toBe('#ff2d55');
  const { rows: derived } = toProjectIndexRows([P('p2', 'Beta')], []);
  expect(derived[0]?.color).toBe(projectColor('p2'));
});
```

(The existing tests keep passing: `P(...)` now defaults `color: null` → `?? projectColor` → unchanged expectations.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/projects-index-view.spec.ts`
Expected: FAIL — the new stored-color assertion fails (view still uses `projectColor(p.id)` unconditionally); the `P` helper's `color` field is unused until the view changes. (It may fail to typecheck under the spec, but Vitest runs it — the assertion fails.)

- [ ] **Step 3: Implement the plumbing**

`apps/dashboard/src/lib/project-color.ts` — import+re-export the palette from contracts, keep the derivation:

```ts
/**
 * Deterministic project → dot color fallback. The palette is the single source in
 * @timetrack/contracts (also the write-enum for the picker). A project with a stored `color`
 * uses it; a null color falls back to this derivation. Presentational; dashboard-only.
 */
import { PROJECT_PALETTE } from '@timetrack/contracts';

export { PROJECT_PALETTE };

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function projectColor(id: string): string {
  const idx = hashString(id) % PROJECT_PALETTE.length;
  return PROJECT_PALETTE[idx] ?? PROJECT_PALETTE[0];
}
```

`apps/dashboard/src/lib/projects-index-view.ts` — one line in the `.map`:

```ts
    color: p.color ?? projectColor(p.id),
```

(Also update the "KNOWN GAP" comment's first sentence is still accurate; leave it.)

`apps/dashboard/src/lib/api-client.ts` — add imports and three mutations:

- In the `@timetrack/contracts` import block add: `type CreateProject,` and `type ProjectColor,`.
- After `getProjectDetail` in the `api` object, add:

```ts
  createProject: (token: string, dto: CreateProject): Promise<Project> =>
    send('POST', '/projects', dto, ProjectSchema, token),
  archiveProject: (token: string, id: string, archived: boolean): Promise<Project> =>
    send('PATCH', `/projects/${id}`, { archived }, ProjectSchema, token),
  recolorProject: (token: string, id: string, color: ProjectColor): Promise<Project> =>
    send('PATCH', `/projects/${id}`, { color }, ProjectSchema, token),
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @timetrack/dashboard test -- src/lib/projects-index-view.spec.ts` → PASS.
Run: `pnpm --filter @timetrack/dashboard test -- src/lib/project-color.spec.ts` → PASS (palette now sourced from contracts, still re-exported).
Run: `pnpm --filter @timetrack/dashboard typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/project-color.ts apps/dashboard/src/lib/projects-index-view.ts apps/dashboard/src/lib/projects-index-view.spec.ts apps/dashboard/src/lib/api-client.ts
git commit -m "feat(dashboard): stored project color + create/archive/recolor api-client"
```

---

### Task 6: Dashboard — Server Actions + management components

**Files:**

- Create: `apps/dashboard/src/app/(app)/projects/actions.ts`
- Create: `apps/dashboard/src/components/projects/ProjectColorPicker.tsx`
- Create: `apps/dashboard/src/components/projects/NewProjectForm.tsx`
- Create: `apps/dashboard/src/components/projects/ProjectArchiveToggle.tsx`
- Create: `apps/dashboard/src/components/projects/ProjectRecolor.tsx`

**Interfaces:**

- Consumes: `api.createProject`/`archiveProject`/`recolorProject` (Task 5), `getCurrentTeam`, `CreateProjectSchema`/`UpdateProjectSchema`/`ProjectColorSchema` (contracts), `PROJECT_PALETTE`.
- Produces: `createProjectAction`/`archiveProjectAction`/`recolorProjectAction` + the four client components.

- [ ] **Step 1: Server Actions**

Create `apps/dashboard/src/app/(app)/projects/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { CreateProjectSchema, UpdateProjectSchema } from '@timetrack/contracts';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';

export interface ProjectActionState {
  ok: boolean;
  message?: string;
}

// NOTE: a 'use server' module may export ONLY async functions (and types, which are erased).
// Do NOT export a value/const here — components define their own INITIAL locally.

function canManage(role: string): boolean {
  return role === 'MANAGER' || role === 'ADMIN';
}

export async function createProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const team = await api.getCurrentTeam(session.accessToken);
  const parsed = CreateProjectSchema.safeParse({
    teamId: team.id,
    name: formData.get('name'),
    color: formData.get('color'),
  });
  if (!parsed.success) return { ok: false, message: 'Enter a name and pick a color.' };

  try {
    await api.createProject(session.accessToken, parsed.data);
    revalidatePath('/projects');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof ApiError ? e.message : 'Could not create the project.',
    };
  }
}

export async function archiveProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const archived = formData.get('archived') === 'true';
  const parsed = UpdateProjectSchema.safeParse({ archived });
  if (!id || !parsed.success) return { ok: false, message: 'Invalid request.' };

  try {
    await api.archiveProject(session.accessToken, id, archived);
    revalidatePath('/projects');
    revalidatePath(`/projects/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}

export async function recolorProjectAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || !canManage(session.role)) return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const parsed = UpdateProjectSchema.safeParse({ color: formData.get('color') });
  if (!id || !parsed.success || parsed.data.color === undefined) {
    return { ok: false, message: 'Pick a palette color.' };
  }

  try {
    await api.recolorProject(session.accessToken, id, parsed.data.color);
    revalidatePath('/projects');
    revalidatePath(`/projects/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Recolor failed.' };
  }
}
```

- [ ] **Step 2: Color picker component**

Create `apps/dashboard/src/components/projects/ProjectColorPicker.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { PROJECT_PALETTE } from '../../lib/project-color';

/**
 * 8-swatch palette picker. Holds the selection in a hidden `name="color"` input so it submits
 * with the surrounding form. Keyboard-accessible radio-group semantics.
 */
export function ProjectColorPicker({ defaultColor }: { defaultColor?: string }) {
  const [selected, setSelected] = useState<string>(defaultColor ?? PROJECT_PALETTE[0]);
  return (
    <div role="radiogroup" aria-label="Project color" className="flex items-center gap-1.5">
      <input type="hidden" name="color" value={selected} />
      {PROJECT_PALETTE.map((hex) => (
        <button
          key={hex}
          type="button"
          role="radio"
          aria-checked={selected === hex}
          aria-label={hex}
          onClick={() => setSelected(hex)}
          className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
            selected === hex ? 'ring-accent ring-2 ring-offset-1' : ''
          }`}
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: New-project form**

Create `apps/dashboard/src/components/projects/NewProjectForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { createProjectAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { ProjectColorPicker } from './ProjectColorPicker';

const INITIAL: ProjectActionState = { ok: false };

export function NewProjectForm() {
  const [state, formAction, pending] = useActionState(createProjectAction, INITIAL);
  return (
    <form
      action={formAction}
      className="bg-surface-raised border-separator flex flex-wrap items-end gap-3 rounded-lg border p-4 shadow-e1"
    >
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Name</span>
        <input
          name="name"
          required
          maxLength={200}
          placeholder="New project"
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        />
      </label>
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Color</span>
        <div className="py-2">
          <ProjectColorPicker />
        </div>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="bg-accent hover:bg-accent-hover text-body rounded-md px-3 py-2 font-medium text-white transition-colors disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'New project'}
      </button>
      {state.message ? (
        <p className="text-destructive text-body w-full" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 4: Archive toggle + recolor components**

Create `apps/dashboard/src/components/projects/ProjectArchiveToggle.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { archiveProjectAction, type ProjectActionState } from '../../app/(app)/projects/actions';

const INITIAL: ProjectActionState = { ok: false };

export function ProjectArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  const [state, formAction, pending] = useActionState(archiveProjectAction, INITIAL);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="border-separator text-text hover:bg-surface rounded-md border px-2.5 py-1 text-label font-medium transition-colors disabled:opacity-50"
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

Create `apps/dashboard/src/components/projects/ProjectRecolor.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { recolorProjectAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { ProjectColorPicker } from './ProjectColorPicker';

const INITIAL: ProjectActionState = { ok: false };

export function ProjectRecolor({ id, color }: { id: string; color: string | null }) {
  const [state, formAction, pending] = useActionState(recolorProjectAction, INITIAL);
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <ProjectColorPicker defaultColor={color ?? undefined} />
      <button
        type="submit"
        disabled={pending}
        className="border-separator text-text hover:bg-surface rounded-md border px-2.5 py-1 text-label font-medium transition-colors disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save color'}
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint`
Expected: PASS. (Components aren't rendered yet — Task 7 wires them; typecheck/lint verify they compile.)

- [ ] **Step 6: Commit**

```bash
git add "apps/dashboard/src/app/(app)/projects/actions.ts" apps/dashboard/src/components/projects/
git commit -m "feat(dashboard): project management server actions + form/picker components"
```

---

### Task 7: Dashboard — wire management into index & detail pages

**Files:**

- Modify: `apps/dashboard/src/app/(app)/projects/page.tsx`
- Modify: `apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx`

**Interfaces:**

- Consumes: `NewProjectForm`, `ProjectArchiveToggle`, `ProjectRecolor` (Task 6); `detail.color` (Task 4).
- Produces: index shows the create form + per-row archive; detail shows stored color + recolor + archive.

- [ ] **Step 1: Index page**

In `apps/dashboard/src/app/(app)/projects/page.tsx`:

- Add imports:
  ```ts
  import { NewProjectForm } from '../../../components/projects/NewProjectForm';
  import { ProjectArchiveToggle } from '../../../components/projects/ProjectArchiveToggle';
  ```
- Render `<NewProjectForm />` at the top of the success branch, before the controls row:
  ```tsx
      ) : (
        <div className="flex flex-col gap-6">
          <NewProjectForm />
          <div className="flex items-center justify-between gap-4">
  ```
- Convert each project row so the name/dot remain a link but the archive toggle sits beside the
  duration (the whole `<li>` is no longer a single `<Link>`). Replace the row `<li>` body:

  ```tsx
  <li key={row.projectId} className="flex items-center justify-between gap-4 px-4 py-3">
    <Link
      href={`/projects/${row.projectId}`}
      className="hover:text-accent flex min-w-0 flex-1 items-center gap-3 transition-colors"
    >
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: row.color }}
        aria-hidden="true"
      />
      <span className="text-text truncate font-medium">{row.name}</span>
      {row.archived && (
        <span className="text-text-secondary border-separator text-caption rounded-full border px-2 py-0.5">
          Archived
        </span>
      )}
    </Link>
    <span className="flex shrink-0 items-center gap-3">
      <span className="tt-numeric text-text-secondary text-label">
        {formatDuration(row.trackedSeconds)}
      </span>
      <ProjectArchiveToggle id={row.projectId} archived={row.archived} />
    </span>
  </li>
  ```

  (Remove the old `hover:bg-surface` on the `<li>`/`<Link>` wrapper; the row is now a flex container. Keep the `divide-y` list styling and the "No project" footer `<li>` unchanged.)

- [ ] **Step 2: Detail page**

In `apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx`:

- Add imports:
  ```ts
  import { ProjectRecolor } from '../../../../components/projects/ProjectRecolor';
  import { ProjectArchiveToggle } from '../../../../components/projects/ProjectArchiveToggle';
  ```
- Change the header dot to use the stored color:
  ```tsx
              style={{ backgroundColor: detail.color ?? projectColor(detail.projectId) }}
  ```
- After the header `<div>` (the one with the dot/name/total), before the `ReportRangePicker` block, add a management row:

  ```tsx
  <div className="border-separator mb-6 flex flex-wrap items-center gap-4 border-b pb-4">
    <ProjectRecolor id={detail.projectId} color={detail.color} />
    <ProjectArchiveToggle id={detail.projectId} archived={detail.archived} />
  </div>
  ```

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint && pnpm --filter @timetrack/dashboard build`
Expected: PASS; `/projects` and `/projects/[projectId]` remain dynamic routes.

- [ ] **Step 4: Commit**

```bash
git add "apps/dashboard/src/app/(app)/projects/page.tsx" "apps/dashboard/src/app/(app)/projects/[projectId]/page.tsx"
git commit -m "feat(dashboard): project create/archive on index, recolor/archive on detail"
```

---

### Task 8: Dashboard — extend e2e scaffold

**Files:**

- Modify: `apps/dashboard/e2e/projects.spec.ts`

**Interfaces:** none (test-only, skipped scaffold matching the repo convention).

- [ ] **Step 1: Append management scaffold cases**

Append to `apps/dashboard/e2e/projects.spec.ts`:

```ts
test.describe('project management', () => {
  test.skip('create a project with a name and color', async ({ page }) => {
    await page.goto('/projects');
    await page.getByPlaceholder('New project').fill('Launch');
    await page.getByRole('radio', { name: '#5e5ce6' }).click();
    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page.getByText('Launch')).toBeVisible();
  });

  test.skip('archive a project from the index', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'Archive' }).first().click();
    await expect(page.getByText('Archived').first()).toBeVisible();
  });

  test.skip('recolor a project from the detail page', async ({ page }) => {
    await page.goto('/projects/some-project-id');
    await page.getByRole('radio', { name: '#ff2d55' }).click();
    await page.getByRole('button', { name: 'Save color' }).click();
    await expect(page.getByRole('button', { name: 'Save color' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Verify the e2e suite still passes (all skipped)**

Run: `pnpm --filter @timetrack/dashboard test:e2e`
Expected: PASS with the new tests skipped. (A pre-existing `session.spec.ts` live-test failure is unrelated/environmental; do not fix it.)

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/e2e/projects.spec.ts
git commit -m "test(dashboard): scaffold project management e2e cases"
```

---

### Final verification (after all tasks — controller runs this)

- [ ] **Full gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green.
- [ ] **API e2e (Docker up):** `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- test/projects.e2e-spec.ts` — color + setColor + findForActor tests green.
- [ ] **Coverage:** `RUN_E2E=1 pnpm --filter @timetrack/api test:coverage` holds the gate.
- [ ] **Manual smoke (optional, stack up + `pnpm db:deploy`):** as manager/admin, create a project with a color on `/projects`, archive/unarchive a row, open the detail page and recolor — dots reflect the stored color on both surfaces.

## Notes / risks (carry into review)

- **Read-permissive / write-constrained color:** reads are `z.string().nullable()` (match the DB `TEXT`), writes are the `ProjectColor` enum. This avoids Prisma-`string`→enum cast friction and survives palette edits. Confirm no read schema uses the enum.
- **`UpdateProjectSchema` must remain a plain `z.object`** — the pipe only `.strict()`s a `ZodObject`; a `.refine()` would disable strict-body protection. "≥1 field" is a service no-op, not a schema refine.
- **Contained churn:** `archive`→`update` (service+controller+unit), `createProject` gains a trailing `color` param (3-arg callers still valid), `findForActor` gains `color` (its Slice-2 e2e assertion + the detail unit mock updated here).
- **Migration workflow:** hand-authored SQL + `db:generate` + rebuild `@timetrack/db`; e2e applies the migration folder automatically. Do not run `migrate dev`.
- **Backlog (unchanged):** `time_entries(projectId)` index; naive-`TIMESTAMP`→`timestamptz` UTC-session idiom; UUID param pipe (bad `:id`→500); archived-project residual-hours bucket once a grand total is shown. Slice 3b: `Task.archived` + task management.
