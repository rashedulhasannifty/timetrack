# Shared clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one client (project) be linked to several teams, with its time split by the team each entry was tracked under.

**Architecture:** `projects.teamId` stays as the home team (so `/v1` is unchanged). A new `project_teams` link table decides who can use a client. A `BEFORE INSERT` trigger stamps `time_entries.teamId` from the user's team. Reconcile gives a shared client the union of its teams' work types. An ADMIN-only `PUT /v1/projects/:id/teams` sets the links, and the client detail gains a per-team split.

**Tech Stack:** NestJS 11 + Prisma 7 (pg adapter) + Postgres 18, Zod 4 contracts, Next.js 16 dashboard, Vitest (+ real-Postgres e2e).

**Spec:** `docs/superpowers/specs/2026-09-30-shared-clients-design.md`

## Global Constraints

- `/v1` stays backward compatible: `ProjectSchema.teamId` stays a required uuid (shipped Mac/Windows decode it). New fields are additive/optional on `ProjectSchema`.
- No desktop client change.
- Zod 4 only; body schemas use `.check()`, never `.refine()` (keeps the pipe's strict mode).
- Prisma only in `*.repository.ts`. Pipes scoped to the parameter.
- Every write that changes `project_teams` writes an `AuditLog` row in the same transaction, and runs **before** `reconcile` in that transaction.
- Every reconciling transaction takes `lockReconcile(tx)` first and uses `RECONCILE_TX`.
- Migration is hand-authored (`prisma migrate dev` needs a TTY here): write `migration.sql`, then `pnpm db:deploy && pnpm db:generate`, then `pnpm --filter @timetrack/db build`. **Never** run `prisma migrate diff` against the dev DB.
- After editing `packages/contracts` or `packages/db`, rebuild that package before running app specs.
- Commits: Conventional Commits, scopes from CLAUDE.md, no AI attribution.
- API e2e: `RUN_E2E=1 pnpm --filter api test:e2e -- <file>` (Docker running). `pnpm test` silently skips e2e.

## Review Focus

1. **A client created by old code during the deploy window has no `project_teams` row** → it disappears from its team's picker until the repair SQL runs. Covered by the rollout note in the PR body (spec §8); Task 7 puts the SQL there.
2. **A team's work-type change must reach shared clients it is not home to** → pinned by a Task 3 e2e test.
3. **A MANAGER of a non-home linked team must not see the home team's people** → pinned by a Task 5 e2e test.
4. **A user moved between teams keeps old entries on the old team** → pinned by a Task 1 e2e test.
5. **Unsharing a team archives only work types no remaining team selects, and keeps the row ids** → pinned by Task 2 unit tests + a Task 4 e2e test.

---

## File map

| File                                                                            | Change                                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/db/prisma/schema.prisma`                                              | `ProjectTeam` model, `Project.teams`, `Team.projectLinks`, `TimeEntry.teamId`                             |
| `packages/db/prisma/migrations/20261001120000_add_shared_clients/migration.sql` | table, backfills, trigger, index                                                                          |
| `packages/contracts/src/projects.ts` (+ `.spec.ts`)                             | `teamIds` on Project, `SetProjectTeamsSchema`, `ProjectTeamRowSchema`, detail fields                      |
| `apps/api/src/modules/work-types/work-types.reconcile.ts` (+ spec)              | `ReconcileProject.teamIds`, union, `project_teams_set` trigger                                            |
| `apps/api/src/modules/work-types/work-types.repository.ts`                      | reconcile reads links; selection/rename find projects via links                                           |
| `apps/api/src/modules/projects/projects.repository.ts`                          | link writes (Task 3), list via links, `teamIds` on lookups, `setTeams`, `teamsForProject`, members filter |
| `apps/api/src/modules/projects/projects.service.ts` (+ spec)                    | `assertCanUse` / `assertCanOwn`, `setTeams`, detail split                                                 |
| `apps/api/src/modules/projects/projects.controller.ts` (+ spec)                 | `PUT :id/teams`                                                                                           |
| `apps/api/test/shared-clients.e2e-spec.ts`                                      | new e2e file                                                                                              |
| `apps/api/test/time-entries.e2e-spec.ts`                                        | trigger stamping test                                                                                     |
| `apps/dashboard/src/lib/api-client.ts`                                          | `setProjectTeams`                                                                                         |
| `apps/dashboard/src/lib/catalog-view.ts` (+ spec)                               | `ClientRow.teams` / `shared`                                                                              |
| `apps/dashboard/src/lib/project-detail-view.ts` (+ spec)                        | `toTeamSplitRows`, `canOwnProject`                                                                        |
| `apps/dashboard/src/app/(app)/projects/actions.ts`                              | `setProjectTeamsAction`                                                                                   |
| `apps/dashboard/src/components/projects/ProjectShareTeams.tsx`                  | share form                                                                                                |
| `apps/dashboard/src/app/(app)/admin/catalog/page.tsx`                           | teams cell + Share                                                                                        |
| `apps/dashboard/src/components/projects/ProjectDetailContent.tsx`               | Shared badge, split table, hide archive/recolor                                                           |

---

### Task 1: Schema, migration and the team-stamping trigger

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261001120000_add_shared_clients/migration.sql`
- Test: `apps/api/test/time-entries.e2e-spec.ts`

**Interfaces:**

- Produces: Prisma model `ProjectTeam { projectId, teamId }` (delegate `prisma.projectTeam`), relation `Project.teams`, `TimeEntry.teamId: string | null`.

- [ ] **Step 1: Write the failing e2e test** — append inside the top-level `describe` of `apps/api/test/time-entries.e2e-spec.ts` (it already has `seedUser`, `createDto`, `repo()`):

```ts
describe('teamId stamping (trigger)', () => {
  it('stamps the user team on insert and never changes it after the user moves', async () => {
    const user = await seedUser();
    const other = await db.prisma.team.create({
      data: { name: 'Ops', settings: {} },
      select: { id: true },
    });
    const id = '01920000-0000-7000-8000-00000000e501';
    await repo().upsert(createDto(id), user.id, null);
    const first = await db.prisma.timeEntry.findUniqueOrThrow({
      where: { id },
      select: { teamId: true },
    });
    expect(first.teamId).toBe(user.teamId);

    await db.prisma.user.update({ where: { id: user.id }, data: { teamId: other.id } });
    await repo().upsert(createDto(id, { endTime: '2026-07-11T10:00:00Z' }), user.id, null);
    const after = await db.prisma.timeEntry.findUniqueOrThrow({
      where: { id },
      select: { teamId: true },
    });
    expect(after.teamId).toBe(user.teamId);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- test/time-entries.e2e-spec.ts -t "teamId stamping"`
Expected: FAIL. It's a TypeScript/Prisma error: `teamId` is not a field of the `TimeEntry` select.

- [ ] **Step 3: Edit `schema.prisma`**

In `model Team`, add after `workTypes TeamWorkType[]`:

```prisma
  projectLinks ProjectTeam[]
```

In `model Project`, add after `subprojects Subproject[]`:

```prisma
  teams       ProjectTeam[]
```

and change its doc comment (add above `model Project`):

```prisma
/// `teamId` is the HOME team: the one the /v1 response carries and "move" changes. Who may USE
/// the project is `project_teams`, which always includes the home team.
```

After `model Project`'s closing brace, add:

```prisma
/// Every team that may use a project, the home team (projects.teamId) included. The repository
/// keeps (project.id, project.teamId) present on create, bulk import, move and set-teams.
/// A project with more than one row is "shared".
model ProjectTeam {
  projectId String
  teamId    String
  project   Project @relation(fields: [projectId], references: [id])
  team      Team    @relation(fields: [teamId], references: [id])

  @@id([projectId, teamId])
  @@index([teamId])
  @@map("project_teams")
}
```

In `model TimeEntry`, add after `platform     Platform?`:

```prisma
  /// The user's team when the row was INSERTED, filled by the BEFORE INSERT trigger
  /// `time_entries_stamp_team` (raw SQL, invisible to Prisma's diff). No code writes it, so an
  /// upsert or edit can never change it. No FK, like projectId. Splits a shared client by team.
  teamId       String?
```

and add to its index list (next to the existing `@@index`/`@@map` lines):

```prisma
  @@index([projectId, teamId])
```

- [ ] **Step 4: Hand-write the migration** at `packages/db/prisma/migrations/20261001120000_add_shared_clients/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "project_teams" (
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "project_teams_pkey" PRIMARY KEY ("projectId","teamId")
);

-- CreateIndex
CREATE INDEX "project_teams_teamId_idx" ON "project_teams"("teamId");

-- AddForeignKey
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing project is linked to its home team.
INSERT INTO "project_teams" ("projectId", "teamId") SELECT "id", "teamId" FROM "projects";

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN "teamId" TEXT;

-- Backfill: the user's CURRENT team is the best record of history we have.
UPDATE "time_entries" te SET "teamId" = u."teamId" FROM "users" u WHERE u."id" = te."userId";

-- CreateIndex
CREATE INDEX "time_entries_projectId_teamId_idx" ON "time_entries"("projectId", "teamId");

-- Stamp the inserting user's team. BEFORE INSERT only: an UPDATE (sync heartbeat, close, edit)
-- never touches it, so moving a person never re-attributes their history. Reads the TARGET
-- user's row, so a manager filing a manual entry for an employee stamps the employee's team.
-- Invisible to Prisma's diff, like the partial indexes.
CREATE FUNCTION "time_entries_stamp_team"() RETURNS trigger AS $$
BEGIN
  IF NEW."teamId" IS NULL THEN
    SELECT "teamId" INTO NEW."teamId" FROM "users" WHERE "id" = NEW."userId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "time_entries_stamp_team"
  BEFORE INSERT ON "time_entries"
  FOR EACH ROW EXECUTE FUNCTION "time_entries_stamp_team"();
```

- [ ] **Step 5: Apply, generate, rebuild**

Run: `pnpm db:deploy && pnpm db:generate && pnpm --filter @timetrack/db build`
Expected: `1 migration applied`, then the generate and build succeed.

- [ ] **Step 6: Run the test to see it pass**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- test/time-entries.e2e-spec.ts`
Expected: the whole file passes, including the new test.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261001120000_add_shared_clients apps/api/test/time-entries.e2e-spec.ts
git commit -m "feat(db): add project team links and stamp entries with the user team"
```

---

### Task 2: Contracts

**Files:**

- Modify: `packages/contracts/src/projects.ts`
- Test: `packages/contracts/src/projects.spec.ts`

**Interfaces:**

- Produces:
  - `ProjectSchema.teamIds?: string[]`
  - `SetProjectTeamsSchema` / `SetProjectTeams = { teamIds: string[] }`
  - `ProjectTeamRowSchema` / `ProjectTeamRow = { teamId: string | null; teamName: string; trackedSeconds: number }`
  - `ProjectDetailSchema` gains required `teamIds: string[]` and `byTeam: ProjectTeamRow[]`.

- [ ] **Step 1: Write failing tests** — append to `packages/contracts/src/projects.spec.ts`. It already imports from `./projects.js`; add `SetProjectTeamsSchema`, `ProjectTeamRowSchema` and `ProjectDetailSchema` to that import if they're missing.

```ts
describe('SetProjectTeamsSchema', () => {
  const A = '018f9c1e-0000-7000-8000-0000000000a1';
  const B = '018f9c1e-0000-7000-8000-0000000000b1';
  it('accepts a list of unique team ids', () => {
    expect(SetProjectTeamsSchema.parse({ teamIds: [A, B] })).toEqual({ teamIds: [A, B] });
  });
  it('rejects an empty list, a repeat, and a non-uuid', () => {
    expect(SetProjectTeamsSchema.safeParse({ teamIds: [] }).success).toBe(false);
    expect(SetProjectTeamsSchema.safeParse({ teamIds: [A, A] }).success).toBe(false);
    expect(SetProjectTeamsSchema.safeParse({ teamIds: ['x'] }).success).toBe(false);
  });
  it('stays a strict-able ZodObject (the pipe needs .strict())', () => {
    expect(SetProjectTeamsSchema.strict().safeParse({ teamIds: [A], extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('ProjectTeamRowSchema', () => {
  it('allows a null team for the Unassigned bucket', () => {
    expect(
      ProjectTeamRowSchema.parse({ teamId: null, teamName: 'Unassigned', trackedSeconds: 0 }),
    ).toMatchObject({ teamId: null });
  });
});

describe('ProjectSchema.teamIds', () => {
  it('is optional so shipped clients and old responses still parse', () => {
    const base = {
      id: '018f9c1e-0000-7000-8000-000000000001',
      teamId: '018f9c1e-0000-7000-8000-0000000000c1',
      name: 'Acme',
      color: null,
      archived: false,
    };
    expect(ProjectSchema.safeParse(base).success).toBe(true);
    expect(
      ProjectSchema.parse({ ...base, teamIds: ['018f9c1e-0000-7000-8000-0000000000c1'] }).teamIds,
    ).toHaveLength(1);
  });
});
```

If `ProjectSchema.strict` usage needs a different check in this repo, look at how `ZodValidationPipe` makes schemas strict (`apps/api/src/common/pipes/zod-validation.pipe.ts`) and mirror it.

Also update every existing `ProjectDetailSchema` fixture in this spec file: add `teamIds: [<its teamId>]` and `byTeam: []`.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @timetrack/contracts test -- projects`
Expected: FAIL, `SetProjectTeamsSchema is not defined`.

- [ ] **Step 3: Implement** in `packages/contracts/src/projects.ts`.

In `ProjectSchema`, add after `archived: z.boolean(),`:

```ts
  /**
   * Every team linked to the project, home (`teamId`) first. Additive: shipped desktop clients
   * decode `teamId` only. More than one entry means the client is shared.
   */
  teamIds: z.array(z.uuid()).optional(),
```

After `UpdateProjectSchema`, add:

```ts
/**
 * PUT /v1/projects/:id/teams (ADMIN) — the FULL set of teams linked to the project. Must include
 * the home team (the API 422s otherwise). `.check()` not `.refine()`, so the pipe keeps strict mode.
 */
export const SetProjectTeamsSchema = z
  .object({ teamIds: z.array(z.uuid()).min(1).max(100) })
  .check((ctx) => {
    if (new Set(ctx.value.teamIds).size !== ctx.value.teamIds.length) {
      ctx.issues.push({
        code: 'custom',
        message: 'Each team may appear once',
        input: ctx.value,
        path: ['teamIds'],
      });
    }
  });

/** One team's share of a client's time. `teamId` null → "Unassigned" (no team stamped). */
export const ProjectTeamRowSchema = z.object({
  teamId: z.uuid().nullable(),
  teamName: z.string(),
  trackedSeconds: z.number().int().nonnegative(),
});
```

In `ProjectDetailSchema`, add after `teamId: z.uuid(),`:

```ts
  /** Linked teams, home first. More than one → shared. */
  teamIds: z.array(z.uuid()),
```

and after `totalSeconds`:

```ts
  /** The total split by the team each entry was tracked under; sums to `totalSeconds`. */
  byTeam: z.array(ProjectTeamRowSchema),
```

Add types at the bottom:

```ts
export type SetProjectTeams = z.infer<typeof SetProjectTeamsSchema>;
export type ProjectTeamRow = z.infer<typeof ProjectTeamRowSchema>;
```

Check that `packages/contracts/src/index.ts` re-exports `./projects.js` with `export *`. If it lists names explicitly, add the new ones.

- [ ] **Step 4: Run the tests and rebuild**

Run: `pnpm --filter @timetrack/contracts test && pnpm --filter @timetrack/contracts build`
Expected: PASS, and the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/projects.ts packages/contracts/src/projects.spec.ts
git commit -m "feat(contracts): add shared-client team links and the per-team split"
```

---

### Task 3: Reconcile over linked teams

**Files:**

- Modify: `apps/api/src/modules/work-types/work-types.reconcile.ts`
- Modify: `apps/api/src/modules/work-types/work-types.repository.ts`
- Test: `apps/api/src/modules/work-types/work-types.reconcile.spec.ts`
- Test: `apps/api/test/shared-clients.e2e-spec.ts` (create)

**Interfaces:**

- Consumes: `prisma.projectTeam` (Task 1).
- Produces:
  - `ReconcileProject = { id: string; teamIds: readonly string[] }`
  - `ReconcileTrigger` gains `'project_teams_set'`
  - `export async function linkedProjectIds(tx: Prisma.TransactionClient, teamIds: readonly string[]): Promise<string[]>` exported from `work-types.repository.ts`

- [ ] **Step 1: Write failing unit tests.** In `work-types.reconcile.spec.ts`, change `const P1 = { id: 'p1', teamId: 't1' };` to `const P1 = { id: 'p1', teamIds: ['t1'] };`, then append:

```ts
describe('planReconcile across linked teams', () => {
  const INTERNAL: DesiredWorkType = { id: 'w3', name: 'Internal' };
  const shared = { id: 'p1', teamIds: ['t1', 't2'] };
  const byTeam = new Map([
    ['t1', [PAYROLL, AUDIT]],
    ['t2', [PAYROLL, INTERNAL]],
  ]);

  it('desires the union of every linked team, each work type once', () => {
    const plan = planReconcile([shared], byTeam, []);
    expect(plan.create.map((c) => c.workTypeId).sort()).toEqual(['w1', 'w2', 'w3']);
  });

  it('after unsharing t2, archives only what t1 does not select', () => {
    const rows = [
      sub({ id: 's1', name: 'Payroll', workTypeId: 'w1' }),
      sub({ id: 's2', name: 'Audit Assist', workTypeId: 'w2' }),
      sub({ id: 's3', name: 'Internal', workTypeId: 'w3' }),
    ];
    const plan = planReconcile([{ id: 'p1', teamIds: ['t1'] }], byTeam, rows);
    expect(plan.archive).toEqual(['s3']);
    expect(plan.create).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter api test -- work-types.reconcile`
Expected: FAIL. The union test creates only t1's work types, because `project.teamId` is undefined.

- [ ] **Step 3: Implement the pure change** in `work-types.reconcile.ts`:

Add `| 'project_teams_set'` to `ReconcileTrigger`, and change:

```ts
export type ReconcileProject = { id: string; teamIds: readonly string[] };
```

In `planReconcile`, replace `const desired = desiredByTeam.get(project.teamId) ?? [];` with:

```ts
// A shared client carries the union of its teams' work types, each once (spec §5.4).
const union = new Map<string, DesiredWorkType>();
for (const teamId of project.teamIds) {
  for (const wt of desiredByTeam.get(teamId) ?? []) union.set(wt.id, wt);
}
const desired = [...union.values()];
```

Update the file's top doc comment: "each team's desired" becomes "the union of each project's linked teams' desired".

- [ ] **Step 4: Run the unit tests**

Run: `pnpm --filter api test -- work-types.reconcile`
Expected: PASS.

- [ ] **Step 5: Write the failing e2e test.** Create `apps/api/test/shared-clients.e2e-spec.ts`. Copy the harness section of `projects-work-types.e2e-spec.ts` verbatim: its imports, `describe.runIf(RUN_E2E)`, `beforeAll`/`afterAll`/`afterEach`, and the helpers `prisma`, `projects`, `catalog`, `admin`, `team`, `select`, `client`, `activeNames`, `titleOf`. Rename the describe to `'shared clients — real Postgres'`. Add these helpers:

```ts
const manager = (id: string, teamId: string): SessionUser => ({ id, role: 'MANAGER', teamId });
const employee = (id: string, teamId: string): SessionUser => ({ id, role: 'EMPLOYEE', teamId });
async function link(projectId: string, teamId: string): Promise<void> {
  await db.prisma.projectTeam.create({ data: { projectId, teamId } });
}
```

and the harness-gate test at the bottom, as in the other file:

```ts
describe('shared clients e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
```

Then the first test:

```ts
it("a team's selection change reaches a shared client it is not home to", async () => {
  const eng = await team('Eng');
  const ops = await team('Ops');
  await select(eng, 'Payroll');
  const acme = await client(eng, 'Acme');
  await link(acme.id, ops);

  await select(ops, 'Internal');
  expect(await activeNames(acme.id)).toEqual(['General', 'Internal', 'Payroll']);
});

it('a new client, a bulk-imported client, and a moved client each have exactly their home link', async () => {
  const eng = await team('Eng');
  const ops = await team('Ops');
  const acme = await client(eng, 'Acme');
  const { created } = await projects().bulkCreate({ teamId: eng, names: ['Globex'] }, admin(eng));
  await projects().update(acme.id, { teamId: ops }, admin(eng));

  const links = await db.prisma.projectTeam.findMany({
    orderBy: { projectId: 'asc' },
    select: { projectId: true, teamId: true },
  });
  expect(links).toEqual(
    [
      { projectId: acme.id, teamId: ops },
      { projectId: created[0]!.id, teamId: eng },
    ].sort((a, b) => a.projectId.localeCompare(b.projectId)),
  );
});
```

- [ ] **Step 6: Run to see it fail**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- test/shared-clients.e2e-spec.ts`
Expected: FAIL. No link rows are written for new clients, and reconcile still loads projects by `teamId`.

- [ ] **Step 7: Implement the repository change** in `work-types.repository.ts`.

Add below `lockReconcile`:

```ts
/** Every project LINKED to any of these teams (project_teams), home or shared. */
export async function linkedProjectIds(
  tx: Prisma.TransactionClient,
  teamIds: readonly string[],
): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const rows = await tx.projectTeam.findMany({
    where: { teamId: { in: [...teamIds] } },
    select: { projectId: true },
  });
  return [...new Set(rows.map((r) => r.projectId))];
}
```

In `reconcile`, replace the `projects` query and the `teamIds` line with:

```ts
const links =
  ids.length === 0
    ? []
    : await tx.projectTeam.findMany({
        where: { projectId: { in: ids } },
        select: { projectId: true, teamId: true },
      });
const teamsByProject = new Map<string, string[]>();
for (const l of links) {
  const list = teamsByProject.get(l.projectId);
  if (list) list.push(l.teamId);
  else teamsByProject.set(l.projectId, [l.teamId]);
}
const existing =
  ids.length === 0
    ? []
    : await tx.project.findMany({ where: { id: { in: ids } }, select: { id: true } });
const projects = existing.map((p) => ({ id: p.id, teamIds: teamsByProject.get(p.id) ?? [] }));

const teamIds = [...new Set(links.map((l) => l.teamId))];
```

In `update` (the work-type rename/archive), replace the `projects` block with:

```ts
const projectIds = await linkedProjectIds(
  tx,
  teams.map((t) => t.teamId),
);
await this.reconcile(tx, projectIds, {
  actorId,
  trigger: 'work_type_update',
  targetType: 'work_type',
  targetId: id,
});
```

In `setTeamSelection`, replace `const projects = await tx.project.findMany({ where: { teamId }, select: { id: true } });` and the call after it with:

```ts
await this.reconcile(tx, await linkedProjectIds(tx, [teamId]), {
  actorId,
  trigger: 'team_selection',
  targetType: 'team',
  targetId: teamId,
});
```

Update the `setTeamSelection` doc comment: "every project of the team" becomes "every project linked to the team".

- [ ] **Step 7b: Write the links in `projects.repository.ts`.** Reconcile now reads `project_teams`, so every project write must add its link first:

In `createProject`, directly after `tx.project.create(...)` and **before** the reconcile:

```ts
await tx.projectTeam.create({ data: { projectId: project.id, teamId } });
```

In `createProjectsBulk`, after `createManyAndReturn` and **before** the reconcile:

```ts
await tx.projectTeam.createMany({
  data: projects.map((p) => ({ projectId: p.id, teamId })),
});
```

In `setTeam`, after `tx.project.update(...)` and **before** the reconcile:

```ts
// The home link follows the move; other (shared) links stay. To keep the old team, share
// it again afterwards (spec §5.4). Before reconcile: reconcile reads project_teams.
if (before && before.teamId !== teamId) {
  await tx.projectTeam.deleteMany({ where: { projectId: id, teamId: before.teamId } });
}
await tx.projectTeam.createMany({ data: [{ projectId: id, teamId }], skipDuplicates: true });
```

Update `setTeam`'s doc comment: time entries are now split by their stamped `teamId`, not by the entry's user.

- [ ] **Step 8: Run the e2e tests and the existing work-type e2e tests**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- test/shared-clients.e2e-spec.ts test/projects-work-types.e2e-spec.ts test/work-types.e2e-spec.ts`
Expected: all pass. Don't weaken an existing test to get there.

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter api typecheck`
Expected: PASS. Vitest doesn't typecheck spec fixtures, so this is the check that catches a stale `{ teamId }` fixture.

```bash
git add apps/api/src/modules/work-types apps/api/src/modules/projects/projects.repository.ts apps/api/test/shared-clients.e2e-spec.ts
git commit -m "feat(api): reconcile a shared client to the union of its teams' work types"
```

---

### Task 4: Project links in the repository, and use/own authorization

**Files:**

- Modify: `apps/api/src/modules/projects/projects.repository.ts`
- Modify: `apps/api/src/modules/projects/projects.service.ts`
- Test: `apps/api/src/modules/projects/projects.service.spec.ts`
- Test: `apps/api/test/shared-clients.e2e-spec.ts`

**Interfaces:**

- Consumes: `prisma.projectTeam`; link rows written by Task 3.
- Produces:
  - `findForActor(id): Promise<{ id; teamId; teamIds: string[]; name; color; archived } | null>`
  - `findSubprojectForActor` returns `Subproject & { teamIds: string[]; workTypeId }` (no `teamId`)
  - `findTaskForActor` returns `Task & { teamIds: string[] }` (no `teamId`)
  - `listByTeam` / `listAll` return `Project[]` with `teamIds`, home first
  - Service private `assertCanUse(teamIds, actor)`, `assertCanOwn(teamIds, actor)`

- [ ] **Step 1: Write the failing e2e tests** in `shared-clients.e2e-spec.ts`:

```ts
it('the picker lists a shared client for both teams, home team first in teamIds', async () => {
  const eng = await team('Eng');
  const ops = await team('Ops');
  const acme = await client(eng, 'Acme');
  await link(acme.id, ops);

  const E1 = '01920000-0000-7000-8000-0000000000e1';
  const forOps = await projects().list(employee(E1, ops));
  expect(forOps.map((p) => [p.name, p.teamId, p.teamIds])).toEqual([['Acme', eng, [eng, ops]]]);
  const forEng = await projects().list(employee(E1, eng));
  expect(forEng.map((p) => p.name)).toEqual(['Acme']);
});

it('a manager of a linked non-home team may add a subproject but not archive or recolor', async () => {
  const eng = await team('Eng');
  const ops = await team('Ops');
  const acme = await client(eng, 'Acme');
  await link(acme.id, ops);
  const opsMgr = manager('01920000-0000-7000-8000-0000000000b2', ops);

  await expect(
    projects().createSubproject({ projectId: acme.id, name: 'Onboarding' }, opsMgr),
  ).resolves.toMatchObject({ name: 'Onboarding' });
  expect(await titleOf(projects().update(acme.id, { archived: true }, opsMgr))).toBe(
    'Only an admin can change a shared client',
  );
  expect(await titleOf(projects().update(acme.id, { color: '#ff9500' }, opsMgr))).toBe(
    'Only an admin can change a shared client',
  );
});

it("the home team's manager also loses archive once the client is shared, and keeps it when not", async () => {
  const eng = await team('Eng');
  const ops = await team('Ops');
  const engMgr = manager('01920000-0000-7000-8000-0000000000b1', eng);
  const solo = await client(eng, 'Solo');
  await expect(projects().update(solo.id, { archived: true }, engMgr)).resolves.toMatchObject({
    archived: true,
  });

  const acme = await client(eng, 'Acme');
  await link(acme.id, ops);
  expect(await titleOf(projects().update(acme.id, { archived: true }, engMgr))).toBe(
    'Only an admin can change a shared client',
  );
});

it('a manager of an unlinked team is still refused', async () => {
  const eng = await team('Eng');
  const ops = await team('Ops');
  const acme = await client(eng, 'Acme');
  const opsMgr = manager('01920000-0000-7000-8000-0000000000b2', ops);
  expect(
    await titleOf(projects().createSubproject({ projectId: acme.id, name: 'X' }, opsMgr)),
  ).toBe('Cannot manage a project in another team');
});
```

- [ ] **Step 2: Run to see them fail**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- test/shared-clients.e2e-spec.ts`
Expected: FAIL. `list` still filters on `projects.teamId` (Ops sees nothing), `teamIds` is undefined, and the Ops manager gets 403 on `createSubproject`.

- [ ] **Step 3: Repository reads.** Still in `projects.repository.ts`:

Add a helper at module level (below `SUBPROJECT_SELECT`):

```ts
/** Linked team ids with the home team first (Prisma cannot order a nested select that way). */
function homeFirst(homeTeamId: string, links: readonly { teamId: string }[]): string[] {
  const rest = links
    .map((l) => l.teamId)
    .filter((t) => t !== homeTeamId)
    .sort();
  return [homeTeamId, ...rest];
}
```

Change `listByTeam` and `findProjects`:

```ts
  async listByTeam(teamId: string, includeArchived = false): Promise<Project[]> {
    // LINKED to the team, home or shared (spec §5.1) — not `projects.teamId`.
    return this.findProjects({ teams: { some: { teamId } } }, includeArchived);
  }

  private async findProjects(
    scope: Prisma.ProjectWhereInput,
    includeArchived: boolean,
  ): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({
      where: { ...scope, ...(includeArchived ? {} : { archived: false }) },
      orderBy: { name: 'asc' },
      select: {
        ...PROJECT_SELECT,
        teams: { select: { teamId: true } },
        // …the existing `subprojects` and `tasks` nested selects, unchanged…
      },
    });
    return rows.map(({ teams, ...p }) => ({ ...p, teamIds: homeFirst(p.teamId, teams) }));
  }
```

(Keep the existing `subprojects` and `tasks` blocks and their comments exactly as they are.)

Change `findForActor`:

```ts
  async findForActor(id: string): Promise<{
    id: string;
    teamId: string;
    teamIds: string[];
    name: string;
    color: string | null;
    archived: boolean;
  } | null> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      select: { ...PROJECT_SELECT, teams: { select: { teamId: true } } },
    });
    if (!row) return null;
    const { teams, ...p } = row;
    return { ...p, teamIds: homeFirst(p.teamId, teams) };
  }
```

Change `findTaskForActor` and `findSubprojectForActor` so they select `project: { select: { teamId: true, teams: { select: { teamId: true } } } }` and return `{ ...rest, teamIds: homeFirst(project.teamId, project.teams) }`. Their return types become `(Task & { teamIds: string[] }) | null` and `(Subproject & { teamIds: string[]; workTypeId: string | null }) | null`.

- [ ] **Step 4: Service authorization.** In `projects.service.ts`, replace `assertCanAdminister` with:

```ts
  /**
   * USE a project (its subprojects and tasks, its detail): ADMIN org-wide, or a MANAGER whose
   * team is linked to it (home or shared, spec §5.2). The single place this rule lives.
   */
  private assertCanUse(teamIds: readonly string[], actor: SessionUser): void {
    if (actor.role === 'ADMIN') return;
    if (!teamIds.includes(actor.teamId)) throw this.forbidden();
  }

  /**
   * OWN a project (archive, recolor): as USE, but a SHARED project belongs to more than one
   * team's manager, so only an ADMIN may change it — one team must not archive a client another
   * team is tracking.
   */
  private assertCanOwn(teamIds: readonly string[], actor: SessionUser): void {
    this.assertCanUse(teamIds, actor);
    if (actor.role !== 'ADMIN' && teamIds.length > 1) {
      throw new ForbiddenException({
        type: 'https://timetrack.internal/errors/forbidden',
        title: 'Only an admin can change a shared client',
        status: 403,
      });
    }
  }
```

Then update the call sites:

- `createProject`: `this.assertCanUse([dto.teamId], actor)`.
- `createTask`, `updateSubproject`: `this.assertCanUse(sub.teamIds, actor)`.
- `createSubproject`, `listSubprojects`, `listTasks`, `detail`, `topApps`: `this.assertCanUse(project.teamIds, actor)`.
- `updateTask`: `this.assertCanUse(found.teamIds, actor)`, and `const { teamIds: _teamIds, ...task } = found;`.
- `update`: keep an empty body a no-op for USE-level callers. Then:

```ts
this.assertCanUse(project.teamIds, actor);
if (dto.archived !== undefined || dto.color !== undefined) {
  this.assertCanOwn(project.teamIds, actor);
}
```

and in `update`, change `let result: Project = project;` to strip `teamIds`: `const { teamIds: _t, ...current } = project; let result: Project = current;`. Leave that as-is if TypeScript accepts it, since `teamIds` is optional on `Project`.

Update the class doc comment: authorization is "linked-team" (`project_teams`), not "own-team".

- [ ] **Step 5: Fix the unit spec mocks.** In `projects.service.spec.ts`, every `findForActor` mock `{ id, teamId: 'tX' }` becomes `{ id, teamId: 'tX', teamIds: ['tX'] }`. `SUB` / task fixtures replace `teamId: 't1'` with `teamIds: ['t1']`, and overrides like `{ ...SUB, teamId: 't2' }` become `{ ...SUB, teamIds: ['t2'] }`. Then add:

```ts
describe('shared projects (assertCanOwn)', () => {
  it('403s a MANAGER archiving a project linked to two teams, with the shared title', async () => {
    const { svc } = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't1', teamIds: ['t1', 't2'] }),
    });
    await expect(svc.update('p1', { archived: true }, manager)).rejects.toMatchObject({
      response: { title: 'Only an admin can change a shared client' },
    });
  });
});
```

- [ ] **Step 6: Run everything touched**

Run: `pnpm --filter api test -- projects && RUN_E2E=1 pnpm --filter api test:e2e -- test/shared-clients.e2e-spec.ts test/projects-work-types.e2e-spec.ts test/projects.e2e-spec.ts && pnpm --filter api typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/projects apps/api/test/shared-clients.e2e-spec.ts
git commit -m "feat(api): authorize projects by linked teams and admin-own shared clients"
```

---

### Task 5: `PUT /v1/projects/:id/teams`

**Files:**

- Modify: `apps/api/src/modules/projects/projects.repository.ts`
- Modify: `apps/api/src/modules/projects/projects.service.ts`
- Modify: `apps/api/src/modules/projects/projects.controller.ts`
- Test: `apps/api/src/modules/projects/projects.controller.spec.ts`
- Test: `apps/api/test/shared-clients.e2e-spec.ts`

**Interfaces:**

- Consumes: `SetProjectTeamsSchema`, `SetProjectTeams` (Task 2); `lockReconcile`, `RECONCILE_TX`, `isConcurrencyConflict`, `catalogConflict`, `CONCURRENT_CHANGE` (existing); trigger `'project_teams_set'` (Task 3).
- Produces:
  - Repository: `countTeams(ids: readonly string[]): Promise<number>`, `setTeams(id: string, teamIds: readonly string[], actorId: string): Promise<Project>`
  - Service: `setTeams(id: string, dto: SetProjectTeams, actor: SessionUser): Promise<Project>`

- [ ] **Step 1: Write the failing e2e tests:**

```ts
it('set-teams shares and unshares, audits the change, and reconciles in one go', async () => {
  const eng = await team('Eng');
  const ops = await team('Ops');
  await select(eng, 'Payroll');
  await select(ops, 'Internal');
  const acme = await client(eng, 'Acme');

  const shared = await projects().setTeams(acme.id, { teamIds: [eng, ops] }, admin(eng));
  expect(shared.teamIds).toEqual([eng, ops]); // home first
  expect(await activeNames(acme.id)).toEqual(['General', 'Internal', 'Payroll']);
  const internal = await db.prisma.subproject.findFirstOrThrow({
    where: { projectId: acme.id, name: 'Internal' },
    select: { id: true },
  });

  await projects().setTeams(acme.id, { teamIds: [eng] }, admin(eng));
  expect(await activeNames(acme.id)).toEqual(['General', 'Payroll']);
  await expect(
    db.prisma.subproject.findUniqueOrThrow({
      where: { id: internal.id },
      select: { archived: true },
    }),
  ).resolves.toEqual({ archived: true });

  const audits = await db.prisma.auditLog.findMany({
    where: { action: 'project.teams_set', targetId: acme.id },
    orderBy: { timestamp: 'asc' },
    select: { diff: true },
  });
  expect(audits.map((a) => a.diff)).toEqual([
    { from: [eng], to: [eng, ops].sort() },
    { from: [eng, ops].sort(), to: [eng] },
  ]);
});

it('set-teams 422s without the home team and for an unknown team; 404s an unknown project', async () => {
  const eng = await team('Eng');
  const ops = await team('Ops');
  const acme = await client(eng, 'Acme');
  expect(await titleOf(projects().setTeams(acme.id, { teamIds: [ops] }, admin(eng)))).toBe(
    'The home team must stay linked; move the client to change it',
  );
  expect(await titleOf(projects().setTeams(acme.id, { teamIds: [eng, MISSING] }, admin(eng)))).toBe(
    'Unknown team',
  );
  expect(await titleOf(projects().setTeams(MISSING, { teamIds: [eng] }, admin(eng)))).toBe(
    'Project not found',
  );
});
```

- [ ] **Step 2: Run to see them fail**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- test/shared-clients.e2e-spec.ts -t "set-teams"`
Expected: FAIL, `projects(...).setTeams is not a function`.

- [ ] **Step 3: Repository.** Add to `projects.repository.ts`:

```ts
  async countTeams(ids: readonly string[]): Promise<number> {
    return this.prisma.team.count({ where: { id: { in: [...ids] } } });
  }

  /**
   * Replace a project's linked teams (spec §5.3), audit it, and reconcile the project — ONE
   * transaction. Links change BEFORE reconcile, which reads them. The service has already checked
   * that `teamIds` holds the home team and only real teams.
   */
  async setTeams(id: string, teamIds: readonly string[], actorId: string): Promise<Project> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockReconcile(tx);
        const before = await tx.projectTeam.findMany({
          where: { projectId: id },
          select: { teamId: true },
        });
        const next = [...new Set(teamIds)].sort();
        await tx.projectTeam.deleteMany({ where: { projectId: id, teamId: { notIn: next } } });
        await tx.projectTeam.createMany({
          data: next.map((teamId) => ({ projectId: id, teamId })),
          skipDuplicates: true,
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'project.teams_set',
            targetType: 'project',
            targetId: id,
            diff: { from: before.map((b) => b.teamId).sort(), to: next },
          },
        });
        await this.workTypes.reconcile(tx, [id], {
          actorId,
          trigger: 'project_teams_set',
          targetType: 'project',
          targetId: id,
        });
        const project = await tx.project.findUniqueOrThrow({
          where: { id },
          select: PROJECT_SELECT,
        });
        return { ...project, teamIds: homeFirst(project.teamId, next.map((teamId) => ({ teamId }))) };
      }, RECONCILE_TX);
    } catch (e) {
      if (isConcurrencyConflict(e)) throw catalogConflict(CONCURRENT_CHANGE);
      throw e;
    }
  }
```

- [ ] **Step 4: Service.** Add to `projects.service.ts`. Import `SetProjectTeams` from contracts.

```ts
  /** ADMIN-only (the controller's @Roles is the gate): the full set of teams linked to a client. */
  async setTeams(id: string, dto: SetProjectTeams, actor: SessionUser): Promise<Project> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    if (!dto.teamIds.includes(project.teamId)) {
      throw this.unprocessable('The home team must stay linked; move the client to change it');
    }
    if ((await this.repo.countTeams(dto.teamIds)) !== dto.teamIds.length) {
      throw this.unprocessable('Unknown team');
    }
    return this.repo.setTeams(id, dto.teamIds, actor.id);
  }

  private unprocessable(title: string): UnprocessableEntityException {
    return new UnprocessableEntityException({
      type: 'https://timetrack.internal/errors/unprocessable',
      title,
      status: 422,
    });
  }
```

Change the existing inline `UnprocessableEntityException` in `updateTask` to `throw this.unprocessable("Subproject is not in this task's project");`. Do that only if it's a pure refactor with the same title; otherwise leave it alone.

- [ ] **Step 5: Controller.** In `projects.controller.ts`, import `Put`, `SetProjectTeamsSchema` and `type SetProjectTeams`, then add **before** `@Patch(':id')`:

```ts
  /** ADMIN only: share or unshare a client across teams (spec §5.3). */
  @Put(':id/teams')
  @Roles('ADMIN')
  setTeams(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetProjectTeamsSchema)) dto: SetProjectTeams,
    @CurrentUser() actor: SessionUser,
  ): Promise<Project> {
    return this.service.setTeams(id, dto, actor);
  }
```

- [ ] **Step 6: Controller role test.** Open `projects.controller.spec.ts` and find how it asserts `@Roles` metadata on existing handlers (for example `bulkCreate`). Add the same assertion for `setTeams` expecting `['ADMIN']`. MANAGER and EMPLOYEE get 403 from the global `RolesGuard` driven by that metadata; this pins it.

- [ ] **Step 7: Run**

Run: `pnpm --filter api test -- projects && RUN_E2E=1 pnpm --filter api test:e2e -- test/shared-clients.e2e-spec.ts && pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/projects apps/api/test/shared-clients.e2e-spec.ts
git commit -m "feat(api): add admin set-teams to share a client across teams"
```

---

### Task 6: Per-team split on the client detail, and members scoped for managers

**Files:**

- Modify: `apps/api/src/modules/projects/projects.repository.ts`
- Modify: `apps/api/src/modules/projects/projects.service.ts`
- Test: `apps/api/test/shared-clients.e2e-spec.ts`

**Interfaces:**

- Consumes: `ProjectTeamRow`, `ProjectDetailSchema.teamIds/byTeam` (Task 2); `time_entries.teamId` (Task 1).
- Produces:
  - `teamsForProject(projectId, from, to, freshnessSeconds): Promise<ProjectTeamRow[]>`
  - `membersForProject(projectId, from, to, freshnessSeconds, teamId?: string)`

- [ ] **Step 1: Write the failing e2e test:**

```ts
it('detail splits a shared client by the team each entry was tracked under', async () => {
  const eng = await team('Eng');
  const ops = await team('Ops');
  const acme = await client(eng, 'Acme');
  await link(acme.id, ops);
  const [ann, bob] = await Promise.all([
    db.prisma.user.create({
      data: { email: 'ann@x.io', name: 'Ann', passwordHash: 'x', teamId: eng },
      select: { id: true },
    }),
    db.prisma.user.create({
      data: { email: 'bob@x.io', name: 'Bob', passwordHash: 'x', teamId: ops },
      select: { id: true },
    }),
  ]);
  const entry = (id: string, userId: string, hour: number) => ({
    id,
    userId,
    projectId: acme.id,
    source: 'MANUAL' as const,
    startTime: new Date(`2026-07-11T0${hour}:00:00Z`),
    endTime: new Date(`2026-07-11T0${hour + 1}:00:00Z`),
  });
  await db.prisma.timeEntry.createMany({
    data: [
      entry('01920000-0000-7000-8000-00000000f001', ann.id, 1),
      entry('01920000-0000-7000-8000-00000000f002', bob.id, 3),
      entry('01920000-0000-7000-8000-00000000f003', bob.id, 5),
    ],
  });
  const range = { from: '2026-07-11T00:00:00.000Z', to: '2026-07-12T00:00:00.000Z' };

  const asAdmin = await projects().detail(acme.id, range, admin(eng));
  expect(asAdmin.teamIds[0]).toBe(eng);
  expect(asAdmin.byTeam).toEqual([
    { teamId: ops, teamName: 'Ops', trackedSeconds: 7200 },
    { teamId: eng, teamName: 'Eng', trackedSeconds: 3600 },
  ]);
  expect(asAdmin.totalSeconds).toBe(10800);
  expect(asAdmin.members.map((m) => m.name).sort()).toEqual(['Ann', 'Bob']);

  const asOpsManager = await projects().detail(
    acme.id,
    range,
    manager('01920000-0000-7000-8000-0000000000b2', ops),
  );
  expect(asOpsManager.byTeam).toEqual(asAdmin.byTeam);
  expect(asOpsManager.totalSeconds).toBe(10800);
  expect(asOpsManager.members.map((m) => m.name)).toEqual(['Bob']);
});
```

Check that `timeEntry.createMany` satisfies every required column in `model TimeEntry` (`source` and the others). Add whatever else is required, following the Prisma error.

- [ ] **Step 2: Run to see it fail**

Run: `RUN_E2E=1 pnpm --filter api test:e2e -- test/shared-clients.e2e-spec.ts -t "detail splits"`
Expected: FAIL. `ProjectDetailSchema.parse` rejects the result because `teamIds` and `byTeam` are missing.

- [ ] **Step 3: Repository.** Add after `membersForProject`:

```ts
  /** The client's time split by the team stamped on each entry (spec §5.6); null → Unassigned. */
  async teamsForProject(
    projectId: string,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<{ teamId: string | null; teamName: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ teamId: string | null; teamName: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."teamId" AS "teamId", COALESCE(t.name, 'Unassigned') AS "teamName",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(${ENTRY_END(freshnessSeconds)}, ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      LEFT JOIN teams t ON t.id = te."teamId"
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
        AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
      GROUP BY te."teamId", t.name
      ORDER BY "trackedSeconds" DESC, "teamId" ASC NULLS LAST
    `;
    return rows.map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName,
      trackedSeconds: Number(r.trackedSeconds),
    }));
  }
```

Give `membersForProject` an optional last param `teamId?: string` and add to its `WHERE`:

```ts
        ${teamId !== undefined ? Prisma.sql`AND te."teamId" = ${teamId}` : Prisma.empty}
```

Add a doc line: a MANAGER on a shared client sees only their own team's people (spec §5.6).

- [ ] **Step 4: Service `detail`.** Replace the `Promise.all` and the total:

```ts
// A MANAGER on a SHARED client sees every team's total but only their own team's people.
const memberTeam = actor.role !== 'ADMIN' && project.teamIds.length > 1 ? actor.teamId : undefined;
const [trend, members, tasks, subprojects, byTeam] = await Promise.all([
  this.repo.hoursByDay(id, from, to, this.trackingFreshnessSeconds),
  this.repo.membersForProject(id, from, to, this.trackingFreshnessSeconds, memberTeam),
  this.repo.tasksForProject(id, from, to, this.trackingFreshnessSeconds),
  this.repo.subprojectsForProject(id, from, to, this.trackingFreshnessSeconds),
  this.repo.teamsForProject(id, from, to, this.trackingFreshnessSeconds),
]);
const totalSeconds = byTeam.reduce((sum, t) => sum + t.trackedSeconds, 0);
```

and add `teamIds: project.teamIds,` and `byTeam,` to the object passed to `ProjectDetailSchema.parse`.

- [ ] **Step 5: Run**

Run: `pnpm --filter api test -- projects && RUN_E2E=1 pnpm --filter api test:e2e -- test/shared-clients.e2e-spec.ts test/projects.e2e-spec.ts && pnpm --filter api typecheck`
Expected: PASS. If a `projects.e2e-spec.ts` detail test compares the whole object, add `teamIds` and `byTeam` to its expectation. Don't loosen it to `toMatchObject`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/projects apps/api/test
git commit -m "feat(api): split client detail by team and scope members for managers"
```

---

### Task 7: Dashboard — share on the catalog, split and ownership on the detail

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts`
- Modify: `apps/dashboard/src/lib/catalog-view.ts` (+ `catalog-view.spec.ts`)
- Modify: `apps/dashboard/src/lib/project-detail-view.ts` (+ `project-detail-view.spec.ts`)
- Modify: `apps/dashboard/src/app/(app)/projects/actions.ts`
- Create: `apps/dashboard/src/components/projects/ProjectShareTeams.tsx`
- Modify: `apps/dashboard/src/app/(app)/admin/catalog/page.tsx`
- Modify: `apps/dashboard/src/components/projects/ProjectDetailContent.tsx`

**Interfaces:**

- Consumes: `SetProjectTeams`, `Project.teamIds`, `ProjectDetail.teamIds/byTeam` (Task 2); `PUT /v1/projects/:id/teams` (Task 5).
- Produces:
  - `api.setProjectTeams(token, id, dto): Promise<Project>`
  - `ClientRow` gains `teams: { id: string; name: string }[]` and `shared: boolean`
  - `toTeamSplitRows(byTeam, totalSeconds): { key: string; name: string; seconds: number; pct: number }[]`
  - `canOwnProject(role: string, teamIds: readonly string[]): boolean`
  - `setProjectTeamsAction`

- [ ] **Step 1: Write failing view tests.** Dashboard vitest runs in node with no jsdom, so it tests pure transforms only.

Append to `catalog-view.spec.ts`:

```ts
describe('clientRows with shared clients', () => {
  const teams = [
    { id: 't1', name: 'Eng' },
    { id: 't2', name: 'Ops' },
  ];
  const project = (over: Partial<Project>): Project => ({
    id: 'p1',
    teamId: 't1',
    name: 'Acme',
    color: null,
    archived: false,
    ...over,
  });
  it('lists linked teams home first and marks 2+ as shared', () => {
    const [row] = clientRows(teams, [project({ teamIds: ['t1', 't2'] })]);
    expect(row).toMatchObject({
      teams: [
        { id: 't1', name: 'Eng' },
        { id: 't2', name: 'Ops' },
      ],
      shared: true,
    });
  });
  it('falls back to the home team when teamIds is absent', () => {
    const [row] = clientRows(teams, [project({})]);
    expect(row).toMatchObject({ teams: [{ id: 't1', name: 'Eng' }], shared: false });
  });
});
```

(Import `Project` as a type from `@timetrack/contracts` if the spec doesn't already.)

Append to `project-detail-view.spec.ts`:

```ts
describe('toTeamSplitRows', () => {
  it('names the Unassigned bucket and computes shares of the total', () => {
    expect(
      toTeamSplitRows(
        [
          { teamId: 't2', teamName: 'Ops', trackedSeconds: 7200 },
          { teamId: null, teamName: 'Unassigned', trackedSeconds: 3600 },
        ],
        10800,
      ),
    ).toEqual([
      { key: 't2', name: 'Ops', seconds: 7200, pct: (7200 / 10800) * 100 },
      { key: 'unassigned', name: 'Unassigned', seconds: 3600, pct: (3600 / 10800) * 100 },
    ]);
  });
  it('is 0% everywhere when nothing was tracked', () => {
    expect(toTeamSplitRows([{ teamId: 't1', teamName: 'Eng', trackedSeconds: 0 }], 0)[0]?.pct).toBe(
      0,
    );
  });
});

describe('canOwnProject', () => {
  it('lets an ADMIN own anything and a MANAGER only an unshared client', () => {
    expect(canOwnProject('ADMIN', ['t1', 't2'])).toBe(true);
    expect(canOwnProject('MANAGER', ['t1'])).toBe(true);
    expect(canOwnProject('MANAGER', ['t1', 't2'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter dashboard test -- catalog-view project-detail-view`
Expected: FAIL, `toTeamSplitRows is not exported`.

- [ ] **Step 3: Implement the view helpers.**

In `catalog-view.ts`, extend `ClientRow`:

```ts
export type ClientRow = {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  /** Linked teams, home first; one entry unless the client is shared. */
  teams: { id: string; name: string }[];
  shared: boolean;
  archived: boolean;
};
```

and in `clientRows`'s map:

```ts
    .map((p) => {
      const ids = p.teamIds ?? [p.teamId];
      return {
        id: p.id,
        name: p.name,
        teamId: p.teamId,
        teamName: names.get(p.teamId) ?? 'Unknown team',
        teams: ids.map((id) => ({ id, name: names.get(id) ?? 'Unknown team' })),
        shared: ids.length > 1,
        archived: p.archived,
      };
    })
```

In `project-detail-view.ts`:

```ts
/** The client's time by team, for the split table (spec §6). Share is of the whole client. */
export function toTeamSplitRows(
  byTeam: ProjectTeamRow[],
  totalSeconds: number,
): { key: string; name: string; seconds: number; pct: number }[] {
  return byTeam.map((t) => ({
    key: t.teamId ?? 'unassigned',
    name: t.teamName,
    seconds: t.trackedSeconds,
    pct: totalSeconds === 0 ? 0 : (t.trackedSeconds / totalSeconds) * 100,
  }));
}

/** Mirrors the API's assertCanOwn: a shared client is ADMIN-only to archive or recolor. */
export function canOwnProject(role: string, teamIds: readonly string[]): boolean {
  return role === 'ADMIN' || teamIds.length <= 1;
}
```

(Import `type ProjectTeamRow` from `@timetrack/contracts`.)

- [ ] **Step 4: Run the view tests**

Run: `pnpm --filter dashboard test -- catalog-view project-detail-view`
Expected: PASS.

- [ ] **Step 5: API client and server action.**

In `api-client.ts`, next to `moveProject` (import `type SetProjectTeams`):

```ts
  /** ADMIN-only. Replaces the client's linked teams (home included); the API audits it. */
  setProjectTeams: (token: string, id: string, dto: SetProjectTeams): Promise<Project> =>
    send('PUT', `/projects/${id}/teams`, dto, ProjectSchema, token),
```

Check that `send` accepts `'PUT'`. If its method type is a union without `'PUT'`, add it.

In `projects/actions.ts`, after `moveProjectAction` (import `SetProjectTeamsSchema`):

```ts
export async function setProjectTeamsAction(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const parsed = SetProjectTeamsSchema.safeParse({
    teamIds: formData.getAll('teamId').filter((v): v is string => typeof v === 'string'),
  });
  if (!id || !parsed.success) return { ok: false, message: 'Pick at least the home team.' };

  try {
    await api.setProjectTeams(session.accessToken, id, parsed.data);
    revalidatePath('/projects');
    revalidatePath(`/projects/${id}`);
    revalidatePath('/admin/catalog');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Could not save the teams.' };
  }
}
```

- [ ] **Step 6: Share control.** Create `components/projects/ProjectShareTeams.tsx`:

```tsx
'use client';

import type { TeamListItem } from '@timetrack/contracts';
import { setProjectTeamsAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { useToastAction } from '../ui/useToastAction';
import { buttonClasses } from '../ui/Button';

const INITIAL: ProjectActionState = { ok: false };

/**
 * ADMIN-only "Share…" on a client row: tick the teams that may use it. The home team is always
 * ticked and cannot be unticked (a disabled checkbox is not submitted, so a hidden input carries
 * it); changing the home team is "move", not share.
 */
export function ProjectShareTeams({
  id,
  homeTeamId,
  linkedTeamIds,
  teams,
}: {
  id: string;
  homeTeamId: string;
  linkedTeamIds: string[];
  teams: TeamListItem[];
}) {
  const [state, formAction, pending] = useToastAction(
    setProjectTeamsAction,
    INITIAL,
    'Teams saved',
  );
  if (teams.length < 2) return null;
  const linked = new Set(linkedTeamIds);

  return (
    <details className="relative">
      <summary className={buttonClasses('secondary', 'sm')}>Share…</summary>
      <form
        action={formAction}
        className="bg-surface border-separator absolute z-10 mt-2 flex max-h-72 w-64 flex-col gap-2 overflow-y-auto rounded-lg border p-3 shadow"
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="teamId" value={homeTeamId} />
        {teams.map((t) => (
          <label key={t.id} className="text-body flex items-center gap-2">
            <input
              type="checkbox"
              name={t.id === homeTeamId ? undefined : 'teamId'}
              value={t.id}
              defaultChecked={linked.has(t.id)}
              disabled={t.id === homeTeamId}
            />
            {t.name}
            {t.id === homeTeamId ? (
              <span className="text-text-secondary text-caption">(home)</span>
            ) : null}
          </label>
        ))}
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={pending}>
          Save
        </button>
        {!state.ok && state.message ? (
          <p className="text-caption text-bad">{state.message}</p>
        ) : null}
      </form>
    </details>
  );
}
```

Before writing it, check the real exports and signature: `useToastAction(action, initial, successText)` and `buttonClasses(variant, size)`, matching `ProjectTeamMove.tsx`. Also check the class names used for surfaces and error text in sibling components (`bg-surface`, `text-bad`). Use whatever tokens those components actually use, and look at how `ProjectTeamMove` surfaces errors rather than guessing.

- [ ] **Step 7: Catalog page.** In `admin/catalog/page.tsx`, the Clients table's **Team** cell becomes:

```tsx
<Td>
  <div className="flex flex-wrap items-center gap-2">
    {teams.length < 2 ? (
      c.teamName
    ) : (
      <ProjectTeamMove id={c.id} projectName={c.name} teamId={c.teamId} teams={teams} />
    )}
    {c.teams.slice(1).map((t) => (
      <Badge key={t.id} tone="neutral">
        {t.name}
      </Badge>
    ))}
    <ProjectShareTeams
      id={c.id}
      homeTeamId={c.teamId}
      linkedTeamIds={c.teams.map((t) => t.id)}
      teams={teams}
    />
  </div>
</Td>
```

In the **Status** cell, add `{c.shared ? <Badge tone="neutral">Shared</Badge> : null}` beside the Active/Archived badge. Import `ProjectShareTeams`. Check `Badge`'s real `tone` values in `components/ui/Badge.tsx` and pick an existing one.

- [ ] **Step 8: Detail page.** In `ProjectDetailContent.tsx`:
- `loadProjectDetail` returns `role: session.role` in its data object, and `ProjectDetailData` gains `role: string`.
- In the header, after the Archived pill: `{detail.teamIds.length > 1 && (<span className="…same pill classes…">Shared · {detail.teamIds.length} teams</span>)}`.
- In the controls row, wrap `ProjectRecolor` and `ProjectArchiveToggle` in `{canOwnProject(data.role, detail.teamIds) && (<>…</>)}`.
- Add a section after "Hours over time", shown only when `detail.byTeam.length > 1`:

```tsx
{
  detail.byTeam.length > 1 && (
    <section className="flex flex-col gap-3">
      <SectionHeader label="By team" />
      <Card padding="md">
        <div className="flex flex-col gap-3.5">
          {toTeamSplitRows(detail.byTeam, detail.totalSeconds).map((t) => (
            <BarMeter
              key={t.key}
              label={t.name}
              value={formatDuration(t.seconds)}
              fills={[{ pct: t.pct, color: 'var(--tt-accent)' }]}
            />
          ))}
        </div>
      </Card>
    </section>
  );
}
```

- [ ] **Step 9: Typecheck, lint, test**

Run: `pnpm --filter dashboard typecheck && pnpm --filter dashboard lint && pnpm --filter dashboard test`
Expected: PASS. Watch for `exactOptionalPropertyTypes` errors, which only surface in typecheck.

- [ ] **Step 10: Commit** (split into two commits if the diff reads better that way):

```bash
git add apps/dashboard/src/lib apps/dashboard/src/app/'(app)'/projects/actions.ts apps/dashboard/src/components/projects/ProjectShareTeams.tsx apps/dashboard/src/app/'(app)'/admin/catalog/page.tsx
git commit -m "feat(dashboard): share a client across teams from the catalog"
git add apps/dashboard/src/components/projects/ProjectDetailContent.tsx
git commit -m "feat(dashboard): show the per-team split and shared state on a client"
```

---

### Task 8: Full verification, browser pass, PR

- [ ] **Step 1: Full suite**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. Paste the tail of the output.

- [ ] **Step 2: API e2e plus the coverage gate**

Run: `RUN_E2E=1 pnpm --filter api test:coverage` and `pnpm --filter @timetrack/contracts test -- --coverage`
Expected: functions ≥ 80% on api, and branches ≥ 80% on contracts.

- [ ] **Step 3: Browser pass on the local stack.** Stop any stale `pnpm dev` first; the API is on 3001. Then, as ADMIN:
  1. On `/admin/catalog`, share a client with a second team and check that the chip and the Shared badge appear.
  2. Sign in as a MANAGER of the second team. The client is listed on `/projects`, the detail shows "Shared · 2 teams", and there's no archive or recolor control.
  3. Create a manual entry for a user in each team, then check the "By team" section on the detail as ADMIN.
  4. Unshare, and check that the second team's work-type subprojects are archived.

  Take screenshots. If the browser can't reach localhost, verify through the API with curl and say plainly that the visual check wasn't done.

- [ ] **Step 4: PR.** Target `main`, using the work account. The body includes:
  - A summary.
  - The deploy note: no desktop release. Press **Re-sync** once after deploy. Run the `project_teams` repair SQL from spec §8 after deploy, and again after any rollback followed by a redeploy.
  - The test evidence.
  - The manager-members scoping note.
