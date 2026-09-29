# Team Work Types and Client Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global work-type catalog. Each team picks its own work types, the server keeps one ordinary `Subproject` row per enabled work type on every one of the team's clients (projects), and ADMINs manage it all, including a pasted client import, from a new `/admin/catalog` page.

**Architecture:**

- Work types are **materialized**. A single `reconcile(tx, projectIds, audit)` method on `WorkTypesRepository` runs inside the transaction of every trigger. It creates, links, restores, renames and archives the linked subprojects, and never deletes any.
- `ProjectsRepository` receives `WorkTypesRepository` by injection (`ProjectsModule` imports `WorkTypesModule`). Project create, bulk import and team moves then reconcile inside their own transaction.
- Nothing the desktop clients read changes: `GET /v1/projects`, `SubprojectSchema` and time-entry sync keep exactly today's shapes.

**Tech Stack:** NestJS 11 (Fastify), Prisma 7 (pg adapter, hand-authored SQL migration), Zod 4, Vitest (unit + real-Postgres e2e via Testcontainers), and Next.js 16 App Router with server actions.

**Spec:** `docs/superpowers/specs/2026-09-29-team-work-types-design.md`. The spec is the binding authority. Read it next to this plan.

## Global Constraints

Every task implicitly includes this section. `CLAUDE.md` at the repo root is also binding.

**Spec rules**

- **ADMIN only:** the catalog, the per-team selection, the client import and re-sync are all ADMIN only (`@Roles('ADMIN')`). There is no `@ResourceScope`, because these are org-wide objects with no owning user. Every such controller gets a comment saying so.
- **`/v1` must not change for shipped clients.** Mac 0.7.0 and Windows 0.3.0 need no new release. `GET /v1/projects`, `SubprojectSchema`, `tasks[]` and time-entry sync keep their shapes. **`workTypeId` never appears in an API response for a subproject.**
- **Reserved name:** `General` (the contracts constant `DEFAULT_SUBPROJECT_NAME`) is reserved case-insensitively. The catalog can't contain it (409). General and hand-made subprojects keep `workTypeId = null`.
- **Linked subprojects:** `PATCH /v1/projects/subprojects/:id` on a row with `workTypeId` set returns 409 with the title exactly `Managed by the work type catalog`.
- **Duplicate subproject names:** `POST /v1/projects/subprojects` returns 409 when the project already has a **non-archived** subproject of that name, compared case-insensitively.
- **Bulk import skip reasons:** `Already exists in <team name>` for a name that exists anywhere in the org (case-insensitive), and `Duplicate in list`.
- **Limits:**
  - `POST /v1/work-types/bulk` takes 1–100 names.
  - `PUT /v1/work-types/teams/:teamId` takes at most 100 ids.
  - `POST /v1/projects/bulk` takes 1–500 names.
  - A single name is at most 200 characters (`NAME_MAX_LENGTH`).
- **Reconcile transactions:** any transaction that reconciles more than one project passes `{ timeout: 60_000, maxWait: 10_000 }` (exported as `RECONCILE_TX`).
- **Reconcile audit:** every reconcile call writes exactly one `AuditLog` row with action `work_type.reconcile` and diff `{ trigger, projects, created, linked, restored, renamed, archived }`.
- **Deletes:** a delete of a `team_work_types` row writes its `AuditLog` row in the same transaction.

**Repo rules**

- **Commits:** Conventional Commits, `<type>(<scope>): <summary ≤72 chars>`. Scopes are `api|worker|dashboard|client|db|contracts|infra`. **No AI attribution anywhere:** no `Co-Authored-By`, no generated-by footer, no `--author` or `-c user.*`. Commit with the repo's configured git user as is. Commit only at the plan's commit steps, and only after the checks in that task passed.
- **Validation:** Zod only.
  - Body schemas that need a cross-field rule use `.check()`, never `.refine()`. `.refine()` drops `ZodObject`, which silently disables the pipe's strict mode.
  - Update schemas have no `.default()`.
  - Pipes are scoped to the parameter: `@Body(new ZodValidationPipe(Schema))`.
- **Prisma:** only in `*.repository.ts`, and always with an explicit `select`. Never `select *` back to a client.
- **Nest DI under vitest:** any class whose constructor has an explicit `@Inject` must give **every** parameter an explicit `@Inject` token. vitest drops `design:paramtypes`. This follows the `projects.service.ts` / `time-entries.repository.ts` precedent.
- **Logging:** Pino only, and no `console.log`. Never log under the key `err`; use `reason`.

**Environment facts**

- **Migrations:** `prisma migrate dev` cannot run non-interactively here. Hand-author `migration.sql`, then run `pnpm db:deploy` and `pnpm --filter @timetrack/db build` (the build runs `prisma generate` itself).
  - Partial and expression indexes are invisible to Prisma's diff, so they live only in SQL.
  - **Never run `prisma migrate diff` against the dev database.** It wiped the dev DB once. The e2e global setup's fresh `prisma migrate deploy` is what validates the SQL.
- **Packages are consumed from `dist`:** after editing `packages/contracts`, run `pnpm --filter @timetrack/contracts build` before running any app test. Otherwise app specs fail in code you never touched.
- **API unit tests:** `pnpm --filter @timetrack/api test -- <pattern>`. This **excludes** e2e specs.
- **One API e2e spec:** `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- <pattern>`. It needs Docker running; `pnpm infra:up` starts the dev stack, and Testcontainers starts its own Postgres 18.
- **Typecheck separately:** vitest does not typecheck specs, so every task also runs `pnpm --filter <pkg> typecheck`.
  - `apps/api`'s `tsconfig.json` includes only `src/**`. The e2e specs under `apps/api/test/` are **not typechecked by anything**. They fail only at runtime, so a failing-first e2e step fails by _running_ it, not by typechecking it. Write them as carefully typed as `src` specs anyway. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on:
  - Guard index access with `?.` or `!` in specs.
  - Conditionally spread optional keys instead of passing `undefined`.
- **Dashboard tests:** dashboard vitest runs in a node environment with no DOM, so unit-test pure transforms, not components. Dashboard Playwright files are `*.spec.ts` under `e2e/`. The existing admin ones are `.skip` scaffolds, and this plan adds none.
- **Coverage gates:** contracts coverage binds on **branches** (`pnpm --filter @timetrack/contracts test:coverage`). API coverage is `RUN_E2E=1 pnpm --filter @timetrack/api test:coverage`, which runs unit and e2e combined; functions is the binding metric.
- **Formatting:** run `pnpm prettier --write` only on files you touched. A root-wide `pnpm format` is scope creep, because `main` already fails `format:check` on about 23 unrelated files.

## Rulings on spec ambiguities

The spec is silent or self-contradictory at these points. The plan implements the rulings below. A reviewer should treat them as decided, not as drift.

1. **R1. The `·` separator.** The spec says "a middle dot with spaces around it". The parser splits on U+00B7 when it has whitespace **or a line edge** on each side, so `  · Automation` at the start of a line splits correctly. A dot inside a word (`a·b`) never splits.
2. **R2. Header lines.** Lines such as `Sub-Project — 12 options` in a careless paste are kept as names. The preview shows them, and nothing beyond the spec's rules filters them.
3. **R3. Stray `&`.** The spec's "turn a stray `&` before an entity into a plain `&`" falls out of ordinary decoding: `&&nbsp;` becomes `& ` followed by whitespace collapse. There is no extra rule. Unknown named entities (`&copy;`) and out-of-range numeric ones (`&#0;`) are left verbatim.
4. **R4. The API normalizes, and does not re-split.** The API receives `names: string[]`. It runs `normalizeName` on each name, then skips it with a reason instead of rejecting the whole batch:
   - `Empty name` if it is empty after normalization;
   - `Longer than 200 characters` if it is too long;
   - `Reserved name` if it is "General" (work types only);
   - `Already in the catalog` for work types;
   - `Already exists in <team>` for projects;
   - `Duplicate in list`.

   Each raw element is capped at 1,000 characters by the schema so the payload stays bounded. The dashboard sends the output of `parseNameList(text)`.

5. **R5. `PUT /v1/work-types/teams/:teamId` replaces only the non-archived part of the selection.**
   - Links to **archived** work types are kept, so restoring a work type brings it back for the same teams, with the same subproject ids.
   - Sending an archived id is still a 422, as the spec says.
   - The response's `workTypeIds` is the full stored set, archived links included.
   - On the dashboard, archived rows' checkboxes are disabled and not submitted.
6. **R6. The audit row targets for `work_type.reconcile`.** A row is written on **every** call, even when every count is 0:

   | trigger               | targetType  | targetId     |
   | --------------------- | ----------- | ------------ |
   | `team_selection`      | `team`      | the team id  |
   | `work_type_update`    | `work_type` | work type id |
   | `project_create`      | `project`   | project id   |
   | `project_bulk_create` | `team`      | target team  |
   | `project_team_change` | `project`   | project id   |
   | `resync`              | `work_type` | `all`        |

   Existing project e2e assertions that read "the" audit row of a project without an `action` filter get one added in Task 5.

7. **R7. Adoption candidates.** When several unlinked, non-default rows match a work type's name, reconcile adopts the non-archived one first, then the first in `id` order (UUIDv7, so the oldest). The `General` default is never adopted.
8. **R8. Counting.** An adopted row counts as `linked` only, even when it was also unarchived or re-cased. `restored` and `renamed` count only rows that were already linked. `created` is the real `createMany` count; see R9.
9. **R9. Concurrent reconciles.** Creates use `createMany({ skipDuplicates: true })`. That is `ON CONFLICT DO NOTHING` with no target, which covers the partial unique index. Any other unique violation surfacing from a reconciling transaction is caught in the repository that owns the `$transaction` and mapped to a 409 problem. It is never a 500.
10. **R10. The dashboard move control.** The spec says the clients table uses "the existing `ProjectTeamPicker` to move it". `ProjectTeamPicker` is a link nav. The move control is **`ProjectTeamMove`**, and the plan uses that. `moveProjectAction` also gets `revalidatePath('/admin/catalog')` so the table updates after a move.
11. **R11. How the 403s are tested.** The repo's precedent pins `@Roles` metadata in the controller spec. In addition, each new handler is run through a real `RolesGuard` (with `new Reflector()`) as MANAGER and as EMPLOYEE, and must throw `ForbiddenException`. This is the literal "403 for MANAGER and EMPLOYEE on every new route".
12. **R12. The pure reconcile planner lives in its own file.** `planReconcile` goes in `work-types.reconcile.ts`, which contains no Prisma, and is unit-tested. This is one extra file beside the six-file module shape, with the same precedent as `projects.tokens.ts`. The shared skip logic `planNameImport` goes in `apps/api/src/common/name-import.ts`, because both the `work-types` and `projects` modules use it.
13. **R13. Single-project reconciles use the default transaction timeout.** `createProject` and `setTeam` touch one project, which is at most about 100 rows, so they keep Prisma's default transaction options. Bulk import, team selection, work-type update and re-sync use `RECONCILE_TX`.
14. **R14. The work-type rename check is case-insensitive.**
    - "General" in any case returns 409 `“General” is reserved`.
    - A name equal, case-insensitively, to **another** work type returns 409 `A work type with this name already exists`.
    - Re-casing a work type's own name is allowed.
15. **R15. The bulk colour palette.** "A palette colour assigned in turn" means that the _i_-th accepted name gets `PROJECT_PALETTE[i % PROJECT_PALETTE.length]`.
16. **R16. Known limitation, accepted:** renaming a work type to a name that a hand-made subproject on some project already has leaves two same-named subprojects on that project. Rule 1 renames linked rows unconditionally, and the spec doesn't ask for a merge.
17. **R17. Where the §10 409s apply.** The 409s for a catalog name "General" and for a case-insensitive duplicate are implemented on **rename** (`PATCH /v1/work-types/:id`). **Bulk create** reports the same conditions as skips (`Reserved name`, `Already in the catalog`), which fits its `{ created, skipped }` result shape. A concurrent create that slips past the check still gets a 409 from the unique index.
18. **R18. Column separators are exactly the spec's.** Only tab, `│` and `|` are column separators. Other box verticals (`┃`, `║`) are not split on.

## Review Focus

These are the five conditions most likely to bite someone that the spec implies but does not test. Each one has a pinned test in the task named.

1. **Two overlapping saves:** two admins save the same team column at once, or re-sync runs during a save. The expected result is no 500 and exactly one subproject per (project, work type). Pinned in **Task 4**, test `concurrent saves never duplicate or 500`.
2. **An archived hand-made row with the work type's name:** a work type is enabled on a project that already has an **archived** hand-made subproject of that name. The row should be adopted and restored, not duplicated. Pinned in **Task 3**, test `adopts a hand-made same-name row, even an archived one, instead of duplicating`.
3. **A bad line in a large paste:** one line in a 98-line paste is over 200 characters, or empty after decoding. That line should be skipped with a reason, and the other 97 imported. Pinned in **Task 4** (service spec `skips empty and over-long names with a reason`) and **Task 5** (service spec `bulkCreate skips over-long names instead of failing the batch`).
4. **Saving a column that has an archived work type ticked:** the archived selection should survive the save, and a later Restore should bring the rows back with the **same ids**. Pinned in **Task 4**, test `an archived selection survives a column save and restore brings back the same rows`.
5. **Moving a client away and back:** a client moved away and back should get its original linked rows restored (same ids, time history intact), not new ones. Pinned in **Task 5**, test `moving a project to another team swaps its work types, and moving back restores the same rows`.

---

## File map

| File                                                                        | Task | Responsibility                                                                    |
| --------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------- |
| `packages/contracts/src/name-list.ts` (+ `.spec.ts`)                        | 1    | `parseNameList`, `normalizeName`, `nameKey`, `NAME_MAX_LENGTH`, skip schemas      |
| `packages/contracts/src/work-types.ts` (+ `.spec.ts`)                       | 1    | Work-type request/response schemas, `ReconcileCountsSchema`                       |
| `packages/contracts/src/projects.ts` (+ `.spec.ts`)                         | 1    | `BulkCreateProjectsSchema`, `BulkCreateProjectsResultSchema`                      |
| `packages/db/prisma/schema.prisma`                                          | 2    | `WorkType`, `TeamWorkType`, `Subproject.workTypeId`                               |
| `packages/db/prisma/migrations/20260930120000_add_work_types/migration.sql` | 2    | Tables, FK, the two raw indexes                                                   |
| `apps/api/src/modules/work-types/work-types.reconcile.ts` (+ `.spec.ts`)    | 3    | Pure planner `planReconcile`, `groupRenames`, the trigger/audit types             |
| `apps/api/src/modules/work-types/work-types.repository.ts`                  | 3, 4 | `reconcile`, catalog CRUD, selection, resync, `RECONCILE_TX`, `isUniqueViolation` |
| `apps/api/src/common/name-import.ts` (+ `.spec.ts`)                         | 4    | `planNameImport` — normalize, skip reasons, in-list dedupe                        |
| `apps/api/src/modules/work-types/work-types.{module,controller,service}.ts` | 4    | ADMIN routes                                                                      |
| `apps/api/src/modules/work-types/work-types.{service,controller}.spec.ts`   | 4    | Unit tests incl. literal 403s                                                     |
| `apps/api/test/work-types.e2e-spec.ts`                                      | 2–4  | Schema, reconcile, and service e2e against real Postgres                          |
| `apps/api/src/modules/projects/*`                                           | 5    | Reconcile on create/setTeam, bulk import, guard rails                             |
| `apps/api/test/projects-work-types.e2e-spec.ts`                             | 5    | Project-side integration e2e                                                      |
| `apps/dashboard/src/lib/api-client.ts` (+ spec)                             | 6    | Six new calls, `PUT` support                                                      |
| `apps/dashboard/src/lib/catalog-view.ts` (+ spec)                           | 6    | Matrix, per-team save diff, count/label formatting, client rows                   |
| `apps/dashboard/src/app/(app)/admin/catalog/*`                              | 7    | Page, server actions, forms                                                       |
| `apps/dashboard/src/components/ui/AdminTabs.tsx`                            | 7    | Nav entry                                                                         |

## Shared types (defined once, copied verbatim wherever an Interfaces block names them)

```ts
// packages/contracts/src/work-types.ts (Task 1)
export type ReconcileCounts = {
  projects: number;
  created: number;
  linked: number;
  restored: number;
  renamed: number;
  archived: number;
};

// apps/api/src/modules/work-types/work-types.reconcile.ts (Task 3)
export type ReconcileTrigger =
  | 'team_selection'
  | 'work_type_update'
  | 'project_create'
  | 'project_bulk_create'
  | 'project_team_change'
  | 'resync';

export type ReconcileAudit = {
  actorId: string;
  trigger: ReconcileTrigger;
  targetType: 'team' | 'work_type' | 'project';
  targetId: string;
};

// apps/api/src/modules/work-types/work-types.repository.ts (Task 3)
export const RECONCILE_TX = { timeout: 60_000, maxWait: 10_000 } as const;
// WorkTypesRepository.reconcile(
//   tx: Prisma.TransactionClient,
//   projectIds: readonly string[],
//   audit: ReconcileAudit,
// ): Promise<ReconcileCounts>
```

---

### Task 1: Contracts — name-list parser and work-type schemas

**Files:**

- Create: `packages/contracts/src/name-list.ts`
- Create: `packages/contracts/src/name-list.spec.ts`
- Create: `packages/contracts/src/work-types.ts`
- Create: `packages/contracts/src/work-types.spec.ts`
- Modify: `packages/contracts/src/projects.ts` (add two schemas after `CreateProjectSchema`; add types at the bottom)
- Modify: `packages/contracts/src/projects.spec.ts` (append a describe)
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces (all exported from `@timetrack/contracts`):
  - `NAME_MAX_LENGTH = 200`
  - `nameKey(name: string): string`, which is the case-insensitive comparison key (`toLowerCase()`)
  - `normalizeName(raw: string): string`
  - `parseNameList(text: string): string[]`
  - `ImportNameSchema` (`z.string().max(1000)`)
  - `NameSkipSchema`, which gives `NameSkip = { name: string; reason: string }`
  - `WorkTypeSchema` / `WorkType = { id; name; archived }`
  - `WorkTypeWithTeamsSchema` / `WorkTypeWithTeams = WorkType & { teamIds: string[] }`
  - `WorkTypeListSchema`
  - `BulkCreateWorkTypesSchema` / `BulkCreateWorkTypes = { names: string[] }`
  - `BulkCreateWorkTypesResultSchema` / `BulkCreateWorkTypesResult = { created: WorkType[]; skipped: NameSkip[] }`
  - `UpdateWorkTypeSchema` / `UpdateWorkType = { name?: string; archived?: boolean }`, with at least one key required
  - `SetTeamWorkTypesSchema` / `SetTeamWorkTypes = { workTypeIds: string[] }`
  - `TeamWorkTypesSchema` / `TeamWorkTypes = { teamId: string; workTypeIds: string[] }`
  - `ReconcileCountsSchema` / `ReconcileCounts` (see Shared types)
  - `BulkCreateProjectsSchema` / `BulkCreateProjects = { teamId: string; names: string[] }`
  - `BulkCreateProjectsResultSchema` / `BulkCreateProjectsResult = { created: Project[]; skipped: NameSkip[] }`

- [ ] **Step 1: Write the failing parser tests**

Create `packages/contracts/src/name-list.spec.ts`. The fixture is the literal list the admin pasted, reproduced byte for byte. Do not "tidy" it.

```ts
import { describe, expect, it } from 'vitest';
import {
  ImportNameSchema,
  NAME_MAX_LENGTH,
  NameSkipSchema,
  nameKey,
  normalizeName,
  parseNameList,
} from './name-list.js';

/** Exactly what an admin pasted from the old tool, table borders, header lines, entities and all. */
const PASTED = ` Sub-Project — 12 options

  Bookkeeping · Clean Up &&nbsp; Catch Up · Audit Assist · Payroll · VAT/TAX Filling · Process Development · AdHoc · Internal · R&D · Software Development
  · Automation · Client Communication

  Client — 98 options

  ┌─────────────────────────┬────────────────────────────┬────────────────────────────┐
  │                         │                            │                            │
  ├─────────────────────────┼────────────────────────────┼────────────────────────────┤
  │ Arcade Gamer            │ Biz Trading                │ Brooklyn Booys             │
  ├─────────────────────────┼────────────────────────────┼────────────────────────────┤
  │ Chris Waterguy          │ EcoTrade                   │ TNL / JM Social / Natropia │
  ├─────────────────────────┼───────────────────────────────┼────────────────────────────┤
  │ Creative Food&nbsp; lab │ Austro Media                  │ Mary Myatt                 │
  ├─────────────────────────┼───────────────────────────────┼────────────────────────────┤
  │ ITR/STTR/CTR            │ Nifty AI                      │ Energy Reporting           │
  ├─────────────────────────┼───────────────────────────────┼────────────────────────────┤
  │ Nifty Engineering       │ chineseshop.bd                │`;

describe('parseNameList', () => {
  it('turns the literal pasted table into clean names, in order', () => {
    // The two header lines survive as names on purpose (plan ruling R2): the preview shows
    // them and the admin deletes them. Borders, empty cells and `·` separators all vanish.
    expect(parseNameList(PASTED)).toEqual([
      'Sub-Project — 12 options',
      'Bookkeeping',
      'Clean Up & Catch Up',
      'Audit Assist',
      'Payroll',
      'VAT/TAX Filling',
      'Process Development',
      'AdHoc',
      'Internal',
      'R&D',
      'Software Development',
      'Automation',
      'Client Communication',
      'Client — 98 options',
      'Arcade Gamer',
      'Biz Trading',
      'Brooklyn Booys',
      'Chris Waterguy',
      'EcoTrade',
      'TNL / JM Social / Natropia',
      'Creative Food lab',
      'Austro Media',
      'Mary Myatt',
      'ITR/STTR/CTR',
      'Nifty AI',
      'Energy Reporting',
      'Nifty Engineering',
      'chineseshop.bd',
    ]);
  });

  it('decodes &nbsp; and folds the stray & before it into one plain &', () => {
    expect(parseNameList('Clean Up &&nbsp; Catch Up')).toEqual(['Clean Up & Catch Up']);
    expect(parseNameList('Creative Food&nbsp; lab')).toEqual(['Creative Food lab']);
  });

  it('decodes the named and numeric entities the spec lists', () => {
    expect(parseNameList('A &amp; B\n&lt;x&gt;\n&quot;q&quot;\nO&#39;Brien\n&#x41;&#66;')).toEqual([
      'A & B',
      '<x>',
      '"q"',
      "O'Brien",
      'AB',
    ]);
  });

  it('leaves unknown and out-of-range entities verbatim', () => {
    expect(parseNameList('Copy &copy; Ltd\nZero &#0;\nHuge &#99999999;')).toEqual([
      'Copy &copy; Ltd',
      'Zero &#0;',
      'Huge &#99999999;',
    ]);
  });

  it('treats U+00A0 as a space', () => {
    expect(parseNameList('Nifty\u00a0\u00a0AI')).toEqual(['Nifty AI']);
  });

  it('splits on newlines of every kind, tabs, box columns and ASCII pipes', () => {
    expect(parseNameList('A\r\nB\rC\tD │ E | F')).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('splits on a spaced middle dot, including one at the start or end of a line (ruling R1)', () => {
    expect(parseNameList('Payroll · Audit\n· Automation\nInternal ·')).toEqual([
      'Payroll',
      'Audit',
      'Automation',
      'Internal',
    ]);
  });

  it('does not split on a middle dot inside a word', () => {
    expect(parseNameList('Caf·Bar')).toEqual(['Caf·Bar']);
  });

  it('drops runs made only of box-drawing characters, spaces or dashes', () => {
    expect(parseNameList('┌──┬──┐\n----\n – — \nReal')).toEqual(['Real']);
  });

  it('keeps names with slashes and commas whole', () => {
    expect(parseNameList('ITR/STTR/CTR\nSellcrowd Technology Ltd.\nSmith, Jones & Co')).toEqual([
      'ITR/STTR/CTR',
      'Sellcrowd Technology Ltd.',
      'Smith, Jones & Co',
    ]);
  });

  it('trims, collapses internal whitespace and drops empties', () => {
    expect(parseNameList('   Biz    Trading   \n\n   \n')).toEqual(['Biz Trading']);
  });

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(parseNameList('Payroll\nPAYROLL\npayroll\nAudit')).toEqual(['Payroll', 'Audit']);
  });

  it('returns nothing for empty input', () => {
    expect(parseNameList('')).toEqual([]);
  });
});

describe('normalizeName', () => {
  it('decodes, treats NBSP as space, collapses and trims a single name', () => {
    expect(normalizeName('  Clean Up &&nbsp;\u00a0Catch   Up ')).toBe('Clean Up & Catch Up');
  });

  it('does not split — a pipe or dot inside a single name stays', () => {
    expect(normalizeName('A | B · C')).toBe('A | B · C');
  });
});

describe('nameKey', () => {
  it('compares names case-insensitively', () => {
    expect(nameKey('Payroll')).toBe(nameKey('PAYROLL'));
  });
});

describe('import schemas', () => {
  it('caps a raw import name at 1000 characters', () => {
    expect(ImportNameSchema.safeParse('x'.repeat(1000)).success).toBe(true);
    expect(ImportNameSchema.safeParse('x'.repeat(1001)).success).toBe(false);
  });

  it('exposes the 200-character single-name limit', () => {
    expect(NAME_MAX_LENGTH).toBe(200);
  });

  it('parses a skip row', () => {
    expect(NameSkipSchema.parse({ name: 'A', reason: 'Duplicate in list' })).toEqual({
      name: 'A',
      reason: 'Duplicate in list',
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @timetrack/contracts test -- name-list`
Expected: FAIL, because `./name-list.js` cannot be resolved.

- [ ] **Step 3: Implement `name-list.ts`**

Create `packages/contracts/src/name-list.ts`:

```ts
import { z } from 'zod';

/** The longest single client or work-type name (matches CreateProjectSchema's 200). */
export const NAME_MAX_LENGTH = 200;

/**
 * One raw name as it arrives in a bulk request. Bounded so a runaway paste cannot balloon the
 * payload, but deliberately looser than NAME_MAX_LENGTH: an over-long line is reported back as a
 * skip with a reason instead of 422-ing the other 97 names (plan ruling R4).
 */
export const ImportNameSchema = z.string().max(1000);

/** A name a bulk import did not create, and why. */
export const NameSkipSchema = z.object({ name: z.string(), reason: z.string() });
export type NameSkip = z.infer<typeof NameSkipSchema>;

// Only the entities the spec names; anything else is left verbatim (plan ruling R3).
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
};
const ENTITY = /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi;

// Table columns: tab, ASCII pipe, and the box-drawing vertical │ — exactly the spec's (R18).
const COLUMN_SEPARATOR = /[\t|\u2502]/;
// A middle dot standing alone: whitespace or a line edge on both sides (plan ruling R1).
const MIDDLE_DOT_SEPARATOR = /(?:^|\s)\u00b7(?=\s|$)/;
// A run made only of box-drawing characters, whitespace or dashes (also matches the empty string).
const BORDER_ONLY = /^[\u2500-\u257f\s\-\u2013\u2014]*$/;

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole: string, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith('#')) {
      const code = key.startsWith('#x')
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[key] ?? whole;
  });
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The case-insensitive comparison key for a client or work-type name. */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

/** One name, cleaned: entities decoded, NBSP as space, whitespace collapsed, trimmed. Never splits. */
export function normalizeName(raw: string): string {
  return collapse(decodeEntities(raw).replace(/\u00a0/g, ' '));
}

/**
 * Turn a pasted list into names (spec §7). Shared by the dashboard preview and the import it
 * submits. Splits on newlines, tabs, table columns and a standalone `·`; drops border runs;
 * de-duplicates case-insensitively keeping the first spelling. Never splits on "/" or ",".
 */
export function parseNameList(text: string): string[] {
  const decoded = decodeEntities(text).replace(/\u00a0/g, ' ');
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of decoded.split(/\r\n|\r|\n/)) {
    for (const cell of line.split(COLUMN_SEPARATOR)) {
      for (const piece of cell.split(MIDDLE_DOT_SEPARATOR)) {
        if (BORDER_ONLY.test(piece)) continue;
        const name = collapse(piece);
        const key = nameKey(name);
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }
    }
  }
  return names;
}
```

- [ ] **Step 4: Run the parser tests and confirm they pass**

Run: `pnpm --filter @timetrack/contracts test -- name-list`
Expected: PASS, all tests in `name-list.spec.ts`. The fixture test was checked against a prototype of this exact code, and it yields the 28 names listed.

- [ ] **Step 5: Write the failing work-type and bulk-project schema tests**

Create `packages/contracts/src/work-types.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ZodObject } from 'zod';
import {
  BulkCreateWorkTypesResultSchema,
  BulkCreateWorkTypesSchema,
  ReconcileCountsSchema,
  SetTeamWorkTypesSchema,
  TeamWorkTypesSchema,
  UpdateWorkTypeSchema,
  WorkTypeListSchema,
  WorkTypeSchema,
} from './work-types.js';

const WT = '018f9c1e-0000-7000-8000-000000000001';
const TEAM = '018f9c1e-0000-7000-8000-0000000000c1';

describe('WorkTypeSchema / WorkTypeListSchema', () => {
  it('parses a catalog row with its team ids', () => {
    const row = { id: WT, name: 'Payroll', archived: false, teamIds: [TEAM] };
    expect(WorkTypeListSchema.parse([row])).toEqual([row]);
    expect(WorkTypeSchema.parse({ id: WT, name: 'Payroll', archived: true })).toEqual({
      id: WT,
      name: 'Payroll',
      archived: true,
    });
  });
});

describe('BulkCreateWorkTypesSchema', () => {
  it('accepts 1–100 names and rejects 0 or 101', () => {
    expect(BulkCreateWorkTypesSchema.safeParse({ names: ['A'] }).success).toBe(true);
    expect(BulkCreateWorkTypesSchema.safeParse({ names: [] }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => `N${i}`);
    expect(BulkCreateWorkTypesSchema.safeParse({ names: many }).success).toBe(false);
  });

  it('parses the result shape', () => {
    const value = {
      created: [{ id: WT, name: 'Payroll', archived: false }],
      skipped: [{ name: 'General', reason: 'Reserved name' }],
    };
    expect(BulkCreateWorkTypesResultSchema.parse(value)).toEqual(value);
  });
});

describe('UpdateWorkTypeSchema', () => {
  it('accepts a name, an archived flag, or both', () => {
    expect(UpdateWorkTypeSchema.safeParse({ name: 'Payroll' }).success).toBe(true);
    expect(UpdateWorkTypeSchema.safeParse({ archived: true }).success).toBe(true);
    expect(UpdateWorkTypeSchema.safeParse({ name: 'X', archived: false }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(UpdateWorkTypeSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty or over-long name', () => {
    expect(UpdateWorkTypeSchema.safeParse({ name: '' }).success).toBe(false);
    expect(UpdateWorkTypeSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('stays a ZodObject so the pipe can apply strict mode (.check, not .refine)', () => {
    expect(UpdateWorkTypeSchema).toBeInstanceOf(ZodObject);
    expect(UpdateWorkTypeSchema.strict().safeParse({ name: 'X', extra: 1 }).success).toBe(false);
  });
});

describe('SetTeamWorkTypesSchema / TeamWorkTypesSchema', () => {
  it('accepts an empty set (clear the team) and up to 100 uuids', () => {
    expect(SetTeamWorkTypesSchema.safeParse({ workTypeIds: [] }).success).toBe(true);
    expect(SetTeamWorkTypesSchema.safeParse({ workTypeIds: [WT] }).success).toBe(true);
  });

  it('rejects a non-uuid and more than 100 ids', () => {
    expect(SetTeamWorkTypesSchema.safeParse({ workTypeIds: ['nope'] }).success).toBe(false);
    const many = Array.from({ length: 101 }, () => WT);
    expect(SetTeamWorkTypesSchema.safeParse({ workTypeIds: many }).success).toBe(false);
  });

  it('parses the PUT response', () => {
    expect(TeamWorkTypesSchema.parse({ teamId: TEAM, workTypeIds: [WT] })).toEqual({
      teamId: TEAM,
      workTypeIds: [WT],
    });
  });
});

describe('ReconcileCountsSchema', () => {
  it('parses non-negative integer counts and rejects negatives', () => {
    const zero = { projects: 0, created: 0, linked: 0, restored: 0, renamed: 0, archived: 0 };
    expect(ReconcileCountsSchema.parse(zero)).toEqual(zero);
    expect(ReconcileCountsSchema.safeParse({ ...zero, created: -1 }).success).toBe(false);
  });
});
```

Append to `packages/contracts/src/projects.spec.ts` (add the two imports to the existing import list from `./projects.js`):

```ts
describe('BulkCreateProjectsSchema', () => {
  const TEAM = '018f9c1e-0000-7000-8000-0000000000c1';

  it('accepts 1–500 names for a team', () => {
    expect(BulkCreateProjectsSchema.safeParse({ teamId: TEAM, names: ['Acme'] }).success).toBe(
      true,
    );
    const max = Array.from({ length: 500 }, (_, i) => `C${i}`);
    expect(BulkCreateProjectsSchema.safeParse({ teamId: TEAM, names: max }).success).toBe(true);
  });

  it('rejects no names, 501 names, and a non-uuid team', () => {
    expect(BulkCreateProjectsSchema.safeParse({ teamId: TEAM, names: [] }).success).toBe(false);
    const over = Array.from({ length: 501 }, (_, i) => `C${i}`);
    expect(BulkCreateProjectsSchema.safeParse({ teamId: TEAM, names: over }).success).toBe(false);
    expect(BulkCreateProjectsSchema.safeParse({ teamId: 'x', names: ['A'] }).success).toBe(false);
  });

  it('parses the result with created projects and skips', () => {
    const value = {
      created: [
        {
          id: '018f9c1e-0000-7000-8000-000000000001',
          teamId: TEAM,
          name: 'Acme',
          color: '#007aff',
          archived: false,
        },
      ],
      skipped: [{ name: 'acme', reason: 'Duplicate in list' }],
    };
    expect(BulkCreateProjectsResultSchema.parse(value)).toEqual(value);
  });
});
```

- [ ] **Step 6: Run the tests and confirm they fail**

Run: `pnpm --filter @timetrack/contracts test -- work-types projects`
Expected: FAIL. `./work-types.js` cannot be resolved, and `BulkCreateProjectsSchema` is undefined.

- [ ] **Step 7: Implement `work-types.ts`, the project bulk schemas and the exports**

Create `packages/contracts/src/work-types.ts`:

```ts
import { z } from 'zod';
import { ImportNameSchema, NAME_MAX_LENGTH, NameSkipSchema } from './name-list.js';

/** A catalog entry: one kind of work (spec §4). "General" is reserved and never one of these. */
export const WorkTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
});

/** GET /v1/work-types row. `teamIds` includes teams whose selection of an ARCHIVED type is kept. */
export const WorkTypeWithTeamsSchema = WorkTypeSchema.extend({
  teamIds: z.array(z.uuid()),
});
export const WorkTypeListSchema = z.array(WorkTypeWithTeamsSchema);

/** POST /v1/work-types/bulk — raw names; the API normalizes each and reports skips. */
export const BulkCreateWorkTypesSchema = z.object({
  names: z.array(ImportNameSchema).min(1).max(100),
});
export const BulkCreateWorkTypesResultSchema = z.object({
  created: z.array(WorkTypeSchema),
  skipped: z.array(NameSkipSchema),
});

/**
 * PATCH /v1/work-types/:id — rename and/or archive/restore. `.check()` not `.refine()`, so the
 * pipe keeps strict mode; no `.default()` anywhere (Zod 4 optional keys would inject it).
 */
export const UpdateWorkTypeSchema = z
  .object({
    name: z.string().min(1).max(NAME_MAX_LENGTH).optional(),
    archived: z.boolean().optional(),
  })
  .check((ctx) => {
    if (ctx.value.name === undefined && ctx.value.archived === undefined) {
      ctx.issues.push({ code: 'custom', message: 'Nothing to update', input: ctx.value, path: [] });
    }
  });

/**
 * PUT /v1/work-types/teams/:teamId — the team's full set of NON-archived work types. Links to
 * archived work types are preserved server-side (plan ruling R5).
 */
export const SetTeamWorkTypesSchema = z.object({
  workTypeIds: z.array(z.uuid()).max(100),
});
/** The stored selection after a PUT, archived links included. */
export const TeamWorkTypesSchema = z.object({
  teamId: z.uuid(),
  workTypeIds: z.array(z.uuid()),
});

const Count = z.number().int().nonnegative();
/** What a reconcile (or POST /v1/work-types/resync) changed. */
export const ReconcileCountsSchema = z.object({
  projects: Count,
  created: Count,
  linked: Count,
  restored: Count,
  renamed: Count,
  archived: Count,
});

export type WorkType = z.infer<typeof WorkTypeSchema>;
export type WorkTypeWithTeams = z.infer<typeof WorkTypeWithTeamsSchema>;
export type BulkCreateWorkTypes = z.infer<typeof BulkCreateWorkTypesSchema>;
export type BulkCreateWorkTypesResult = z.infer<typeof BulkCreateWorkTypesResultSchema>;
export type UpdateWorkType = z.infer<typeof UpdateWorkTypeSchema>;
export type SetTeamWorkTypes = z.infer<typeof SetTeamWorkTypesSchema>;
export type TeamWorkTypes = z.infer<typeof TeamWorkTypesSchema>;
export type ReconcileCounts = z.infer<typeof ReconcileCountsSchema>;
```

In `packages/contracts/src/projects.ts`, add `import { ImportNameSchema, NameSkipSchema } from './name-list.js';` below the `zod` import. Insert this directly after `CreateProjectSchema`:

```ts
/**
 * POST /v1/projects/bulk (ADMIN) — import clients into one team. Raw names: the API normalizes
 * each and skips org-wide duplicates (`Already exists in <team>`) and in-list repeats.
 */
export const BulkCreateProjectsSchema = z.object({
  teamId: z.uuid(),
  names: z.array(ImportNameSchema).min(1).max(500),
});
export const BulkCreateProjectsResultSchema = z.object({
  created: z.array(ProjectSchema),
  skipped: z.array(NameSkipSchema),
});
```

Then add these types at the bottom:

```ts
export type BulkCreateProjects = z.infer<typeof BulkCreateProjectsSchema>;
export type BulkCreateProjectsResult = z.infer<typeof BulkCreateProjectsResultSchema>;
```

In `packages/contracts/src/index.ts`, add after `export * from './clients.js';`:

```ts
export * from './name-list.js';
export * from './work-types.js';
```

- [ ] **Step 8: Run the tests, typecheck, coverage and build**

Run: `pnpm --filter @timetrack/contracts test && pnpm --filter @timetrack/contracts typecheck && pnpm --filter @timetrack/contracts test:coverage && pnpm --filter @timetrack/contracts build`
Expected: all PASS, and the coverage summary shows branches ≥ 80%. If branches dip, the gap is in `name-list.ts`: add a test for whichever `?:` or `??` arm the report names, and do not lower the threshold.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/name-list.ts packages/contracts/src/name-list.spec.ts \
  packages/contracts/src/work-types.ts packages/contracts/src/work-types.spec.ts \
  packages/contracts/src/projects.ts packages/contracts/src/projects.spec.ts \
  packages/contracts/src/index.ts
git commit -m "feat(contracts): add work type schemas with a pasted-name parser"
```

---

### Task 2: Database — work types, team selections, linked subprojects

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (the `Team` and `Subproject` models; add two models after `Subproject`)
- Create: `packages/db/prisma/migrations/20260930120000_add_work_types/migration.sql`
- Create: `apps/api/test/work-types.e2e-spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - Prisma delegates `workType` and `teamWorkType`.
  - `Subproject.workTypeId: string | null` and the relation `Subproject.workType`.
  - The relations `WorkType.teams`, `WorkType.subprojects` and `Team.workTypes`.
  - DB index `work_types_name_ci_unique`, a unique index on `lower(name)`.
  - DB index `subprojects_one_per_work_type`, a unique index on `("projectId","workTypeId") WHERE "workTypeId" IS NOT NULL`.

- [ ] **Step 1: Write the failing schema e2e**

Create `apps/api/test/work-types.e2e-spec.ts`:

```ts
import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/** The two raw-SQL indexes Prisma cannot model or diff (spec §4). */
describe.runIf(RUN_E2E)('work types — schema', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  async function seedProject() {
    const team = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    return db.prisma.project.create({
      data: { teamId: team.id, name: 'Acme' },
      select: { id: true, teamId: true },
    });
  }

  it('refuses a second catalog name that differs only by case', async () => {
    await db.prisma.workType.create({ data: { name: 'Payroll' } });
    await expect(db.prisma.workType.create({ data: { name: 'PAYROLL' } })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('refuses a second subproject for the same work type on one project', async () => {
    const p = await seedProject();
    const wt = await db.prisma.workType.create({ data: { name: 'Payroll' }, select: { id: true } });
    await db.prisma.subproject.create({
      data: { projectId: p.id, name: 'Payroll', workTypeId: wt.id },
    });
    await expect(
      db.prisma.subproject.create({
        data: { projectId: p.id, name: 'Payroll again', workTypeId: wt.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows any number of unlinked subprojects on one project', async () => {
    const p = await seedProject();
    await db.prisma.subproject.createMany({
      data: [
        { projectId: p.id, name: 'A' },
        { projectId: p.id, name: 'B' },
      ],
    });
    await expect(
      db.prisma.subproject.count({ where: { projectId: p.id, workTypeId: null } }),
    ).resolves.toBe(2);
  });

  it('keys a team selection on (teamId, workTypeId)', async () => {
    const p = await seedProject();
    const wt = await db.prisma.workType.create({ data: { name: 'Payroll' }, select: { id: true } });
    await db.prisma.teamWorkType.create({ data: { teamId: p.teamId, workTypeId: wt.id } });
    await expect(
      db.prisma.teamWorkType.create({ data: { teamId: p.teamId, workTypeId: wt.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('work types e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
```

- [ ] **Step 2: Confirm it fails**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- work-types`
Expected: FAIL. `TypeError: Cannot read properties of undefined (reading 'create')`, because the generated client has no `workType` delegate yet. `test/` is not typechecked, so the failure shows at runtime.

- [ ] **Step 3: Edit `schema.prisma`**

Add `workTypes TeamWorkType[]` to `model Team`, after the `invites  Invite[]` line:

```prisma
  invites   Invite[]
  workTypes TeamWorkType[]
```

In `model Subproject`, add the column and relation. Also extend its doc comment:

```prisma
/// Exactly one `isDefault` subproject ("General") per project, enforced by the raw-SQL partial
/// unique index `subprojects_one_default_per_project` (see migrations). A partial index is
/// invisible to Prisma's diff, so there is no PSL @@unique here.
/// `workTypeId` links a row to the work-type catalog; the raw-SQL partial unique index
/// `subprojects_one_per_work_type` allows at most one linked row per (project, work type).
model Subproject {
  id         String    @id @default(uuid(7))
  projectId  String
  name       String
  archived   Boolean   @default(false)
  isDefault  Boolean   @default(false)
  workTypeId String?
  project    Project   @relation(fields: [projectId], references: [id])
  workType   WorkType? @relation(fields: [workTypeId], references: [id])
  tasks      Task[]

  @@index([projectId, archived])
  @@map("subprojects")
}

/// The global catalog of kinds of work (spec 2026-09-29). Names are unique case-insensitively via
/// the raw-SQL expression index `work_types_name_ci_unique` — invisible to Prisma's diff.
model WorkType {
  id          String         @id @default(uuid(7))
  name        String
  archived    Boolean        @default(false)
  teams       TeamWorkType[]
  subprojects Subproject[]

  @@map("work_types")
}

/// Which work types a team does. Every project of the team carries one linked subproject per
/// selected, non-archived work type (kept in step by WorkTypesRepository.reconcile).
model TeamWorkType {
  teamId     String
  workTypeId String
  team       Team     @relation(fields: [teamId], references: [id])
  workType   WorkType @relation(fields: [workTypeId], references: [id])

  @@id([teamId, workTypeId])
  @@map("team_work_types")
}
```

- [ ] **Step 4: Hand-author the migration**

Create `packages/db/prisma/migrations/20260930120000_add_work_types/migration.sql`. The DDL above the raw-index section is exactly what `prisma migrate dev` would emit for the PSL, including constraint names and FK actions. Keep it that way, so a later `migrate dev` reports no drift.

```sql
-- AlterTable
ALTER TABLE "subprojects" ADD COLUMN     "workTypeId" TEXT;

-- CreateTable
CREATE TABLE "work_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "work_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_work_types" (
    "teamId" TEXT NOT NULL,
    "workTypeId" TEXT NOT NULL,

    CONSTRAINT "team_work_types_pkey" PRIMARY KEY ("teamId","workTypeId")
);

-- AddForeignKey
ALTER TABLE "subprojects" ADD CONSTRAINT "subprojects_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_work_types" ADD CONSTRAINT "team_work_types_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_work_types" ADD CONSTRAINT "team_work_types_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Catalog names are unique regardless of case. Expression index: not expressible in
-- schema.prisma and invisible to Prisma's diff (same as subprojects_one_default_per_project).
CREATE UNIQUE INDEX "work_types_name_ci_unique" ON "work_types" (lower("name"));

-- A project never carries the same work type twice. Partial: General and hand-made subprojects
-- (workTypeId NULL) are unconstrained. Also invisible to Prisma's diff.
CREATE UNIQUE INDEX "subprojects_one_per_work_type"
  ON "subprojects" ("projectId", "workTypeId")
  WHERE "workTypeId" IS NOT NULL;
```

- [ ] **Step 5: Apply the migration locally and regenerate the client**

Run: `pnpm infra:up && pnpm db:deploy && pnpm --filter @timetrack/db build`
Expected: `prisma migrate deploy` reports `Applying migration 20260930120000_add_work_types` and "All migrations have been successfully applied". The db build then generates the client and compiles with no errors. Do **not** run `prisma migrate diff` (see Global Constraints).

- [ ] **Step 6: Run the e2e and typecheck, and confirm both pass**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- work-types && pnpm --filter @timetrack/api typecheck`
Expected: PASS, with 4 tests in `work types — schema` plus the harness test. The global setup's `prisma migrate deploy` ran the new SQL on a fresh Postgres 18.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma \
  packages/db/prisma/migrations/20260930120000_add_work_types/migration.sql \
  apps/api/test/work-types.e2e-spec.ts
git commit -m "feat(db): add work type catalog tables"
```

---

### Task 3: Reconcile — the pure planner and `WorkTypesRepository.reconcile`

**Files:**

- Create: `apps/api/src/modules/work-types/work-types.reconcile.ts`
- Create: `apps/api/src/modules/work-types/work-types.reconcile.spec.ts`
- Create: `apps/api/src/modules/work-types/work-types.repository.ts`
- Modify: `apps/api/test/work-types.e2e-spec.ts` (add a second top-level describe before the harness describe)

**Interfaces:**

- Consumes:
  - `nameKey` and `ReconcileCounts` from `@timetrack/contracts` (Task 1).
  - The Prisma `workType`, `teamWorkType` and `Subproject.workTypeId` (Task 2).
- Produces:
  - `ReconcileTrigger` and `ReconcileAudit`, exactly as in Shared types.
  - `ReconcilePlan`, `planReconcile(projects, desiredByTeam, subprojects): ReconcilePlan`, and `groupRenames(renames): Map<string, string[]>`.
  - `RECONCILE_TX = { timeout: 60_000, maxWait: 10_000 } as const`.
  - `isUniqueViolation(e: unknown): boolean`.
  - `catalogConflict(title: string): ConflictException`.
  - `CONCURRENT_CHANGE = 'The catalog changed while saving. Try again.'`.
  - `class WorkTypesRepository { constructor(@Inject(PrismaService) prisma); reconcile(tx: Prisma.TransactionClient, projectIds: readonly string[], audit: ReconcileAudit): Promise<ReconcileCounts> }`.

- [ ] **Step 1: Write the failing planner unit tests**

Create `apps/api/src/modules/work-types/work-types.reconcile.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  groupRenames,
  planReconcile,
  type DesiredWorkType,
  type ExistingSubproject,
} from './work-types.reconcile.js';

const P1 = { id: 'p1', teamId: 't1' };
const PAYROLL: DesiredWorkType = { id: 'w1', name: 'Payroll' };
const AUDIT: DesiredWorkType = { id: 'w2', name: 'Audit Assist' };

const sub = (over: Partial<ExistingSubproject> & { id: string }): ExistingSubproject => ({
  projectId: 'p1',
  name: 'X',
  archived: false,
  isDefault: false,
  workTypeId: null,
  ...over,
});

const desired = (...wts: DesiredWorkType[]) => new Map([['t1', wts]]);

describe('planReconcile', () => {
  it('creates one row per desired work type that has no row at all', () => {
    const plan = planReconcile([P1], desired(PAYROLL, AUDIT), []);
    expect(plan.create).toEqual([
      { projectId: 'p1', workTypeId: 'w1', name: 'Payroll' },
      { projectId: 'p1', workTypeId: 'w2', name: 'Audit Assist' },
    ]);
    expect(plan.link).toEqual([]);
    expect(plan.archive).toEqual([]);
  });

  it('restores and renames an existing linked row instead of creating one', () => {
    const plan = planReconcile([P1], desired(PAYROLL), [
      sub({ id: 's1', name: 'payroll (old)', archived: true, workTypeId: 'w1' }),
    ]);
    expect(plan.create).toEqual([]);
    expect(plan.restore).toEqual(['s1']);
    expect(plan.rename).toEqual([{ id: 's1', name: 'Payroll' }]);
  });

  it('leaves an up-to-date linked row alone', () => {
    const plan = planReconcile([P1], desired(PAYROLL), [
      sub({ id: 's1', name: 'Payroll', workTypeId: 'w1' }),
    ]);
    expect(plan).toEqual({ create: [], link: [], restore: [], rename: [], archive: [] });
  });

  it('adopts an unlinked same-name row case-insensitively', () => {
    const plan = planReconcile([P1], desired(PAYROLL), [sub({ id: 's1', name: 'PAYROLL' })]);
    expect(plan.link).toEqual([{ id: 's1', workTypeId: 'w1', name: 'Payroll' }]);
    expect(plan.create).toEqual([]);
  });

  it('prefers a non-archived adoption candidate (ruling R7)', () => {
    const plan = planReconcile([P1], desired(PAYROLL), [
      sub({ id: 's1', name: 'Payroll', archived: true }),
      sub({ id: 's2', name: 'payroll' }),
    ]);
    expect(plan.link).toEqual([{ id: 's2', workTypeId: 'w1', name: 'Payroll' }]);
  });

  it('never adopts the General default', () => {
    const general: DesiredWorkType = { id: 'w9', name: 'General' };
    const plan = planReconcile([P1], desired(general), [
      sub({ id: 's0', name: 'General', isDefault: true }),
    ]);
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([{ projectId: 'p1', workTypeId: 'w9', name: 'General' }]);
  });

  it('archives a linked row that is no longer desired, but not one already archived', () => {
    const plan = planReconcile([P1], desired(), [
      sub({ id: 's1', name: 'Payroll', workTypeId: 'w1' }),
      sub({ id: 's2', name: 'Audit Assist', workTypeId: 'w2', archived: true }),
    ]);
    expect(plan.archive).toEqual(['s1']);
  });

  it('treats a project whose team has no selection as wanting nothing', () => {
    const plan = planReconcile([{ id: 'p2', teamId: 'other' }], desired(PAYROLL), [
      sub({ id: 's1', projectId: 'p2', name: 'Payroll', workTypeId: 'w1' }),
    ]);
    expect(plan.archive).toEqual(['s1']);
    expect(plan.create).toEqual([]);
  });

  it('keeps projects apart: a row on one project never satisfies another', () => {
    const plan = planReconcile([P1, { id: 'p2', teamId: 't1' }], desired(PAYROLL), [
      sub({ id: 's1', projectId: 'p1', name: 'Payroll', workTypeId: 'w1' }),
    ]);
    expect(plan.create).toEqual([{ projectId: 'p2', workTypeId: 'w1', name: 'Payroll' }]);
  });
});

describe('groupRenames', () => {
  it('batches row ids by their new name', () => {
    const groups = groupRenames([
      { id: 'a', name: 'Payroll' },
      { id: 'b', name: 'Payroll' },
      { id: 'c', name: 'Audit' },
    ]);
    expect([...groups.entries()]).toEqual([
      ['Payroll', ['a', 'b']],
      ['Audit', ['c']],
    ]);
  });
});
```

- [ ] **Step 2: Confirm it fails**

Run: `pnpm --filter @timetrack/api test -- work-types.reconcile`
Expected: FAIL, because `./work-types.reconcile.js` cannot be resolved.

- [ ] **Step 3: Implement the planner**

Create `apps/api/src/modules/work-types/work-types.reconcile.ts`:

```ts
import { nameKey } from '@timetrack/contracts';

/**
 * The pure half of reconcile (spec §5): given the projects, each team's desired (selected,
 * non-archived) work types and the projects' current non-default subprojects, decide what to
 * create, link, restore, rename and archive. No Prisma here — WorkTypesRepository.reconcile loads
 * the inputs and applies the plan inside the caller's transaction.
 */
export type ReconcileTrigger =
  | 'team_selection'
  | 'work_type_update'
  | 'project_create'
  | 'project_bulk_create'
  | 'project_team_change'
  | 'resync';

export type ReconcileAudit = {
  actorId: string;
  trigger: ReconcileTrigger;
  targetType: 'team' | 'work_type' | 'project';
  targetId: string;
};

export type ReconcileProject = { id: string; teamId: string };
export type DesiredWorkType = { id: string; name: string };
export type ExistingSubproject = {
  id: string;
  projectId: string;
  name: string;
  archived: boolean;
  isDefault: boolean;
  workTypeId: string | null;
};

export type ReconcilePlan = {
  create: { projectId: string; workTypeId: string; name: string }[];
  /** Adopt a hand-made row: set workTypeId, catalog spelling, unarchive. */
  link: { id: string; workTypeId: string; name: string }[];
  restore: string[];
  rename: { id: string; name: string }[];
  archive: string[];
};

export function planReconcile(
  projects: readonly ReconcileProject[],
  desiredByTeam: ReadonlyMap<string, readonly DesiredWorkType[]>,
  subprojects: readonly ExistingSubproject[],
): ReconcilePlan {
  const plan: ReconcilePlan = { create: [], link: [], restore: [], rename: [], archive: [] };

  const byProject = new Map<string, ExistingSubproject[]>();
  for (const s of subprojects) {
    const list = byProject.get(s.projectId);
    if (list) list.push(s);
    else byProject.set(s.projectId, [s]);
  }

  for (const project of projects) {
    const rows = byProject.get(project.id) ?? [];
    const desired = desiredByTeam.get(project.teamId) ?? [];
    const desiredIds = new Set(desired.map((w) => w.id));
    // At most one linked row per work type (partial unique index subprojects_one_per_work_type).
    const linked = new Map<string, ExistingSubproject>();
    for (const row of rows) if (row.workTypeId !== null) linked.set(row.workTypeId, row);

    for (const wt of desired) {
      const row = linked.get(wt.id);
      if (row) {
        // Rule 1: same row id, so the time history stays attached.
        if (row.archived) plan.restore.push(row.id);
        if (row.name !== wt.name) plan.rename.push({ id: row.id, name: wt.name });
        continue;
      }
      // Rule 2: adopt a hand-made row of the same name rather than duplicating it.
      const adoptee = findAdoptee(rows, wt.name);
      if (adoptee) {
        plan.link.push({ id: adoptee.id, workTypeId: wt.id, name: wt.name });
        continue;
      }
      // Rule 3.
      plan.create.push({ projectId: project.id, workTypeId: wt.id, name: wt.name });
    }

    // Rule 4: archive, never delete — reports keep the history.
    for (const [workTypeId, row] of linked) {
      if (!desiredIds.has(workTypeId) && !row.archived) plan.archive.push(row.id);
    }
  }
  return plan;
}

/** Ruling R7: an unlinked, non-default row of the same name; non-archived first, then oldest. */
function findAdoptee(
  rows: readonly ExistingSubproject[],
  name: string,
): ExistingSubproject | undefined {
  const key = nameKey(name);
  const candidates = rows
    .filter((r) => r.workTypeId === null && !r.isDefault && nameKey(r.name) === key)
    .sort((a, b) => a.id.localeCompare(b.id));
  return candidates.find((r) => !r.archived) ?? candidates[0];
}

/** Group renames by their new name, so each distinct name is one updateMany. */
export function groupRenames(
  renames: readonly { id: string; name: string }[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const r of renames) {
    const ids = groups.get(r.name);
    if (ids) ids.push(r.id);
    else groups.set(r.name, [r.id]);
  }
  return groups;
}
```

- [ ] **Step 4: Run the planner tests and confirm they pass**

Run: `pnpm --filter @timetrack/api test -- work-types.reconcile`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing reconcile e2e**

In `apps/api/test/work-types.e2e-spec.ts`, add these imports at the top, below the existing ones:

```ts
import {
  WorkTypesRepository,
  RECONCILE_TX,
} from '../src/modules/work-types/work-types.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
```

Then add this describe **before** the `work types e2e harness` describe:

```ts
describe.runIf(RUN_E2E)('work types — reconcile', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  const ACTOR = '01920000-0000-7000-8000-0000000000a1';
  const repo = () => new WorkTypesRepository(db.prisma as unknown as PrismaService);

  async function team(name: string): Promise<string> {
    const t = await db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
    return t.id;
  }
  /** A project as old code made it: the project and its General default, nothing else. */
  async function project(teamId: string, name: string): Promise<string> {
    const p = await db.prisma.project.create({ data: { teamId, name }, select: { id: true } });
    await db.prisma.subproject.create({
      data: { projectId: p.id, name: 'General', isDefault: true },
    });
    return p.id;
  }
  async function workType(name: string): Promise<string> {
    const w = await db.prisma.workType.create({ data: { name }, select: { id: true } });
    return w.id;
  }
  async function enable(teamId: string, ...workTypeIds: string[]): Promise<void> {
    await db.prisma.teamWorkType.createMany({
      data: workTypeIds.map((workTypeId) => ({ teamId, workTypeId })),
    });
  }
  function reconcile(projectIds: string[]) {
    return db.prisma.$transaction(
      (tx) =>
        repo().reconcile(tx, projectIds, {
          actorId: ACTOR,
          trigger: 'resync',
          targetType: 'work_type',
          targetId: 'all',
        }),
      RECONCILE_TX,
    );
  }
  function subs(projectId: string) {
    return db.prisma.subproject.findMany({
      where: { projectId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, archived: true, isDefault: true, workTypeId: true },
    });
  }
  const ZERO = { created: 0, linked: 0, restored: 0, renamed: 0, archived: 0 };

  it("enabling a work type creates a row on every one of the team's projects", async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const b = await project(eng, 'Globex');
    const payroll = await workType('Payroll');
    const audit = await workType('Audit Assist');
    await enable(eng, payroll, audit);

    await expect(reconcile([a, b])).resolves.toEqual({ ...ZERO, projects: 2, created: 4 });
    for (const id of [a, b]) {
      const rows = await subs(id);
      expect(rows.map((r) => [r.name, r.workTypeId])).toEqual([
        ['General', null],
        ['Audit Assist', audit],
        ['Payroll', payroll],
      ]);
    }
  });

  it("leaves another team's projects alone", async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    const a = await project(eng, 'Acme');
    const c = await project(support, 'Initech');
    await enable(eng, await workType('Payroll'));

    await expect(reconcile([a, c])).resolves.toEqual({ ...ZERO, projects: 2, created: 1 });
    expect((await subs(c)).map((r) => r.name)).toEqual(['General']);
  });

  it('disabling archives the rows and never deletes them', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const payroll = await workType('Payroll');
    await enable(eng, payroll);
    await reconcile([a]);

    await db.prisma.teamWorkType.deleteMany({ where: { teamId: eng } });
    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, archived: 1 });
    const row = (await subs(a)).find((r) => r.workTypeId === payroll);
    expect(row?.archived).toBe(true);
  });

  it('re-enabling restores the same row id', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const payroll = await workType('Payroll');
    await enable(eng, payroll);
    await reconcile([a]);
    const first = (await subs(a)).find((r) => r.workTypeId === payroll);

    await db.prisma.teamWorkType.deleteMany({ where: { teamId: eng } });
    await reconcile([a]);
    await enable(eng, payroll);
    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, restored: 1 });

    const again = (await subs(a)).find((r) => r.workTypeId === payroll);
    expect(again?.id).toBe(first?.id);
    expect(again?.archived).toBe(false);
  });

  it('renaming a work type renames its linked rows in place', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const vat = await workType('VAT Filling');
    await enable(eng, vat);
    await reconcile([a]);
    const before = (await subs(a)).find((r) => r.workTypeId === vat);

    await db.prisma.workType.update({ where: { id: vat }, data: { name: 'VAT/TAX Filling' } });
    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, renamed: 1 });
    const after = (await subs(a)).find((r) => r.workTypeId === vat);
    expect(after).toMatchObject({ id: before?.id, name: 'VAT/TAX Filling' });
  });

  it('archiving a work type archives its rows', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const payroll = await workType('Payroll');
    await enable(eng, payroll);
    await reconcile([a]);

    await db.prisma.workType.update({ where: { id: payroll }, data: { archived: true } });
    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, archived: 1 });
  });

  it('adopts a hand-made same-name row, even an archived one, instead of duplicating', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const handMade = await db.prisma.subproject.create({
      data: { projectId: a, name: 'payroll', archived: true },
      select: { id: true },
    });
    const payroll = await workType('Payroll');
    await enable(eng, payroll);

    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1, linked: 1 });
    const rows = await subs(a);
    expect(rows.filter((r) => r.name.toLowerCase() === 'payroll')).toEqual([
      { id: handMade.id, name: 'Payroll', archived: false, isDefault: false, workTypeId: payroll },
    ]);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    await enable(eng, await workType('Payroll'), await workType('AdHoc'));
    await reconcile([a]);

    await expect(reconcile([a])).resolves.toEqual({ ...ZERO, projects: 1 });
  });

  it('writes exactly one work_type.reconcile audit row per call, even a no-op', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    await enable(eng, await workType('Payroll'));
    await reconcile([a]);
    await reconcile([a]);

    const rows = await db.prisma.auditLog.findMany({
      where: { action: 'work_type.reconcile' },
      orderBy: { timestamp: 'asc' },
      select: { actorId: true, targetType: true, targetId: true, diff: true },
    });
    expect(rows).toEqual([
      {
        actorId: ACTOR,
        targetType: 'work_type',
        targetId: 'all',
        diff: { trigger: 'resync', projects: 1, ...ZERO, created: 1 },
      },
      {
        actorId: ACTOR,
        targetType: 'work_type',
        targetId: 'all',
        diff: { trigger: 'resync', projects: 1, ...ZERO },
      },
    ]);
  });

  it('accepts an empty project list', async () => {
    await expect(reconcile([])).resolves.toEqual({ ...ZERO, projects: 0 });
  });
});
```

- [ ] **Step 6: Confirm it fails**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- work-types`
Expected: FAIL, because the import of `../src/modules/work-types/work-types.repository.js` cannot be resolved.

- [ ] **Step 7: Implement the repository's reconcile**

Create `apps/api/src/modules/work-types/work-types.repository.ts`:

```ts
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import type { ReconcileCounts } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  groupRenames,
  planReconcile,
  type DesiredWorkType,
  type ReconcileAudit,
} from './work-types.reconcile.js';

/**
 * Transaction options for anything that reconciles many projects. Prisma's interactive
 * transaction defaults to 5s, which a whole-org re-sync (≈100 clients × 12 work types) or a
 * 500-client import can exceed — it then P2028-rolls-back while every small-seed test passes.
 */
export const RECONCILE_TX = { timeout: 60_000, maxWait: 10_000 } as const;

export const CONCURRENT_CHANGE = 'The catalog changed while saving. Try again.';

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export function catalogConflict(title: string): ConflictException {
  return new ConflictException({
    type: 'https://timetrack.internal/errors/conflict',
    title,
    status: 409,
  });
}

/** CLAUDE.md §3 — Prisma lives here. Never select `*` back to the client. */
@Injectable()
export class WorkTypesRepository {
  // Explicit token: see projects.service.ts — vitest drops design:paramtypes.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The single sync rule (spec §5). Runs inside the CALLER's transaction so a project create,
   * bulk import, team move, selection save or catalog edit commits together with its subprojects.
   * Writes exactly one `work_type.reconcile` audit row per call, even when nothing changed.
   */
  async reconcile(
    tx: Prisma.TransactionClient,
    projectIds: readonly string[],
    audit: ReconcileAudit,
  ): Promise<ReconcileCounts> {
    const ids = [...new Set(projectIds)];
    const projects =
      ids.length === 0
        ? []
        : await tx.project.findMany({
            where: { id: { in: ids } },
            select: { id: true, teamId: true },
          });

    const teamIds = [...new Set(projects.map((p) => p.teamId))];
    const selections =
      teamIds.length === 0
        ? []
        : await tx.teamWorkType.findMany({
            where: { teamId: { in: teamIds }, workType: { archived: false } },
            select: { teamId: true, workType: { select: { id: true, name: true } } },
          });
    const desiredByTeam = new Map<string, DesiredWorkType[]>();
    for (const s of selections) {
      const list = desiredByTeam.get(s.teamId);
      if (list) list.push(s.workType);
      else desiredByTeam.set(s.teamId, [s.workType]);
    }

    const subprojects =
      ids.length === 0
        ? []
        : await tx.subproject.findMany({
            where: { projectId: { in: ids } },
            select: {
              id: true,
              projectId: true,
              name: true,
              archived: true,
              isDefault: true,
              workTypeId: true,
            },
          });

    const plan = planReconcile(projects, desiredByTeam, subprojects);

    // skipDuplicates = ON CONFLICT DO NOTHING (no target), which also covers the partial unique
    // index: a concurrent reconcile that got there first is not an error (plan ruling R9).
    const created =
      plan.create.length === 0
        ? 0
        : (await tx.subproject.createMany({ data: plan.create, skipDuplicates: true })).count;
    for (const l of plan.link) {
      await tx.subproject.update({
        where: { id: l.id },
        data: { workTypeId: l.workTypeId, name: l.name, archived: false },
        select: { id: true },
      });
    }
    if (plan.restore.length > 0) {
      await tx.subproject.updateMany({
        where: { id: { in: plan.restore } },
        data: { archived: false },
      });
    }
    for (const [name, rowIds] of groupRenames(plan.rename)) {
      await tx.subproject.updateMany({ where: { id: { in: rowIds } }, data: { name } });
    }
    if (plan.archive.length > 0) {
      await tx.subproject.updateMany({
        where: { id: { in: plan.archive } },
        data: { archived: true },
      });
    }

    const counts: ReconcileCounts = {
      projects: projects.length,
      created,
      linked: plan.link.length,
      restored: plan.restore.length,
      renamed: plan.rename.length,
      archived: plan.archive.length,
    };
    await tx.auditLog.create({
      data: {
        actorId: audit.actorId,
        action: 'work_type.reconcile',
        targetType: audit.targetType,
        targetId: audit.targetId,
        diff: { trigger: audit.trigger, ...counts },
      },
    });
    return counts;
  }
}
```

- [ ] **Step 8: Run the unit tests, e2e and typecheck, and confirm they pass**

Run: `pnpm --filter @timetrack/api test -- work-types && RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- work-types && pnpm --filter @timetrack/api typecheck && pnpm --filter @timetrack/api lint`
Expected: PASS. That is 10 planner unit tests, 4 schema e2e tests and 10 reconcile e2e tests, with typecheck and lint clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/work-types/work-types.reconcile.ts \
  apps/api/src/modules/work-types/work-types.reconcile.spec.ts \
  apps/api/src/modules/work-types/work-types.repository.ts \
  apps/api/test/work-types.e2e-spec.ts
git commit -m "feat(api): reconcile team work types into project subprojects"
```

---

### Task 4: The `work-types` module — ADMIN routes, catalog CRUD, team selection, re-sync

**Files:**

- Create: `apps/api/src/common/name-import.ts`
- Create: `apps/api/src/common/name-import.spec.ts`
- Modify: `apps/api/src/modules/work-types/work-types.repository.ts` (add the catalog methods)
- Create: `apps/api/src/modules/work-types/work-types.service.ts`
- Create: `apps/api/src/modules/work-types/work-types.service.spec.ts`
- Create: `apps/api/src/modules/work-types/work-types.controller.ts`
- Create: `apps/api/src/modules/work-types/work-types.controller.spec.ts`
- Create: `apps/api/src/modules/work-types/work-types.module.ts`
- Modify: `apps/api/src/app.module.ts` (import and register `WorkTypesModule` after `ProjectsModule`)
- Modify: `apps/api/test/work-types.e2e-spec.ts` (add a third describe before the harness describe)
- Modify: `apps/api/test/app-bootstrap.e2e-spec.ts` (add one DI assertion)

**Interfaces:**

- Consumes:
  - From contracts: `NAME_MAX_LENGTH`, `nameKey`, `normalizeName`, `NameSkip`, `WorkType`, `WorkTypeWithTeams`, `BulkCreateWorkTypes(+Schema)`, `BulkCreateWorkTypesResult`, `UpdateWorkType(+Schema)`, `SetTeamWorkTypes(+Schema)`, `TeamWorkTypes`, `ReconcileCounts` and `DEFAULT_SUBPROJECT_NAME`.
  - From Task 3: `WorkTypesRepository.reconcile`, `RECONCILE_TX`, `isUniqueViolation`, `catalogConflict`, `CONCURRENT_CHANGE`.
- Produces:
  - `planNameImport(raw: readonly string[], taken: ReadonlyMap<string, string>): { accepted: string[]; skipped: NameSkip[] }`. Here `taken` maps a `nameKey` to the skip reason. Task 5 reuses it.
  - New `WorkTypesRepository` methods:
    - `listWithTeams(): Promise<WorkTypeWithTeams[]>`
    - `listAll(): Promise<WorkType[]>`
    - `findByIds(ids: readonly string[]): Promise<WorkType[]>`
    - `teamExists(teamId: string): Promise<boolean>`
    - `createMany(names: readonly string[], actorId: string): Promise<WorkType[]>`
    - `update(id: string, patch: { name?: string; archived?: boolean }, actorId: string): Promise<WorkType | null>`
    - `setTeamSelection(teamId: string, workTypeIds: readonly string[], actorId: string): Promise<TeamWorkTypes>`
    - `resync(actorId: string): Promise<ReconcileCounts>`
  - `WorkTypesService`, with methods `list()`, `bulkCreate(dto, actor)`, `update(id, dto, actor)`, `setTeamSelection(teamId, dto, actor)` and `resync(actor)`.
  - `WorkTypesModule`, with `exports: [WorkTypesRepository]`. Task 5 imports it into `ProjectsModule`.
  - These routes, all ADMIN only:
    - `GET /v1/work-types`
    - `POST /v1/work-types/bulk`
    - `PATCH /v1/work-types/:id`
    - `PUT /v1/work-types/teams/:teamId`
    - `POST /v1/work-types/resync`
  - Audit actions: `work_type.create` (one per created row), `work_type.update` (diff `{ before, after }`), `team.work_types_set` (diff `{ before: string[], after: string[] }`), and `work_type.reconcile` (Task 3).

- [ ] **Step 1: Write the failing `planNameImport` tests**

Create `apps/api/src/common/name-import.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planNameImport } from './name-import.js';

describe('planNameImport', () => {
  it('normalizes each name and accepts the new ones in order', () => {
    expect(planNameImport(['  Acme  Ltd ', 'Globex'], new Map())).toEqual({
      accepted: ['Acme Ltd', 'Globex'],
      skipped: [],
    });
  });

  it('skips a taken name with the reason the caller supplied', () => {
    const taken = new Map([['acme', 'Already exists in Support']]);
    expect(planNameImport(['ACME'], taken).skipped).toEqual([
      { name: 'ACME', reason: 'Already exists in Support' },
    ]);
  });

  it('skips in-list repeats case-insensitively, keeping the first spelling', () => {
    expect(planNameImport(['Globex', 'globex', 'GLOBEX'], new Map())).toEqual({
      accepted: ['Globex'],
      skipped: [
        { name: 'globex', reason: 'Duplicate in list' },
        { name: 'GLOBEX', reason: 'Duplicate in list' },
      ],
    });
  });

  it('skips empty and over-long names instead of failing the batch', () => {
    const long = 'x'.repeat(201);
    expect(planNameImport(['   ', '&nbsp;', long, 'Ok'], new Map())).toEqual({
      accepted: ['Ok'],
      skipped: [
        { name: '   ', reason: 'Empty name' },
        { name: '&nbsp;', reason: 'Empty name' },
        { name: long, reason: 'Longer than 200 characters' },
      ],
    });
  });

  it('accepts a name of exactly 200 characters', () => {
    expect(planNameImport(['y'.repeat(200)], new Map()).accepted).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Confirm it fails**

Run: `pnpm --filter @timetrack/api test -- name-import`
Expected: FAIL, because `./name-import.js` cannot be resolved.

- [ ] **Step 3: Implement `name-import.ts`**

Create `apps/api/src/common/name-import.ts`:

```ts
import { NAME_MAX_LENGTH, nameKey, normalizeName, type NameSkip } from '@timetrack/contracts';

export interface NameImportPlan {
  accepted: string[];
  skipped: NameSkip[];
}

/**
 * Shared by POST /v1/work-types/bulk and POST /v1/projects/bulk (plan ruling R4). Each raw name is
 * normalized; a bad name is SKIPPED with a reason rather than 422-ing the batch. `taken` maps a
 * `nameKey` to the reason for a name that already exists (the caller words it per domain).
 */
export function planNameImport(
  raw: readonly string[],
  taken: ReadonlyMap<string, string>,
): NameImportPlan {
  const accepted: string[] = [];
  const skipped: NameSkip[] = [];
  const seen = new Set<string>();
  for (const input of raw) {
    const name = normalizeName(input);
    if (name.length === 0) {
      skipped.push({ name: input, reason: 'Empty name' });
      continue;
    }
    if (name.length > NAME_MAX_LENGTH) {
      skipped.push({ name, reason: `Longer than ${NAME_MAX_LENGTH} characters` });
      continue;
    }
    const key = nameKey(name);
    const reason = taken.get(key);
    if (reason !== undefined) {
      skipped.push({ name, reason });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ name, reason: 'Duplicate in list' });
      continue;
    }
    seen.add(key);
    accepted.push(name);
  }
  return { accepted, skipped };
}
```

Run: `pnpm --filter @timetrack/api test -- name-import`
Expected: PASS, 5 tests.

- [ ] **Step 4: Write the failing service unit tests**

Create `apps/api/src/modules/work-types/work-types.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { WorkTypesService } from './work-types.service.js';
import type { WorkTypesRepository } from './work-types.repository.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };
const W1 = '01920000-0000-7000-8000-000000000001';
const W2 = '01920000-0000-7000-8000-000000000002';
const T2 = '01920000-0000-7000-8000-0000000000c2';

function makeService(overrides: Partial<WorkTypesRepository> = {}) {
  const repo = {
    listWithTeams: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue([{ id: W1, name: 'Payroll', archived: false }]),
    findByIds: vi.fn().mockResolvedValue([]),
    teamExists: vi.fn().mockResolvedValue(true),
    createMany: vi
      .fn()
      .mockImplementation((names: string[]) =>
        Promise.resolve(names.map((name, i) => ({ id: `new-${i}`, name, archived: false }))),
      ),
    update: vi.fn().mockResolvedValue({ id: W1, name: 'Payroll', archived: false }),
    setTeamSelection: vi.fn().mockResolvedValue({ teamId: T2, workTypeIds: [] }),
    resync: vi.fn(),
    ...overrides,
  } as unknown as WorkTypesRepository;
  return { svc: new WorkTypesService(repo), repo };
}

beforeEach(() => vi.clearAllMocks());

describe('WorkTypesService.bulkCreate', () => {
  it('creates new names and skips reserved, existing, repeated and bad ones with reasons', async () => {
    const { svc, repo } = makeService();
    const result = await svc.bulkCreate(
      { names: ['Bookkeeping', 'payroll', 'GENERAL', 'bookkeeping', '  ', 'AdHoc'] },
      admin,
    );
    expect(repo.createMany).toHaveBeenCalledWith(['Bookkeeping', 'AdHoc'], 'a1');
    expect(result.created.map((w) => w.name)).toEqual(['Bookkeeping', 'AdHoc']);
    expect(result.skipped).toEqual([
      { name: 'payroll', reason: 'Already in the catalog' },
      { name: 'GENERAL', reason: 'Reserved name' },
      { name: 'bookkeeping', reason: 'Duplicate in list' },
      { name: '  ', reason: 'Empty name' },
    ]);
  });

  it('skips empty and over-long names with a reason', async () => {
    const { svc } = makeService();
    const long = 'z'.repeat(201);
    const result = await svc.bulkCreate({ names: [long] }, admin);
    expect(result).toEqual({
      created: [],
      skipped: [{ name: long, reason: 'Longer than 200 characters' }],
    });
  });

  it('does not call the repository when nothing is left to create', async () => {
    const { svc, repo } = makeService();
    await svc.bulkCreate({ names: ['Payroll'] }, admin);
    expect(repo.createMany).not.toHaveBeenCalled();
  });
});

describe('WorkTypesService.update', () => {
  it('409s a rename to General in any case (ruling R14)', async () => {
    const { svc, repo } = makeService();
    await expect(svc.update(W1, { name: 'general' }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('409s a rename that collides case-insensitively with another work type', async () => {
    const { svc } = makeService({
      listAll: vi.fn().mockResolvedValue([
        { id: W1, name: 'Payroll', archived: false },
        { id: W2, name: 'AdHoc', archived: false },
      ]),
    });
    await expect(svc.update(W2, { name: 'PAYROLL' }, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('allows re-casing its own name, normalized', async () => {
    const { svc, repo } = makeService();
    await svc.update(W1, { name: '  PAYROLL ' }, admin);
    expect(repo.update).toHaveBeenCalledWith(W1, { name: 'PAYROLL' }, 'a1');
  });

  it('422s a name that is empty once normalized', async () => {
    const { svc } = makeService();
    await expect(svc.update(W1, { name: '&nbsp;' }, admin)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('passes an archive-only patch without reading the catalog', async () => {
    const { svc, repo } = makeService();
    await svc.update(W1, { archived: true }, admin);
    expect(repo.listAll).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(W1, { archived: true }, 'a1');
  });

  it('404s when the work type is gone', async () => {
    const { svc } = makeService({ update: vi.fn().mockResolvedValue(null) });
    await expect(svc.update(W1, { archived: true }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('WorkTypesService.setTeamSelection', () => {
  it('404s an unknown team', async () => {
    const { svc, repo } = makeService({ teamExists: vi.fn().mockResolvedValue(false) });
    await expect(svc.setTeamSelection(T2, { workTypeIds: [] }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.setTeamSelection).not.toHaveBeenCalled();
  });

  it('404s when any id is unknown', async () => {
    const { svc } = makeService({ findByIds: vi.fn().mockResolvedValue([]) });
    await expect(svc.setTeamSelection(T2, { workTypeIds: [W1] }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('422s when any id is archived', async () => {
    const { svc } = makeService({
      findByIds: vi.fn().mockResolvedValue([{ id: W1, name: 'Payroll', archived: true }]),
    });
    await expect(svc.setTeamSelection(T2, { workTypeIds: [W1] }, admin)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('de-duplicates ids before saving', async () => {
    const { svc, repo } = makeService({
      findByIds: vi.fn().mockResolvedValue([{ id: W1, name: 'Payroll', archived: false }]),
    });
    await svc.setTeamSelection(T2, { workTypeIds: [W1, W1] }, admin);
    expect(repo.findByIds).toHaveBeenCalledWith([W1]);
    expect(repo.setTeamSelection).toHaveBeenCalledWith(T2, [W1], 'a1');
  });
});

describe('WorkTypesService.resync / list', () => {
  it('delegates with the actor id and returns the counts', async () => {
    const counts = { projects: 3, created: 1, linked: 0, restored: 0, renamed: 0, archived: 0 };
    const { svc, repo } = makeService({ resync: vi.fn().mockResolvedValue(counts) });
    await expect(svc.resync(admin)).resolves.toEqual(counts);
    expect(repo.resync).toHaveBeenCalledWith('a1');
    await svc.list();
    expect(repo.listWithTeams).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Write the failing controller unit tests, including the literal 403s (ruling R11)**

Create `apps/api/src/modules/work-types/work-types.controller.spec.ts`:

```ts
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkTypesController } from './work-types.controller.js';
import type { WorkTypesService } from './work-types.service.js';
import { ROLES } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';

const HANDLERS = ['list', 'bulkCreate', 'update', 'setTeamSelection', 'resync'] as const;
const admin: SessionUser = { id: 'a1', role: 'ADMIN', teamId: 't1' };
const manager: SessionUser = { id: 'm1', role: 'MANAGER', teamId: 't1' };
const employee: SessionUser = { id: 'e1', role: 'EMPLOYEE', teamId: 't1' };

function guardContext(handler: (typeof HANDLERS)[number], user: SessionUser): ExecutionContext {
  return {
    getHandler: () => WorkTypesController.prototype[handler],
    getClass: () => WorkTypesController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function make() {
  const service = {
    list: vi.fn().mockResolvedValue([]),
    bulkCreate: vi.fn(),
    update: vi.fn(),
    setTeamSelection: vi.fn(),
    resync: vi.fn(),
  } as unknown as WorkTypesService;
  return { ctrl: new WorkTypesController(service), service };
}

beforeEach(() => vi.clearAllMocks());

describe('WorkTypesController authorization', () => {
  it.each(HANDLERS)('pins %s to ADMIN', (handler) => {
    expect(Reflect.getMetadata(ROLES, WorkTypesController.prototype[handler])).toEqual(['ADMIN']);
  });

  it.each(HANDLERS)('403s MANAGER and EMPLOYEE on %s through the real RolesGuard', (handler) => {
    const guard = new RolesGuard(new Reflector());
    for (const user of [manager, employee]) {
      expect(() => guard.canActivate(guardContext(handler, user))).toThrow(ForbiddenException);
    }
    expect(guard.canActivate(guardContext(handler, admin))).toBe(true);
  });
});

describe('WorkTypesController delegation', () => {
  it('passes the URL ids, body and actor through', async () => {
    const { ctrl, service } = make();
    await ctrl.bulkCreate({ names: ['A'] }, admin);
    expect(service.bulkCreate).toHaveBeenCalledWith({ names: ['A'] }, admin);
    await ctrl.update('w1', { archived: true }, admin);
    expect(service.update).toHaveBeenCalledWith('w1', { archived: true }, admin);
    await ctrl.setTeamSelection('t2', { workTypeIds: [] }, admin);
    expect(service.setTeamSelection).toHaveBeenCalledWith('t2', { workTypeIds: [] }, admin);
    await ctrl.resync(admin);
    expect(service.resync).toHaveBeenCalledWith(admin);
    await ctrl.list();
    expect(service.list).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Confirm both fail**

Run: `pnpm --filter @timetrack/api test -- work-types.service work-types.controller`
Expected: FAIL, because `./work-types.service.js` and `./work-types.controller.js` cannot be resolved.

- [ ] **Step 7: Add the catalog methods to the repository**

In `apps/api/src/modules/work-types/work-types.repository.ts`, extend the contracts import to `import type { ReconcileCounts, TeamWorkTypes, WorkType, WorkTypeWithTeams } from '@timetrack/contracts';`. Add this constant above the class:

```ts
const WORK_TYPE_SELECT = { id: true, name: true, archived: true } as const;
```

Add these methods inside the class, after `reconcile`:

```ts
  async listWithTeams(): Promise<WorkTypeWithTeams[]> {
    const rows = await this.prisma.workType.findMany({
      orderBy: { name: 'asc' },
      select: {
        ...WORK_TYPE_SELECT,
        teams: { select: { teamId: true }, orderBy: { teamId: 'asc' } },
      },
    });
    return rows.map(({ teams, ...wt }) => ({ ...wt, teamIds: teams.map((t) => t.teamId) }));
  }

  listAll(): Promise<WorkType[]> {
    return this.prisma.workType.findMany({ orderBy: { name: 'asc' }, select: WORK_TYPE_SELECT });
  }

  async findByIds(ids: readonly string[]): Promise<WorkType[]> {
    if (ids.length === 0) return [];
    return this.prisma.workType.findMany({
      where: { id: { in: [...ids] } },
      select: WORK_TYPE_SELECT,
    });
  }

  async teamExists(teamId: string): Promise<boolean> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    return team !== null;
  }

  /** New catalog entries. No team has selected them yet, so there is nothing to reconcile. */
  async createMany(names: readonly string[], actorId: string): Promise<WorkType[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.workType.createManyAndReturn({
          data: names.map((name) => ({ name })),
          select: WORK_TYPE_SELECT,
        });
        await tx.auditLog.createMany({
          data: created.map((w) => ({
            actorId,
            action: 'work_type.create',
            targetType: 'work_type',
            targetId: w.id,
            diff: { name: w.name },
          })),
        });
        return created;
      });
    } catch (e) {
      // work_types_name_ci_unique: a concurrent create of the same name won the race.
      if (isUniqueViolation(e)) throw catalogConflict('A work type with this name already exists');
      throw e;
    }
  }

  /**
   * Rename and/or archive/restore, audit it, and reconcile every project of every team that has
   * it — one transaction. Returns null when the work type is gone (service → 404).
   */
  async update(
    id: string,
    patch: { name?: string; archived?: boolean },
    actorId: string,
  ): Promise<WorkType | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.workType.findUnique({ where: { id }, select: WORK_TYPE_SELECT });
        if (!before) return null;
        const workType = await tx.workType.update({
          where: { id },
          data: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
          },
          select: WORK_TYPE_SELECT,
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'work_type.update',
            targetType: 'work_type',
            targetId: id,
            diff: {
              before: { name: before.name, archived: before.archived },
              after: { name: workType.name, archived: workType.archived },
            },
          },
        });
        const teams = await tx.teamWorkType.findMany({
          where: { workTypeId: id },
          select: { teamId: true },
        });
        const projects =
          teams.length === 0
            ? []
            : await tx.project.findMany({
                where: { teamId: { in: teams.map((t) => t.teamId) } },
                select: { id: true },
              });
        await this.reconcile(
          tx,
          projects.map((p) => p.id),
          { actorId, trigger: 'work_type_update', targetType: 'work_type', targetId: id },
        );
        return workType;
      }, RECONCILE_TX);
    } catch (e) {
      if (isUniqueViolation(e)) throw catalogConflict('A work type with this name already exists');
      throw e;
    }
  }

  /**
   * Replace the team's NON-archived selection with `workTypeIds`; links to archived work types
   * are kept so a Restore brings them back for the same teams (plan ruling R5). Deleting a
   * selection row is audited in the same transaction, then every project of the team reconciles.
   */
  async setTeamSelection(
    teamId: string,
    workTypeIds: readonly string[],
    actorId: string,
  ): Promise<TeamWorkTypes> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.teamWorkType.findMany({
          where: { teamId },
          select: { workTypeId: true, workType: { select: { archived: true } } },
        });
        const keptArchived = current.filter((c) => c.workType.archived).map((c) => c.workTypeId);
        const next = [...new Set([...workTypeIds, ...keptArchived])].sort();

        await tx.teamWorkType.deleteMany({ where: { teamId, workTypeId: { notIn: next } } });
        if (workTypeIds.length > 0) {
          await tx.teamWorkType.createMany({
            data: workTypeIds.map((workTypeId) => ({ teamId, workTypeId })),
            skipDuplicates: true,
          });
        }
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'team.work_types_set',
            targetType: 'team',
            targetId: teamId,
            diff: { before: current.map((c) => c.workTypeId).sort(), after: next },
          },
        });
        const projects = await tx.project.findMany({ where: { teamId }, select: { id: true } });
        await this.reconcile(
          tx,
          projects.map((p) => p.id),
          { actorId, trigger: 'team_selection', targetType: 'team', targetId: teamId },
        );
        return { teamId, workTypeIds: next };
      }, RECONCILE_TX);
    } catch (e) {
      if (isUniqueViolation(e)) throw catalogConflict(CONCURRENT_CHANGE);
      throw e;
    }
  }

  /** The admin safety net (spec §8.3): reconcile every project in the org. */
  async resync(actorId: string): Promise<ReconcileCounts> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const projects = await tx.project.findMany({ select: { id: true } });
        return this.reconcile(
          tx,
          projects.map((p) => p.id),
          { actorId, trigger: 'resync', targetType: 'work_type', targetId: 'all' },
        );
      }, RECONCILE_TX);
    } catch (e) {
      if (isUniqueViolation(e)) throw catalogConflict(CONCURRENT_CHANGE);
      throw e;
    }
  }
```

- [ ] **Step 8: Implement the service, controller and module, and register the module**

Create `apps/api/src/modules/work-types/work-types.service.ts`:

```ts
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DEFAULT_SUBPROJECT_NAME,
  nameKey,
  normalizeName,
  type BulkCreateWorkTypes,
  type BulkCreateWorkTypesResult,
  type ReconcileCounts,
  type SetTeamWorkTypes,
  type TeamWorkTypes,
  type UpdateWorkType,
  type WorkType,
  type WorkTypeWithTeams,
} from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { planNameImport } from '../../common/name-import.js';
import { WorkTypesRepository } from './work-types.repository.js';

const RESERVED_KEY = nameKey(DEFAULT_SUBPROJECT_NAME);

/**
 * The org-wide work-type catalog and each team's selection (spec §6). ADMIN-only at the
 * controller; there is no per-resource rule to add here because these are org-wide objects.
 */
@Injectable()
export class WorkTypesService {
  constructor(@Inject(WorkTypesRepository) private readonly repo: WorkTypesRepository) {}

  list(): Promise<WorkTypeWithTeams[]> {
    return this.repo.listWithTeams();
  }

  async bulkCreate(
    dto: BulkCreateWorkTypes,
    actor: SessionUser,
  ): Promise<BulkCreateWorkTypesResult> {
    const taken = new Map<string, string>([[RESERVED_KEY, 'Reserved name']]);
    for (const w of await this.repo.listAll()) taken.set(nameKey(w.name), 'Already in the catalog');
    const { accepted, skipped } = planNameImport(dto.names, taken);
    const created = accepted.length === 0 ? [] : await this.repo.createMany(accepted, actor.id);
    return { created, skipped };
  }

  async update(id: string, dto: UpdateWorkType, actor: SessionUser): Promise<WorkType> {
    // exactOptionalPropertyTypes: only the keys the caller actually sent.
    const patch: { name?: string; archived?: boolean } = {};
    if (dto.name !== undefined) {
      const name = normalizeName(dto.name);
      if (name.length === 0) throw this.unprocessable('Enter a name');
      const key = nameKey(name);
      if (key === RESERVED_KEY) throw this.conflict('“General” is reserved');
      const clash = (await this.repo.listAll()).find((w) => w.id !== id && nameKey(w.name) === key);
      if (clash) throw this.conflict('A work type with this name already exists');
      patch.name = name;
    }
    if (dto.archived !== undefined) patch.archived = dto.archived;
    const updated = await this.repo.update(id, patch, actor.id);
    if (!updated) throw this.notFound('Work type not found');
    return updated;
  }

  async setTeamSelection(
    teamId: string,
    dto: SetTeamWorkTypes,
    actor: SessionUser,
  ): Promise<TeamWorkTypes> {
    if (!(await this.repo.teamExists(teamId))) throw this.notFound('Team not found');
    const ids = [...new Set(dto.workTypeIds)];
    const found = await this.repo.findByIds(ids);
    if (found.length !== ids.length) throw this.notFound('Work type not found');
    if (found.some((w) => w.archived)) {
      throw this.unprocessable('Archived work types cannot be selected');
    }
    return this.repo.setTeamSelection(teamId, ids, actor.id);
  }

  resync(actor: SessionUser): Promise<ReconcileCounts> {
    return this.repo.resync(actor.id);
  }

  private conflict(title: string): ConflictException {
    return new ConflictException({
      type: 'https://timetrack.internal/errors/conflict',
      title,
      status: 409,
    });
  }

  private notFound(title: string): NotFoundException {
    return new NotFoundException({
      type: 'https://timetrack.internal/errors/not-found',
      title,
      status: 404,
    });
  }

  private unprocessable(title: string): UnprocessableEntityException {
    return new UnprocessableEntityException({
      type: 'https://timetrack.internal/errors/unprocessable',
      title,
      status: 422,
    });
  }
}
```

Create `apps/api/src/modules/work-types/work-types.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  BulkCreateWorkTypesSchema,
  SetTeamWorkTypesSchema,
  UpdateWorkTypeSchema,
  type BulkCreateWorkTypes,
  type BulkCreateWorkTypesResult,
  type ReconcileCounts,
  type SetTeamWorkTypes,
  type TeamWorkTypes,
  type UpdateWorkType,
  type WorkType,
  type WorkTypeWithTeams,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { WorkTypesService } from './work-types.service.js';

/**
 * ADMIN-only, org-wide (spec §6). Deliberately no `@ResourceScope` (CLAUDE.md §8.6): the catalog
 * and team selections have no owning user to scope against, so `@Roles('ADMIN')` IS the
 * authorization — the same gate the Teams admin routes rely on.
 */
@Controller('work-types')
export class WorkTypesController {
  constructor(private readonly service: WorkTypesService) {}

  @Get()
  @Roles('ADMIN')
  list(): Promise<WorkTypeWithTeams[]> {
    return this.service.list();
  }

  @Post('bulk')
  @Roles('ADMIN')
  bulkCreate(
    @Body(new ZodValidationPipe(BulkCreateWorkTypesSchema)) dto: BulkCreateWorkTypes,
    @CurrentUser() actor: SessionUser,
  ): Promise<BulkCreateWorkTypesResult> {
    return this.service.bulkCreate(dto, actor);
  }

  @Post('resync')
  @Roles('ADMIN')
  resync(@CurrentUser() actor: SessionUser): Promise<ReconcileCounts> {
    return this.service.resync(actor);
  }

  @Put('teams/:teamId')
  @Roles('ADMIN')
  setTeamSelection(
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(SetTeamWorkTypesSchema)) dto: SetTeamWorkTypes,
    @CurrentUser() actor: SessionUser,
  ): Promise<TeamWorkTypes> {
    return this.service.setTeamSelection(teamId, dto, actor);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkTypeSchema)) dto: UpdateWorkType,
    @CurrentUser() actor: SessionUser,
  ): Promise<WorkType> {
    return this.service.update(id, dto, actor);
  }
}
```

Create `apps/api/src/modules/work-types/work-types.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { WorkTypesController } from './work-types.controller.js';
import { WorkTypesService } from './work-types.service.js';
import { WorkTypesRepository } from './work-types.repository.js';

/**
 * Exports the REPOSITORY, not the service: ProjectsRepository calls `reconcile` inside its own
 * transactions (project create, bulk import, team move), which a service boundary cannot offer.
 */
@Module({
  controllers: [WorkTypesController],
  providers: [WorkTypesService, WorkTypesRepository],
  exports: [WorkTypesRepository],
})
export class WorkTypesModule {}
```

In `apps/api/src/app.module.ts`, add `import { WorkTypesModule } from './modules/work-types/work-types.module.js';` after the `ProjectsModule` import. Add `WorkTypesModule,` to `imports` directly after `ProjectsModule,`.

- [ ] **Step 9: Run the unit tests and confirm they pass**

Run: `pnpm --filter @timetrack/api test -- work-types name-import`
Expected: PASS. That covers the service spec, the controller spec (5 metadata, 5 guard and 1 delegation tests), the planner and name-import.

- [ ] **Step 10: Write the service-level e2e**

In `apps/api/test/work-types.e2e-spec.ts`, extend the imports:

```ts
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { WorkTypesService } from '../src/modules/work-types/work-types.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
```

Add this describe before the harness describe:

```ts
describe.runIf(RUN_E2E)('work types — service', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  const ADMIN_ID = '01920000-0000-7000-8000-0000000000a1';
  const MISSING = '01920000-0000-7000-8000-0000000000ff';
  const svc = () =>
    new WorkTypesService(new WorkTypesRepository(db.prisma as unknown as PrismaService));
  const admin = (teamId: string): SessionUser => ({ id: ADMIN_ID, role: 'ADMIN', teamId });

  async function team(name: string): Promise<string> {
    const t = await db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
    return t.id;
  }
  async function project(teamId: string, name: string): Promise<string> {
    const p = await db.prisma.project.create({ data: { teamId, name }, select: { id: true } });
    await db.prisma.subproject.create({
      data: { projectId: p.id, name: 'General', isDefault: true },
    });
    return p.id;
  }
  async function catalog(teamId: string, ...names: string[]) {
    const { created } = await svc().bulkCreate({ names }, admin(teamId));
    return new Map(created.map((w) => [w.name, w.id] as const));
  }
  const linked = (projectId: string) =>
    db.prisma.subproject.findMany({
      where: { projectId, workTypeId: { not: null } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, archived: true, workTypeId: true },
    });

  it('bulk-creates, and skips reserved, existing, repeated and over-long names', async () => {
    const eng = await team('Eng');
    await catalog(eng, 'Payroll');
    const long = 'x'.repeat(201);

    const result = await svc().bulkCreate(
      { names: ['Bookkeeping', 'payroll', 'General', 'Bookkeeping ', 'AdHoc', long] },
      admin(eng),
    );
    expect(result.created.map((w) => w.name).sort()).toEqual(['AdHoc', 'Bookkeeping']);
    expect(result.skipped).toEqual([
      { name: 'payroll', reason: 'Already in the catalog' },
      { name: 'General', reason: 'Reserved name' },
      { name: 'Bookkeeping', reason: 'Duplicate in list' },
      { name: long, reason: 'Longer than 200 characters' },
    ]);
    await expect(db.prisma.auditLog.count({ where: { action: 'work_type.create' } })).resolves.toBe(
      3,
    );
  });

  it('the index backstops a case-insensitive duplicate the service did not see', async () => {
    const eng = await team('Eng');
    await catalog(eng, 'Payroll');
    const repo = new WorkTypesRepository(db.prisma as unknown as PrismaService);
    await expect(repo.createMany(['PAYROLL'], ADMIN_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s a rename to "General" and to another work type’s name, case-insensitively', async () => {
    const eng = await team('Eng');
    const ids = await catalog(eng, 'Payroll', 'AdHoc');
    const adhoc = ids.get('AdHoc')!;
    await expect(svc().update(adhoc, { name: 'GENERAL' }, admin(eng))).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(svc().update(adhoc, { name: 'payroll' }, admin(eng))).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(svc().update(adhoc, { name: 'ADHOC' }, admin(eng))).resolves.toMatchObject({
      name: 'ADHOC',
    });
  });

  it('lists work types by name with the teams that selected them', async () => {
    const eng = await team('Eng');
    const ids = await catalog(eng, 'Payroll', 'AdHoc');
    await svc().setTeamSelection(eng, { workTypeIds: [ids.get('Payroll')!] }, admin(eng));

    await expect(svc().list()).resolves.toEqual([
      { id: ids.get('AdHoc'), name: 'AdHoc', archived: false, teamIds: [] },
      { id: ids.get('Payroll'), name: 'Payroll', archived: false, teamIds: [eng] },
    ]);
  });

  it("saving a team's selection creates rows on its projects and archives dropped ones", async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const b = await project(eng, 'Globex');
    const ids = await catalog(eng, 'Payroll', 'AdHoc');
    const payroll = ids.get('Payroll')!;
    const adhoc = ids.get('AdHoc')!;

    const saved = await svc().setTeamSelection(eng, { workTypeIds: [payroll, adhoc] }, admin(eng));
    expect(saved).toEqual({ teamId: eng, workTypeIds: [payroll, adhoc].sort() });
    for (const p of [a, b]) {
      expect((await linked(p)).map((r) => r.name)).toEqual(['AdHoc', 'Payroll']);
    }

    await svc().setTeamSelection(eng, { workTypeIds: [payroll] }, admin(eng));
    const rows = await linked(a);
    expect(rows.find((r) => r.workTypeId === adhoc)?.archived).toBe(true);
    expect(rows.find((r) => r.workTypeId === payroll)?.archived).toBe(false);

    // Sorted, not ordered by timestamp: both rows of one save share the transaction's now().
    const actions = await db.prisma.auditLog.findMany({
      where: { targetType: 'team', targetId: eng },
      select: { action: true },
    });
    expect(actions.map((x) => x.action).sort()).toEqual([
      'team.work_types_set',
      'team.work_types_set',
      'work_type.reconcile',
      'work_type.reconcile',
    ]);
  });

  it('404s an unknown team or work type and 422s an archived one, writing nothing', async () => {
    const eng = await team('Eng');
    const ids = await catalog(eng, 'Payroll');
    const payroll = ids.get('Payroll')!;
    await svc().update(payroll, { archived: true }, admin(eng));
    const auditBefore = await db.prisma.auditLog.count();

    await expect(
      svc().setTeamSelection(MISSING, { workTypeIds: [] }, admin(eng)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc().setTeamSelection(eng, { workTypeIds: [MISSING] }, admin(eng)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc().setTeamSelection(eng, { workTypeIds: [payroll] }, admin(eng)),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(db.prisma.auditLog.count()).resolves.toBe(auditBefore);
  });

  it('an archived selection survives a column save and restore brings back the same rows', async () => {
    const eng = await team('Eng');
    const a = await project(eng, 'Acme');
    const ids = await catalog(eng, 'Payroll', 'AdHoc');
    const payroll = ids.get('Payroll')!;
    const adhoc = ids.get('AdHoc')!;
    await svc().setTeamSelection(eng, { workTypeIds: [payroll, adhoc] }, admin(eng));
    const original = (await linked(a)).find((r) => r.workTypeId === payroll);

    await svc().update(payroll, { archived: true }, admin(eng));
    // The dashboard never submits an archived row's checkbox (ruling R5).
    const saved = await svc().setTeamSelection(eng, { workTypeIds: [adhoc] }, admin(eng));
    expect(saved.workTypeIds).toEqual([payroll, adhoc].sort());

    await svc().update(payroll, { archived: false }, admin(eng));
    const restored = (await linked(a)).find((r) => r.workTypeId === payroll);
    expect(restored).toEqual({ ...original, archived: false });
  });

  it('renaming a work type renames every linked row; archiving it archives them', async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    const a = await project(eng, 'Acme');
    const c = await project(support, 'Initech');
    const vat = (await catalog(eng, 'VAT Filling')).get('VAT Filling')!;
    await svc().setTeamSelection(eng, { workTypeIds: [vat] }, admin(eng));
    await svc().setTeamSelection(support, { workTypeIds: [vat] }, admin(eng));

    await svc().update(vat, { name: 'VAT/TAX Filling' }, admin(eng));
    for (const p of [a, c]) {
      expect((await linked(p)).map((r) => r.name)).toEqual(['VAT/TAX Filling']);
    }
    await svc().update(vat, { archived: true }, admin(eng));
    for (const p of [a, c]) {
      expect((await linked(p)).map((r) => r.archived)).toEqual([true]);
    }
  });

  it('re-sync repairs a project made by old code, and a second run returns all zeros', async () => {
    const eng = await team('Eng');
    await project(eng, 'Acme');
    const payroll = (await catalog(eng, 'Payroll')).get('Payroll')!;
    await svc().setTeamSelection(eng, { workTypeIds: [payroll] }, admin(eng));
    const late = await project(eng, 'Created during the deploy window');

    await expect(svc().resync(admin(eng))).resolves.toEqual({
      projects: 2,
      created: 1,
      linked: 0,
      restored: 0,
      renamed: 0,
      archived: 0,
    });
    expect((await linked(late)).map((r) => r.name)).toEqual(['Payroll']);
    await expect(svc().resync(admin(eng))).resolves.toEqual({
      projects: 2,
      created: 0,
      linked: 0,
      restored: 0,
      renamed: 0,
      archived: 0,
    });
  });

  it('concurrent saves never duplicate or 500', async () => {
    const eng = await team('Eng');
    const projects = await Promise.all(['A', 'B', 'C'].map((n) => project(eng, n)));
    const ids = [...(await catalog(eng, 'Payroll', 'AdHoc', 'Audit')).values()];

    const results = await Promise.allSettled([
      svc().setTeamSelection(eng, { workTypeIds: ids }, admin(eng)),
      svc().setTeamSelection(eng, { workTypeIds: ids }, admin(eng)),
      svc().resync(admin(eng)),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
    }
    await svc().resync(admin(eng)); // settle whatever a 409 left undone
    for (const p of projects) {
      expect(await linked(p)).toHaveLength(3);
    }
  });
});
```

In `apps/api/test/app-bootstrap.e2e-spec.ts`, add `import { WorkTypesService } from '../src/modules/work-types/work-types.service.js';` and this test inside the existing describe:

```ts
it('registers WorkTypesService (proves WorkTypesModule is wired into AppModule)', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  expect(moduleRef.get(WorkTypesService, { strict: false })).toBeInstanceOf(WorkTypesService);
  await moduleRef.close();
});
```

- [ ] **Step 11: Run the e2e, typecheck and lint, and confirm they pass**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- work-types app-bootstrap && pnpm --filter @timetrack/api typecheck && pnpm --filter @timetrack/api lint`
Expected: PASS. That is 4 schema, 10 reconcile and 10 service e2e tests plus the 2 bootstrap tests, with typecheck and lint clean. If `concurrent saves` fails with a 40P01 deadlock rather than P2002, **stop and report it**. Do not loosen the assertion.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/common/name-import.ts apps/api/src/common/name-import.spec.ts \
  apps/api/src/modules/work-types apps/api/src/app.module.ts \
  apps/api/test/work-types.e2e-spec.ts apps/api/test/app-bootstrap.e2e-spec.ts
git commit -m "feat(api): add ADMIN work type routes"
```

---

### Task 5: Projects integration — reconcile on create and move, bulk import, guard rails

This task makes three commits, one per logical change (CLAUDE.md §6). The reviewer gates the task as a whole.

**Files:**

- Modify: `apps/api/src/modules/projects/projects.repository.ts`
- Modify: `apps/api/src/modules/projects/projects.service.ts`
- Modify: `apps/api/src/modules/projects/projects.controller.ts`
- Modify: `apps/api/src/modules/projects/projects.module.ts`
- Modify: `apps/api/src/modules/projects/projects.service.spec.ts`
- Modify: `apps/api/src/modules/projects/projects.controller.spec.ts`
- Modify: `apps/api/test/projects.e2e-spec.ts` (constructor, two audit lookups, one `toEqual`)
- Create: `apps/api/test/projects-work-types.e2e-spec.ts`

**Interfaces:**

- Consumes:
  - From Task 3: `WorkTypesRepository.reconcile(tx, projectIds, audit)`, `RECONCILE_TX`, `isUniqueViolation`, `catalogConflict` and `CONCURRENT_CHANGE`, with `ReconcileAudit` as in Shared types.
  - From Task 4: `WorkTypesModule` (exports `WorkTypesRepository`), `WorkTypesService`, and `planNameImport`.
  - From Task 1: `BulkCreateProjectsSchema`, `BulkCreateProjects`, `BulkCreateProjectsResult`, `nameKey` and `PROJECT_PALETTE`.
- Produces:
  - `ProjectsRepository` is now constructed as `new ProjectsRepository(prisma: PrismaService, workTypes: WorkTypesRepository)`, with both parameters given explicit `@Inject`.
  - New `ProjectsRepository` methods:
    - `findTeam(teamId: string): Promise<{ id: string; name: string } | null>`
    - `listAllProjectNames(): Promise<{ name: string; teamName: string }[]>`
    - `createProjectsBulk(teamId: string, items: readonly { name: string; color: string }[], actorId: string): Promise<Project[]>`
    - `hasActiveSubprojectNamed(projectId: string, name: string): Promise<boolean>`
  - `findSubprojectForActor` now returns `(Subproject & { teamId: string; workTypeId: string | null }) | null`. It is internal only and never serialized.
  - `ProjectsService.bulkCreate(dto: BulkCreateProjects, actor: SessionUser): Promise<BulkCreateProjectsResult>`.
  - The route `POST /v1/projects/bulk`, ADMIN only.

#### 5a — Reconcile on create and on a team move

- [ ] **Step 1: Update the existing repository e2e for the new constructor and the extra audit row**

In `apps/api/test/projects.e2e-spec.ts`:

1. Add `import { WorkTypesRepository } from '../src/modules/work-types/work-types.repository.js';`.
2. Replace the `repo()` helper body:

```ts
function repo(): ProjectsRepository {
  const prisma = db.prisma as unknown as PrismaService;
  return new ProjectsRepository(prisma, new WorkTypesRepository(prisma));
}
```

3. In `createProject inserts the project and writes an audit row`, add `action: 'project.create'` to the `findFirst` `where`. `createProject` now also writes a `work_type.reconcile` row against the same target (ruling R6).
4. In `setArchived toggles archived and audits archive vs unarchive`, change the `findMany` `where` to `{ targetType: 'project', targetId: project.id, action: { startsWith: 'project.' } }`.

- [ ] **Step 2: Write the failing create and move e2e**

Create `apps/api/test/projects-work-types.e2e-spec.ts`:

```ts
import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { PROJECT_PALETTE } from '@timetrack/contracts';
import { ProjectsRepository } from '../src/modules/projects/projects.repository.js';
import { ProjectsService } from '../src/modules/projects/projects.service.js';
import { WorkTypesRepository } from '../src/modules/work-types/work-types.repository.js';
import { WorkTypesService } from '../src/modules/work-types/work-types.service.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import type { SessionUser } from '../src/common/decorators/current-user.decorator.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/** The project side of team work types (spec §5, §6, §10), against a real Postgres. */
describe.runIf(RUN_E2E)('projects × work types — real Postgres', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  const ADMIN_ID = '01920000-0000-7000-8000-0000000000a1';
  const MISSING = '01920000-0000-7000-8000-0000000000ff';
  const FRESHNESS = 300;
  const prisma = () => db.prisma as unknown as PrismaService;
  const projects = () =>
    new ProjectsService(
      new ProjectsRepository(prisma(), new WorkTypesRepository(prisma())),
      FRESHNESS,
    );
  const catalog = () => new WorkTypesService(new WorkTypesRepository(prisma()));
  const admin = (teamId: string): SessionUser => ({ id: ADMIN_ID, role: 'ADMIN', teamId });

  async function team(name: string): Promise<string> {
    const t = await db.prisma.team.create({ data: { name, settings: {} }, select: { id: true } });
    return t.id;
  }
  /** Adds any missing names to the catalog and makes them the team's selection; name → id. */
  async function select(teamId: string, ...names: string[]): Promise<Map<string, string>> {
    const all = new Map((await catalog().list()).map((w) => [w.name, w.id] as const));
    const missing = names.filter((n) => !all.has(n));
    if (missing.length > 0) {
      const { created } = await catalog().bulkCreate({ names: missing }, admin(teamId));
      for (const w of created) all.set(w.name, w.id);
    }
    await catalog().setTeamSelection(
      teamId,
      { workTypeIds: names.map((n) => all.get(n)!) },
      admin(teamId),
    );
    return all;
  }
  function client(teamId: string, name: string) {
    return projects().createProject({ teamId, name, color: '#007aff' }, admin(teamId));
  }
  async function activeNames(projectId: string): Promise<string[]> {
    const rows = await db.prisma.subproject.findMany({
      where: { projectId, archived: false },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { name: true },
    });
    return rows.map((r) => r.name);
  }
  async function titleOf(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
      return undefined;
    } catch (e) {
      return e instanceof HttpException ? (e.getResponse() as { title?: string }).title : undefined;
    }
  }

  it("createProject gives a new client General plus its team's work types", async () => {
    const eng = await team('Eng');
    await select(eng, 'Payroll', 'AdHoc');
    const p = await client(eng, 'Acme');

    expect(await activeNames(p.id)).toEqual(['General', 'AdHoc', 'Payroll']);
    const audit = await db.prisma.auditLog.findFirst({
      where: { action: 'work_type.reconcile', targetType: 'project', targetId: p.id },
      select: { diff: true },
    });
    expect(audit?.diff).toMatchObject({ trigger: 'project_create', projects: 1, created: 2 });
  });

  it('moving a project to another team swaps its work types, and moving back restores the same rows', async () => {
    const eng = await team('Eng');
    const support = await team('Support');
    await select(eng, 'Payroll');
    await select(support, 'Internal');
    const p = await client(eng, 'Acme');
    const payroll = await db.prisma.subproject.findFirstOrThrow({
      where: { projectId: p.id, name: 'Payroll' },
      select: { id: true },
    });

    await projects().update(p.id, { teamId: support }, admin(eng));
    expect(await activeNames(p.id)).toEqual(['General', 'Internal']);

    await projects().update(p.id, { teamId: eng }, admin(eng));
    expect(await activeNames(p.id)).toEqual(['General', 'Payroll']);
    await expect(
      db.prisma.subproject.findFirstOrThrow({
        where: { projectId: p.id, name: 'Payroll' },
        select: { id: true, archived: true },
      }),
    ).resolves.toEqual({ id: payroll.id, archived: false });
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('projects × work types e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
```

(`ConflictException`, `NotFoundException`, `PROJECT_PALETTE`, `MISSING` and `titleOf` are used by the tests added in 5b and 5c. `test/` is neither linted nor typechecked, so declaring them now is harmless.)

- [ ] **Step 3: Confirm it fails**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- projects-work-types`
Expected: FAIL, 2 tests. The new client's subprojects are only `['General']`, because the repository ignores the extra constructor argument and never reconciles. (`test/` is not typechecked, so the extra argument doesn't fail on its own.)

- [ ] **Step 4: Inject `WorkTypesRepository` and reconcile inside `createProject` and `setTeam`**

In `apps/api/src/modules/projects/projects.repository.ts`, change the Nest import to `import { Inject, Injectable } from '@nestjs/common';`. Add:

```ts
import { WorkTypesRepository } from '../work-types/work-types.repository.js';
```

Replace the constructor:

```ts
  // Both params carry explicit tokens: once any param has @Inject, Nest stops reflecting the
  // others, and vitest's transform drops design:paramtypes (see projects.service.ts).
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkTypesRepository) private readonly workTypes: WorkTypesRepository,
  ) {}
```

In `createProject`, directly after the `tx.auditLog.create(...)` call and before `return project;`, add:

```ts
// The team's work types, in the same transaction (spec §5): a manager who creates a client
// still gets them. One project, so Prisma's default transaction timeout is enough (R13).
await this.workTypes.reconcile(tx, [project.id], {
  actorId,
  trigger: 'project_create',
  targetType: 'project',
  targetId: project.id,
});
```

In `setTeam`, directly after its `tx.auditLog.create(...)` and before `return project;`, add:

```ts
// Swap to the new team's work types: the old team's linked rows archive (never delete) and
// a move back restores the same rows (spec §5, rule 1 and 4).
await this.workTypes.reconcile(tx, [id], {
  actorId,
  trigger: 'project_team_change',
  targetType: 'project',
  targetId: id,
});
```

In `apps/api/src/modules/projects/projects.module.ts`, add `import { WorkTypesModule } from '../work-types/work-types.module.js';` and `imports: [WorkTypesModule],` as the first key of `@Module({...})`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- projects app-bootstrap && pnpm --filter @timetrack/api test -- projects && pnpm --filter @timetrack/api typecheck && pnpm --filter @timetrack/api lint`
Expected: PASS. The whole existing `projects.e2e-spec.ts` still passes (with the constructor and audit-filter edits), and so do the 2 new tests and the bootstrap DI test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/projects/projects.repository.ts \
  apps/api/src/modules/projects/projects.module.ts \
  apps/api/test/projects.e2e-spec.ts apps/api/test/projects-work-types.e2e-spec.ts
git commit -m "feat(api): reconcile work types when a project is created or moved"
```

#### 5b — `POST /v1/projects/bulk`

- [ ] **Step 7: Write the failing unit tests**

In `apps/api/src/modules/projects/projects.service.spec.ts`, add these to the `repo` object in `makeService`:

```ts
    findTeam: vi.fn().mockResolvedValue({ id: 't1', name: 'Eng' }),
    listAllProjectNames: vi.fn().mockResolvedValue([]),
    createProjectsBulk: vi.fn().mockImplementation((teamId: string, items: { name: string; color: string }[]) =>
      Promise.resolve(items.map((i, n) => ({ id: `p${n}`, teamId, name: i.name, color: i.color, archived: false }))),
    ),
    hasActiveSubprojectNamed: vi.fn().mockResolvedValue(false),
```

Add `import { PROJECT_PALETTE } from '@timetrack/contracts';` at the top. Append:

```ts
describe('ProjectsService.bulkCreate', () => {
  const TEAM = '01920000-0000-7000-8000-0000000000c1';

  it('404s an unknown team and creates nothing', async () => {
    const { svc, repo } = makeService({ findTeam: vi.fn().mockResolvedValue(null) });
    await expect(svc.bulkCreate({ teamId: TEAM, names: ['A'] }, admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.createProjectsBulk).not.toHaveBeenCalled();
  });

  it('skips org-wide existing names with their team, and in-list repeats', async () => {
    const { svc, repo } = makeService({
      listAllProjectNames: vi.fn().mockResolvedValue([{ name: 'Acme Ltd', teamName: 'Support' }]),
    });
    const out = await svc.bulkCreate(
      { teamId: TEAM, names: ['acme ltd', 'Globex', 'globex'] },
      admin,
    );
    expect(out.skipped).toEqual([
      { name: 'acme ltd', reason: 'Already exists in Support' },
      { name: 'globex', reason: 'Duplicate in list' },
    ]);
    expect(repo.createProjectsBulk).toHaveBeenCalledWith(
      't1',
      [{ name: 'Globex', color: PROJECT_PALETTE[0] }],
      'a1',
    );
  });

  it('assigns palette colours in turn, wrapping around', async () => {
    const { svc, repo } = makeService();
    const names = Array.from({ length: PROJECT_PALETTE.length + 1 }, (_, i) => `Client ${i}`);
    await svc.bulkCreate({ teamId: TEAM, names }, admin);
    const items = vi.mocked(repo.createProjectsBulk).mock.calls[0]?.[1] ?? [];
    expect(items.map((i) => i.color)).toEqual([...PROJECT_PALETTE, PROJECT_PALETTE[0]]);
  });

  it('bulkCreate skips over-long names instead of failing the batch', async () => {
    const { svc } = makeService();
    const long = 'n'.repeat(201);
    const out = await svc.bulkCreate({ teamId: TEAM, names: [long, 'Ok'] }, admin);
    expect(out.skipped).toEqual([{ name: long, reason: 'Longer than 200 characters' }]);
    expect(out.created.map((p) => p.name)).toEqual(['Ok']);
  });

  it('does not call the repository when every name was skipped', async () => {
    const { svc, repo } = makeService();
    await expect(svc.bulkCreate({ teamId: TEAM, names: ['  '] }, admin)).resolves.toEqual({
      created: [],
      skipped: [{ name: '  ', reason: 'Empty name' }],
    });
    expect(repo.createProjectsBulk).not.toHaveBeenCalled();
  });
});
```

In `apps/api/src/modules/projects/projects.controller.spec.ts`:

- Add `bulkCreate: vi.fn(),` to the mocked service in `make()`.
- Add imports: `import { ForbiddenException, type ExecutionContext } from '@nestjs/common';`, `import { Reflector } from '@nestjs/core';` and `import { RolesGuard } from '../../common/guards/roles.guard.js';`.
- Append:

```ts
describe('ProjectsController.bulkCreate authorization', () => {
  const ctx = (user: SessionUser): ExecutionContext =>
    ({
      getHandler: () => ProjectsController.prototype.bulkCreate,
      getClass: () => ProjectsController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('is ADMIN-only (not MANAGER): importing clients spans the org', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const meta = Reflect.getMetadata(ROLES, ProjectsController.prototype.bulkCreate);
    expect(meta).toEqual(['ADMIN']);
  });

  it('403s MANAGER and EMPLOYEE through the real RolesGuard', () => {
    const guard = new RolesGuard(new Reflector());
    for (const role of ['MANAGER', 'EMPLOYEE'] as const) {
      expect(() => guard.canActivate(ctx({ id: 'u1', role, teamId: 't1' }))).toThrow(
        ForbiddenException,
      );
    }
    expect(guard.canActivate(ctx({ id: 'a1', role: 'ADMIN', teamId: 't1' }))).toBe(true);
  });

  it('passes the dto and actor to the service', async () => {
    const { ctrl, service } = make();
    const dto = { teamId: '01920000-0000-7000-8000-0000000000c1', names: ['Acme'] };
    await ctrl.bulkCreate(dto, actor);
    expect(service.bulkCreate).toHaveBeenCalledWith(dto, actor);
  });
});
```

- [ ] **Step 8: Write the failing bulk e2e**

In `apps/api/test/projects-work-types.e2e-spec.ts`, add inside the main describe:

```ts
it("bulk import creates each client with General plus the team's work types, and reports skips", async () => {
  const eng = await team('Eng');
  const support = await team('Support');
  await select(eng, 'Payroll', 'AdHoc');
  await client(support, 'Acme Ltd');
  const old = await client(eng, 'Old Client');
  await projects().update(old.id, { archived: true }, admin(eng));

  const result = await projects().bulkCreate(
    { teamId: eng, names: ['acme ltd', 'Globex', 'old client', 'Initech', 'globex'] },
    admin(eng),
  );
  expect(result.skipped).toEqual([
    { name: 'acme ltd', reason: 'Already exists in Support' },
    { name: 'old client', reason: 'Already exists in Eng' },
    { name: 'globex', reason: 'Duplicate in list' },
  ]);
  const created = [...result.created].sort((a, b) => a.name.localeCompare(b.name));
  expect(created.map((p) => [p.name, p.teamId, p.color])).toEqual([
    ['Globex', eng, PROJECT_PALETTE[0]],
    ['Initech', eng, PROJECT_PALETTE[1]],
  ]);
  for (const p of created) {
    expect(await activeNames(p.id)).toEqual(['General', 'AdHoc', 'Payroll']);
  }

  const reconciles = await db.prisma.auditLog.findMany({
    where: { action: 'work_type.reconcile', targetType: 'team', targetId: eng },
    select: { diff: true },
  });
  expect(reconciles.map((r) => r.diff)).toContainEqual({
    trigger: 'project_bulk_create',
    projects: 2,
    created: 4,
    linked: 0,
    restored: 0,
    renamed: 0,
    archived: 0,
  });
  await expect(
    db.prisma.auditLog.count({
      where: { action: 'project.create', targetId: { in: created.map((p) => p.id) } },
    }),
  ).resolves.toBe(2);
});

it('bulk import 404s an unknown team and creates nothing', async () => {
  const eng = await team('Eng');
  await expect(
    projects().bulkCreate({ teamId: MISSING, names: ['Acme'] }, admin(eng)),
  ).rejects.toBeInstanceOf(NotFoundException);
  await expect(db.prisma.project.count()).resolves.toBe(0);
});
```

- [ ] **Step 9: Confirm they fail**

Run: `pnpm --filter @timetrack/api test -- projects`
Expected: FAIL. `svc.bulkCreate is not a function`, and `ProjectsController.prototype.bulkCreate` is undefined.

- [ ] **Step 10: Implement the repository methods, service and route**

In `projects.repository.ts`, widen the work-types import to:

```ts
import {
  CONCURRENT_CHANGE,
  RECONCILE_TX,
  WorkTypesRepository,
  catalogConflict,
  isUniqueViolation,
} from '../work-types/work-types.repository.js';
```

Then add after `createProject`:

```ts
  findTeam(teamId: string): Promise<{ id: string; name: string } | null> {
    return this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } });
  }

  /** Every project name in the org, with its team's name — the import's org-wide duplicate check. */
  async listAllProjectNames(): Promise<{ name: string; teamName: string }[]> {
    const rows = await this.prisma.project.findMany({
      orderBy: { name: 'asc' },
      select: { name: true, team: { select: { name: true } } },
    });
    return rows.map((r) => ({ name: r.name, teamName: r.team.name }));
  }

  /**
   * The client import (spec §6): every project, its General default, a `project.create` audit row
   * each, and one reconcile for the lot — all in ONE transaction, with the long timeout (R13).
   */
  async createProjectsBulk(
    teamId: string,
    items: readonly { name: string; color: string }[],
    actorId: string,
  ): Promise<Project[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const projects = await tx.project.createManyAndReturn({
          data: items.map((i) => ({ teamId, name: i.name, color: i.color })),
          select: PROJECT_SELECT,
        });
        await tx.subproject.createMany({
          data: projects.map((p) => ({
            projectId: p.id,
            name: DEFAULT_SUBPROJECT_NAME,
            isDefault: true,
          })),
        });
        await tx.auditLog.createMany({
          data: projects.map((p) => ({
            actorId,
            action: 'project.create',
            targetType: 'project',
            targetId: p.id,
            diff: { teamId, name: p.name, color: p.color },
          })),
        });
        await this.workTypes.reconcile(
          tx,
          projects.map((p) => p.id),
          { actorId, trigger: 'project_bulk_create', targetType: 'team', targetId: teamId },
        );
        return projects;
      }, RECONCILE_TX);
    } catch (e) {
      if (isUniqueViolation(e)) throw catalogConflict(CONCURRENT_CHANGE);
      throw e;
    }
  }
```

In `projects.service.ts`:

- Change the value import to `import { PROJECT_PALETTE, ProjectDetailSchema, nameKey } from '@timetrack/contracts';`.
- Add `BulkCreateProjects` and `BulkCreateProjectsResult` to the type import.
- Add `import { planNameImport } from '../../common/name-import.js';`.
- Add after `createProject`:

```ts
  /**
   * ADMIN-only client import (spec §6). A name that exists ANYWHERE in the org — archived or
   * not, any team — is skipped with the team that has it; repeats within the paste are skipped
   * too. Colours come from the palette in turn (ruling R15).
   */
  async bulkCreate(
    dto: BulkCreateProjects,
    actor: SessionUser,
  ): Promise<BulkCreateProjectsResult> {
    const team = await this.repo.findTeam(dto.teamId);
    if (!team) throw this.notFound('Team not found');

    const taken = new Map<string, string>();
    for (const p of await this.repo.listAllProjectNames()) {
      const key = nameKey(p.name);
      if (!taken.has(key)) taken.set(key, `Already exists in ${p.teamName}`);
    }
    const { accepted, skipped } = planNameImport(dto.names, taken);
    const items = accepted.map((name, i) => ({
      name,
      color: PROJECT_PALETTE[i % PROJECT_PALETTE.length] ?? PROJECT_PALETTE[0],
    }));
    const created =
      items.length === 0 ? [] : await this.repo.createProjectsBulk(team.id, items, actor.id);
    return { created, skipped };
  }
```

In `projects.controller.ts`:

- Add `BulkCreateProjectsSchema`, `type BulkCreateProjects` and `type BulkCreateProjectsResult` to the contracts import.
- Add this handler directly after `createProject`:

```ts
  /** ADMIN only: an import spans the org (its duplicate check reads every team's clients). */
  @Post('bulk')
  @Roles('ADMIN')
  bulkCreate(
    @Body(new ZodValidationPipe(BulkCreateProjectsSchema)) dto: BulkCreateProjects,
    @CurrentUser() actor: SessionUser,
  ): Promise<BulkCreateProjectsResult> {
    return this.service.bulkCreate(dto, actor);
  }
```

- [ ] **Step 11: Run the tests and confirm they pass**

Run: `pnpm --filter @timetrack/api test -- projects && RUN_E2E=1 pnpm --filter @timetrack/api test:e2e -- projects && pnpm --filter @timetrack/api typecheck && pnpm --filter @timetrack/api lint`
Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/modules/projects apps/api/test/projects-work-types.e2e-spec.ts
git commit -m "feat(api): bulk-import clients into a team with its work types"
```

#### 5c — Guard rails on catalog-managed subprojects, and the picker contract

- [ ] **Step 13: Write the failing unit and e2e tests**

In `projects.service.spec.ts`, add `workTypeId: null,` to the `SUB` fixture. Then append:

```ts
describe('ProjectsService — catalog-managed subprojects', () => {
  it('409s renaming or archiving a subproject linked to a work type', async () => {
    const { svc, repo } = makeService({
      findSubprojectForActor: vi.fn().mockResolvedValue({ ...SUB, workTypeId: 'w1' }),
    });
    for (const dto of [{ name: 'Pay' }, { archived: true }]) {
      await expect(svc.updateSubproject('s1', dto, manager)).rejects.toMatchObject({
        response: { title: 'Managed by the work type catalog', status: 409 },
      });
    }
    expect(repo.updateSubproject).not.toHaveBeenCalled();
  });

  it('409s a new subproject whose name an active one already has', async () => {
    const { svc, repo } = makeService({
      findForActor: vi.fn().mockResolvedValue({ id: 'p1', teamId: 't1' }),
      hasActiveSubprojectNamed: vi.fn().mockResolvedValue(true),
    });
    await expect(
      svc.createSubproject({ projectId: 'p1', name: 'payroll' }, manager),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.hasActiveSubprojectNamed).toHaveBeenCalledWith('p1', 'payroll');
    expect(repo.createSubproject).not.toHaveBeenCalled();
  });
});
```

In `apps/api/test/projects.e2e-spec.ts`, in `findSubprojectForActor returns the subproject with its team, or null`, change the expectation to `toEqual({ ...sub, teamId: team.id, workTypeId: null })`.

In `apps/api/test/projects-work-types.e2e-spec.ts`, add inside the main describe:

```ts
it('409s renaming or archiving a catalog-managed subproject; hand-made ones stay editable', async () => {
  const eng = await team('Eng');
  await select(eng, 'Payroll');
  const p = await client(eng, 'Acme');
  const linked = await db.prisma.subproject.findFirstOrThrow({
    where: { projectId: p.id, name: 'Payroll' },
    select: { id: true },
  });

  expect(await titleOf(projects().updateSubproject(linked.id, { name: 'Pay' }, admin(eng)))).toBe(
    'Managed by the work type catalog',
  );
  expect(
    await titleOf(projects().updateSubproject(linked.id, { archived: true }, admin(eng))),
  ).toBe('Managed by the work type catalog');

  const handMade = await projects().createSubproject(
    { projectId: p.id, name: 'Special' },
    admin(eng),
  );
  await expect(
    projects().updateSubproject(handMade.id, { archived: true }, admin(eng)),
  ).resolves.toMatchObject({ archived: true });
});

it('409s a new subproject whose name an active one has, case-insensitively; archived names are free', async () => {
  const eng = await team('Eng');
  await select(eng, 'Payroll');
  const p = await client(eng, 'Acme');

  await expect(
    projects().createSubproject({ projectId: p.id, name: 'PAYROLL' }, admin(eng)),
  ).rejects.toBeInstanceOf(ConflictException);
  await expect(
    projects().createSubproject({ projectId: p.id, name: 'general' }, admin(eng)),
  ).rejects.toBeInstanceOf(ConflictException);

  const old = await projects().createSubproject({ projectId: p.id, name: 'Old' }, admin(eng));
  await projects().updateSubproject(old.id, { archived: true }, admin(eng));
  await expect(
    projects().createSubproject({ projectId: p.id, name: 'old' }, admin(eng)),
  ).resolves.toMatchObject({ name: 'old' });
});

it("an EMPLOYEE sees only their team's clients, each with General plus the enabled work types", async () => {
  const eng = await team('Eng');
  const support = await team('Support');
  const ids = await select(eng, 'Payroll', 'AdHoc');
  await select(support, 'Internal');
  await client(eng, 'Acme');
  await client(support, 'Initech');
  // AdHoc is switched off for Eng afterwards: its rows archive and leave the picker.
  await catalog().setTeamSelection(eng, { workTypeIds: [ids.get('Payroll')!] }, admin(eng));

  const employee: SessionUser = {
    id: '01920000-0000-7000-8000-0000000000e1',
    role: 'EMPLOYEE',
    teamId: eng,
  };
  // Naming another team does not widen an EMPLOYEE's scope.
  const list = await projects().list(employee, false, support);
  expect(list.map((p) => p.name)).toEqual(['Acme']);
  const subs = list[0]?.subprojects ?? [];
  expect(subs.map((s) => s.name)).toEqual(['General', 'Payroll']);
  // The /v1 shape the shipped clients read is unchanged: no workTypeId on the wire.
  for (const s of subs) {
    expect(Object.keys(s).sort()).toEqual(['archived', 'id', 'isDefault', 'name', 'projectId']);
  }
});
```

- [ ] **Step 14: Confirm they fail**

Run: `pnpm --filter @timetrack/api test -- projects.service`
Expected: FAIL. The two new unit tests fail: the linked row gets updated, and the duplicate is created.

- [ ] **Step 15: Implement the guard rails**

In `projects.repository.ts`, replace `findSubprojectForActor`:

```ts
  /**
   * `workTypeId` rides along for the service's "managed by the catalog" check ONLY. It is never
   * added to SUBPROJECT_SELECT: that select feeds GET /v1/projects, which the shipped clients read.
   */
  async findSubprojectForActor(
    id: string,
  ): Promise<(Subproject & { teamId: string; workTypeId: string | null }) | null> {
    const sub = await this.prisma.subproject.findUnique({
      where: { id },
      select: { ...SUBPROJECT_SELECT, workTypeId: true, project: { select: { teamId: true } } },
    });
    if (!sub) return null;
    const { project, ...rest } = sub;
    return { ...rest, teamId: project.teamId };
  }
```

Add after `createSubproject`:

```ts
  async hasActiveSubprojectNamed(projectId: string, name: string): Promise<boolean> {
    const hit = await this.prisma.subproject.findFirst({
      where: { projectId, archived: false, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    return hit !== null;
  }
```

In `projects.service.ts`, in `createSubproject`, insert this after `this.assertCanAdminister(project.teamId, actor);`:

```ts
// Case-insensitive, active rows only (spec §5): stops a hand-made "payroll" shadowing the
// catalog's "Payroll", and a second "General".
if (await this.repo.hasActiveSubprojectNamed(dto.projectId, dto.name)) {
  throw this.conflict('This project already has a subproject with that name');
}
```

In `updateSubproject`, insert this after `this.assertCanAdminister(sub.teamId, actor);`:

```ts
// Linked rows are renamed/archived only by reconcile; a local edit would be undone by the
// next catalog change anyway (spec §5).
if (sub.workTypeId !== null) throw this.conflict('Managed by the work type catalog');
```

- [ ] **Step 16: Run everything API-side and confirm it passes**

Run: `pnpm --filter @timetrack/api test && RUN_E2E=1 pnpm --filter @timetrack/api test:e2e && pnpm --filter @timetrack/api typecheck && pnpm --filter @timetrack/api lint`
Expected: all PASS. That is the full unit suite and the **full** e2e suite, which checks that no other spec is disturbed by the extra audit rows or the constructor change.

- [ ] **Step 17: Commit**

```bash
git add apps/api/src/modules/projects apps/api/test/projects.e2e-spec.ts \
  apps/api/test/projects-work-types.e2e-spec.ts
git commit -m "feat(api): guard catalog-managed subprojects" \
  -m "Also 409s a new subproject whose name an active one already has, case-insensitively."
```

---

### Task 6: Dashboard — API client calls and the catalog view transform

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts` (widen `send` to `PUT`; add six calls; extend the contracts import)
- Modify: `apps/dashboard/src/lib/api-client.spec.ts` (append describes)
- Create: `apps/dashboard/src/lib/catalog-view.ts`
- Create: `apps/dashboard/src/lib/catalog-view.spec.ts`

**Interfaces:**

- Consumes: the Task 1 schemas and types `WorkTypeListSchema`, `WorkTypeSchema`, `BulkCreateWorkTypesResultSchema`, `TeamWorkTypesSchema`, `ReconcileCountsSchema`, `BulkCreateProjectsResultSchema`, `BulkCreateWorkTypes`, `UpdateWorkType`, `SetTeamWorkTypes`, `BulkCreateProjects`, `WorkTypeWithTeams`, `ReconcileCounts`, `Project` and `TeamListItem`.
- Produces:
  - Six new `api` calls:
    - `api.listWorkTypes(token): Promise<WorkTypeWithTeams[]>`
    - `api.bulkCreateWorkTypes(token, dto: BulkCreateWorkTypes): Promise<BulkCreateWorkTypesResult>`
    - `api.updateWorkType(token, id, dto: UpdateWorkType): Promise<WorkType>`
    - `api.setTeamWorkTypes(token, teamId, dto: SetTeamWorkTypes): Promise<TeamWorkTypes>`
    - `api.resyncWorkTypes(token): Promise<ReconcileCounts>`
    - `api.bulkCreateProjects(token, dto: BulkCreateProjects): Promise<BulkCreateProjectsResult>`
  - From `catalog-view.ts`:
    - `teamFormId(teamId: string): string`
    - `buildCatalogMatrix(workTypes, teams): CatalogMatrix`
    - `teamSaveDiff(workTypes, teamId, submitted: readonly string[]): TeamSaveDiff`
    - `describeTeamSave(diff: TeamSaveDiff, teamName: string): string`
    - `describeCounts(c: ReconcileCounts): string`
    - `clientRows(teams, projects): ClientRow[]`
    - The types `CatalogMatrix`, `CatalogRow`, `CatalogTeam`, `TeamSaveDiff` and `ClientRow`, as defined in Step 3.

- [ ] **Step 1: Write the failing view-transform tests**

Create `apps/dashboard/src/lib/catalog-view.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Project, WorkTypeWithTeams } from '@timetrack/contracts';
import {
  buildCatalogMatrix,
  clientRows,
  describeCounts,
  describeTeamSave,
  teamFormId,
  teamSaveDiff,
} from './catalog-view';

const ENG = { id: 't-eng', name: 'Eng' };
const OPS = { id: 't-ops', name: 'Ops' };
const WT = (id: string, name: string, teamIds: string[], archived = false): WorkTypeWithTeams => ({
  id,
  name,
  archived,
  teamIds,
});

const CATALOG = [
  WT('w-pay', 'Payroll', ['t-eng']),
  WT('w-old', 'Legacy', ['t-eng'], true),
  WT('w-adh', 'adhoc', ['t-eng', 't-ops']),
  WT('w-aud', 'Audit Assist', []),
];

describe('buildCatalogMatrix', () => {
  it('puts active work types first by name (case-insensitive), archived last', () => {
    const m = buildCatalogMatrix(CATALOG, [ENG, OPS]);
    expect(m.rows.map((r) => r.name)).toEqual(['adhoc', 'Audit Assist', 'Payroll', 'Legacy']);
  });

  it('builds one cell per team, checked where the team has selected it', () => {
    const m = buildCatalogMatrix(CATALOG, [ENG, OPS]);
    const adhoc = m.rows.find((r) => r.workTypeId === 'w-adh');
    expect(adhoc?.cells).toEqual([
      { teamId: 't-eng', checked: true },
      { teamId: 't-ops', checked: true },
    ]);
    const audit = m.rows.find((r) => r.workTypeId === 'w-aud');
    expect(audit?.cells.map((c) => c.checked)).toEqual([false, false]);
  });

  it('counts only active selections per team', () => {
    const m = buildCatalogMatrix(CATALOG, [ENG, OPS]);
    expect(m.teams).toEqual([
      { id: 't-eng', name: 'Eng', selectedCount: 2 },
      { id: 't-ops', name: 'Ops', selectedCount: 1 },
    ]);
  });

  it('handles an empty catalog', () => {
    expect(buildCatalogMatrix([], [ENG])).toEqual({
      teams: [{ id: 't-eng', name: 'Eng', selectedCount: 0 }],
      rows: [],
    });
  });
});

describe('teamSaveDiff', () => {
  it('reports what a column save adds and removes, in catalog order', () => {
    const diff = teamSaveDiff(CATALOG, 't-eng', ['w-aud', 'w-adh']);
    expect(diff).toEqual({
      workTypeIds: ['w-adh', 'w-aud'],
      added: ['w-aud'],
      removed: ['w-pay'],
      changed: true,
    });
  });

  it('never sends archived or unknown ids (ruling R5) and never counts them as removed', () => {
    const diff = teamSaveDiff(CATALOG, 't-eng', ['w-old', 'nope', 'w-pay', 'w-adh']);
    expect(diff).toEqual({
      workTypeIds: ['w-pay', 'w-adh'],
      added: [],
      removed: [],
      changed: false,
    });
  });

  it('clearing a column removes every active selection', () => {
    expect(teamSaveDiff(CATALOG, 't-ops', [])).toEqual({
      workTypeIds: [],
      added: [],
      removed: ['w-adh'],
      changed: true,
    });
  });
});

describe('describeTeamSave / describeCounts / teamFormId', () => {
  it('words a save and a no-op', () => {
    expect(describeTeamSave(teamSaveDiff(CATALOG, 't-eng', ['w-aud']), 'Eng')).toBe(
      'Eng: 1 added, 2 removed',
    );
    expect(describeTeamSave(teamSaveDiff(CATALOG, 't-eng', ['w-pay', 'w-adh']), 'Eng')).toBe(
      'No changes for Eng',
    );
  });

  it('words re-sync counts, singular and plural', () => {
    const base = { created: 3, linked: 1, restored: 0, renamed: 2, archived: 0 };
    expect(describeCounts({ projects: 1, ...base })).toBe(
      '1 client checked · 3 created · 1 linked · 0 restored · 2 renamed · 0 archived',
    );
    expect(describeCounts({ projects: 98, ...base })).toMatch(/^98 clients checked/);
  });

  it('gives each team column a stable, distinct form id', () => {
    expect(teamFormId('t-eng')).toBe('work-types-team-t-eng');
    expect(teamFormId('t-eng')).not.toBe(teamFormId('t-ops'));
  });
});

describe('clientRows', () => {
  const P = (id: string, name: string, teamId: string, archived = false): Project => ({
    id,
    teamId,
    name,
    color: null,
    archived,
  });

  it('joins team names and sorts by client name, then team', () => {
    const rows = clientRows(
      [ENG, OPS],
      [P('p1', 'Zeta', 't-eng'), P('p2', 'acme', 't-ops', true), P('p3', 'Acme', 't-eng')],
    );
    expect(rows.map((r) => [r.name, r.teamName, r.archived])).toEqual([
      ['Acme', 'Eng', false],
      ['acme', 'Ops', true],
      ['Zeta', 'Eng', false],
    ]);
  });

  it('labels a project whose team is not in the list', () => {
    expect(clientRows([], [P('p1', 'Lost', 't-gone')])[0]?.teamName).toBe('Unknown team');
  });
});
```

- [ ] **Step 2: Write the failing API-client tests**

Append to `apps/dashboard/src/lib/api-client.spec.ts`:

```ts
describe('api — work types and client import', () => {
  const WT = {
    id: '019797a0-0000-7000-8000-0000000000d1',
    name: 'Payroll',
    archived: false,
  };
  const TEAM = '019797a0-0000-7000-8000-0000000000bb';

  it('listWorkTypes parses the catalog with team ids', async () => {
    const body = [{ ...WT, teamIds: [TEAM] }];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify(body), { status: 200 })),
    );
    expect(await api.listWorkTypes('tok')).toEqual(body);
  });

  it('setTeamWorkTypes PUTs the full set to the team-scoped route', async () => {
    const fetchMock = vi.fn(
      (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ teamId: TEAM, workTypeIds: [WT.id] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.setTeamWorkTypes('tok', TEAM, { workTypeIds: [WT.id] });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain(`/v1/work-types/teams/${TEAM}`);
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ workTypeIds: [WT.id] }));
  });

  it('updateWorkType surfaces a 409 title as an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ title: 'A work type with this name already exists' }), {
            status: 409,
          }),
      ),
    );
    await expect(api.updateWorkType('tok', WT.id, { name: 'payroll' })).rejects.toMatchObject({
      status: 409,
      message: 'A work type with this name already exists',
    });
  });

  it('resyncWorkTypes POSTs and parses the counts', async () => {
    const counts = { projects: 2, created: 1, linked: 0, restored: 0, renamed: 0, archived: 0 };
    const fetchMock = vi.fn(
      (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(counts), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.resyncWorkTypes('tok')).toEqual(counts);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/work-types/resync');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('bulkCreateWorkTypes and bulkCreateProjects parse created + skipped', async () => {
    const wtResult = { created: [WT], skipped: [{ name: 'General', reason: 'Reserved name' }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify(wtResult), { status: 201 })),
    );
    expect(await api.bulkCreateWorkTypes('tok', { names: ['Payroll', 'General'] })).toEqual(
      wtResult,
    );

    const projectResult = {
      created: [
        {
          id: '019797a0-0000-7000-8000-0000000000e1',
          teamId: TEAM,
          name: 'Acme',
          color: '#007aff',
          archived: false,
        },
      ],
      skipped: [{ name: 'globex', reason: 'Duplicate in list' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify(projectResult), { status: 201 })),
    );
    expect(await api.bulkCreateProjects('tok', { teamId: TEAM, names: ['Acme'] })).toEqual(
      projectResult,
    );
  });
});
```

- [ ] **Step 3: Confirm both fail**

Run: `pnpm --filter @timetrack/dashboard test -- catalog-view api-client`
Expected: FAIL. `./catalog-view` cannot be resolved, and `api.listWorkTypes is not a function`.

- [ ] **Step 4: Implement `catalog-view.ts`**

Create `apps/dashboard/src/lib/catalog-view.ts`:

```ts
import type {
  Project,
  ReconcileCounts,
  TeamListItem,
  WorkTypeWithTeams,
} from '@timetrack/contracts';

type TeamRef = Pick<TeamListItem, 'id' | 'name'>;

export type CatalogTeam = { id: string; name: string; selectedCount: number };
export type CatalogCell = { teamId: string; checked: boolean };
export type CatalogRow = {
  workTypeId: string;
  name: string;
  archived: boolean;
  cells: CatalogCell[];
};
export type CatalogMatrix = { teams: CatalogTeam[]; rows: CatalogRow[] };

export type TeamSaveDiff = {
  /** The PUT body: selected, non-archived, known ids, in catalog order. */
  workTypeIds: string[];
  added: string[];
  removed: string[];
  changed: boolean;
};

export type ClientRow = {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  archived: boolean;
};

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** The id that ties a team column's checkboxes (via their `form` attribute) to its Save form. */
export function teamFormId(teamId: string): string {
  return `work-types-team-${teamId}`;
}

/** Rows are work types (active first, then archived; each by name), columns are teams. Pure. */
export function buildCatalogMatrix(
  workTypes: readonly WorkTypeWithTeams[],
  teams: readonly TeamRef[],
): CatalogMatrix {
  const ordered = [...workTypes].sort(
    (a, b) => Number(a.archived) - Number(b.archived) || byName(a, b),
  );
  return {
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      selectedCount: workTypes.filter((w) => !w.archived && w.teamIds.includes(t.id)).length,
    })),
    rows: ordered.map((wt) => ({
      workTypeId: wt.id,
      name: wt.name,
      archived: wt.archived,
      cells: teams.map((t) => ({ teamId: t.id, checked: wt.teamIds.includes(t.id) })),
    })),
  };
}

/**
 * What saving one team column does. Archived and unknown ids are dropped from the PUT body and
 * never count as removed: the server keeps archived links (plan ruling R5). Pure.
 */
export function teamSaveDiff(
  workTypes: readonly WorkTypeWithTeams[],
  teamId: string,
  submitted: readonly string[],
): TeamSaveDiff {
  const active = workTypes.filter((w) => !w.archived);
  const wanted = new Set(submitted);
  const workTypeIds = active.filter((w) => wanted.has(w.id)).map((w) => w.id);
  const current = active.filter((w) => w.teamIds.includes(teamId)).map((w) => w.id);
  const currentSet = new Set(current);
  const added = workTypeIds.filter((id) => !currentSet.has(id));
  const removed = current.filter((id) => !wanted.has(id));
  return { workTypeIds, added, removed, changed: added.length > 0 || removed.length > 0 };
}

export function describeTeamSave(diff: TeamSaveDiff, teamName: string): string {
  if (!diff.changed) return `No changes for ${teamName}`;
  return `${teamName}: ${diff.added.length} added, ${diff.removed.length} removed`;
}

export function describeCounts(c: ReconcileCounts): string {
  const clients = `${c.projects} ${c.projects === 1 ? 'client' : 'clients'} checked`;
  return `${clients} · ${c.created} created · ${c.linked} linked · ${c.restored} restored · ${c.renamed} renamed · ${c.archived} archived`;
}

/** Every client of every team, for the clients table. Pure. */
export function clientRows(teams: readonly TeamRef[], projects: readonly Project[]): ClientRow[] {
  const names = new Map(teams.map((t) => [t.id, t.name] as const));
  return projects
    .map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      teamName: names.get(p.teamId) ?? 'Unknown team',
      archived: p.archived,
    }))
    .sort((a, b) => byName(a, b) || a.teamName.localeCompare(b.teamName));
}
```

- [ ] **Step 5: Implement the API-client calls**

In `apps/dashboard/src/lib/api-client.ts`:

1. Add to the `@timetrack/contracts` import list:

```ts
  WorkTypeSchema,
  WorkTypeListSchema,
  type WorkType,
  type WorkTypeWithTeams,
  BulkCreateWorkTypesResultSchema,
  type BulkCreateWorkTypes,
  type BulkCreateWorkTypesResult,
  type UpdateWorkType,
  TeamWorkTypesSchema,
  type SetTeamWorkTypes,
  type TeamWorkTypes,
  ReconcileCountsSchema,
  type ReconcileCounts,
  BulkCreateProjectsResultSchema,
  type BulkCreateProjects,
  type BulkCreateProjectsResult,
```

2. Widen `send`'s method parameter to `method: 'POST' | 'PATCH' | 'PUT',` and change its doc line to "Authenticated mutating request (POST/PATCH/PUT)".
3. Add to the `api` object, directly after `moveTask`:

```ts
  /** ADMIN-only: the work-type catalog with the teams that selected each entry. */
  listWorkTypes: (token: string): Promise<WorkTypeWithTeams[]> =>
    get('/work-types', WorkTypeListSchema, token),
  bulkCreateWorkTypes: (
    token: string,
    dto: BulkCreateWorkTypes,
  ): Promise<BulkCreateWorkTypesResult> =>
    send('POST', '/work-types/bulk', dto, BulkCreateWorkTypesResultSchema, token),
  updateWorkType: (token: string, id: string, dto: UpdateWorkType): Promise<WorkType> =>
    send('PATCH', `/work-types/${id}`, dto, WorkTypeSchema, token),
  /** The team's full non-archived selection; the API keeps archived links (ruling R5). */
  setTeamWorkTypes: (
    token: string,
    teamId: string,
    dto: SetTeamWorkTypes,
  ): Promise<TeamWorkTypes> =>
    send('PUT', `/work-types/teams/${teamId}`, dto, TeamWorkTypesSchema, token),
  resyncWorkTypes: (token: string): Promise<ReconcileCounts> =>
    send('POST', '/work-types/resync', {}, ReconcileCountsSchema, token),
  /** ADMIN-only client import into one team. */
  bulkCreateProjects: (
    token: string,
    dto: BulkCreateProjects,
  ): Promise<BulkCreateProjectsResult> =>
    send('POST', '/projects/bulk', dto, BulkCreateProjectsResultSchema, token),
```

- [ ] **Step 6: Run the tests and typecheck, and confirm they pass**

Run: `pnpm --filter @timetrack/dashboard test -- catalog-view api-client && pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/lib/api-client.ts apps/dashboard/src/lib/api-client.spec.ts \
  apps/dashboard/src/lib/catalog-view.ts apps/dashboard/src/lib/catalog-view.spec.ts
git commit -m "feat(dashboard): add work type client calls" \
  -m "Adds the catalog view model: the team x work-type matrix and the per-team save diff."
```

---

### Task 7: Dashboard — the `/admin/catalog` page ("Clients & work types")

**Files:**

- Create: `apps/dashboard/src/app/(app)/admin/catalog/page.tsx`
- Create: `apps/dashboard/src/app/(app)/admin/catalog/loading.tsx`
- Create: `apps/dashboard/src/app/(app)/admin/catalog/actions.ts`
- Create: `apps/dashboard/src/app/(app)/admin/catalog/ImportResult.tsx`
- Create: `apps/dashboard/src/app/(app)/admin/catalog/AddWorkTypesForm.tsx`
- Create: `apps/dashboard/src/app/(app)/admin/catalog/TeamColumnSaveForm.tsx`
- Create: `apps/dashboard/src/app/(app)/admin/catalog/RenameWorkTypeForm.tsx`
- Create: `apps/dashboard/src/app/(app)/admin/catalog/WorkTypeArchiveToggle.tsx`
- Create: `apps/dashboard/src/app/(app)/admin/catalog/ImportClientsForm.tsx`
- Create: `apps/dashboard/src/app/(app)/admin/catalog/ResyncButton.tsx`
- Modify: `apps/dashboard/src/components/ui/AdminTabs.tsx` (one tab entry)
- Modify: `apps/dashboard/src/app/(app)/projects/actions.ts` (`moveProjectAction`: one `revalidatePath` line, per ruling R10)

**Interfaces:**

- Consumes:
  - From Task 6: `api.listWorkTypes`, `api.bulkCreateWorkTypes`, `api.updateWorkType`, `api.setTeamWorkTypes`, `api.resyncWorkTypes`, `api.bulkCreateProjects`, plus the existing `api.listTeams` and `api.listProjects`.
  - Also from Task 6: `buildCatalogMatrix`, `teamSaveDiff`, `describeTeamSave`, `describeCounts`, `clientRows` and `teamFormId`.
  - From Task 1: `parseNameList`, `UpdateWorkTypeSchema` and `NameSkip`.
  - Existing: `ProjectTeamMove` from `components/projects/ProjectTeamMove.tsx`, with props `{ id, projectName, teamId, teams }`.
- Produces:
  - The route `/admin/catalog` (ADMIN; everyone else gets the `Forbidden` view).
  - Six server actions, all `(prev: CatalogState, formData: FormData) => Promise<CatalogState>`: `addWorkTypesAction`, `renameWorkTypeAction`, `setWorkTypeArchivedAction`, `saveTeamWorkTypesAction`, `importClientsAction` and `resyncAction`.
  - `CatalogState = { ok: boolean; message?: string; created?: string[]; skipped?: NameSkip[] }`.

There are no new unit tests. The dashboard's vitest runs in node with no DOM. The logic this page relies on (the matrix, the save diff and the wording) is covered in Task 6, and the page is checked in a browser in Task 8.

- [ ] **Step 1: Add the nav entry and the move revalidation**

In `apps/dashboard/src/components/ui/AdminTabs.tsx`, add a tab after Teams:

```ts
  { href: '/admin/teams', label: 'Teams' },
  { href: '/admin/catalog', label: 'Clients & work types' },
  { href: '/admin/audit', label: 'Audit' },
```

In `apps/dashboard/src/app/(app)/projects/actions.ts`, in `moveProjectAction`, add after `revalidatePath(`/projects/${id}`);`:

```ts
// The Clients & work types table moves projects with this same control.
revalidatePath('/admin/catalog');
```

- [ ] **Step 2: Write the server actions**

Create `apps/dashboard/src/app/(app)/admin/catalog/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { UpdateWorkTypeSchema, parseNameList, type NameSkip } from '@timetrack/contracts';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';
import { describeCounts, describeTeamSave, teamSaveDiff } from '../../../../lib/catalog-view';

/** Result of a catalog form, surfaced through useToastAction. */
export interface CatalogState {
  ok: boolean;
  message?: string;
  created?: string[];
  skipped?: NameSkip[];
}

const PATH = '/admin/catalog';

/** ADMIN only (spec §2). The API 403s anyone else too; this keeps the message human. */
async function adminToken(): Promise<string | null> {
  const session = await getSession();
  return session && session.role === 'ADMIN' ? session.accessToken : null;
}

function failure(e: unknown, fallback: string): CatalogState {
  return { ok: false, message: e instanceof ApiError ? e.message : fallback };
}

const text = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

export async function addWorkTypesAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const names = parseNameList(text(formData.get('names')));
  if (names.length === 0) return { ok: false, message: 'Paste at least one name.' };
  if (names.length > 100) {
    return { ok: false, message: `That is ${names.length} names; add at most 100 at a time.` };
  }
  try {
    const result = await api.bulkCreateWorkTypes(token, { names });
    revalidatePath(PATH);
    return {
      ok: true,
      message: `${result.created.length} added, ${result.skipped.length} skipped`,
      created: result.created.map((w) => w.name),
      skipped: result.skipped,
    };
  } catch (e) {
    return failure(e, 'Could not add the work types.');
  }
}

export async function renameWorkTypeAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const id = text(formData.get('id'));
  const parsed = UpdateWorkTypeSchema.safeParse({ name: formData.get('name') });
  if (!id || !parsed.success) return { ok: false, message: 'Enter a name (1–200 characters).' };
  try {
    await api.updateWorkType(token, id, parsed.data);
    revalidatePath(PATH);
    return { ok: true, message: 'Work type renamed' };
  } catch (e) {
    return failure(e, 'Could not rename the work type.');
  }
}

export async function setWorkTypeArchivedAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const id = text(formData.get('id'));
  const archived = text(formData.get('archived')) === 'true';
  if (!id) return { ok: false, message: 'No work type selected.' };
  try {
    await api.updateWorkType(token, id, { archived });
    revalidatePath(PATH);
    return { ok: true, message: archived ? 'Work type archived' : 'Work type restored' };
  } catch (e) {
    return failure(e, archived ? 'Could not archive.' : 'Could not restore.');
  }
}

/**
 * Save one team column. The diff is computed against a FRESH catalog read, so a stale page
 * never re-sends ids someone archived meanwhile (ruling R5); an unchanged column sends nothing.
 */
export async function saveTeamWorkTypesAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const teamId = text(formData.get('teamId'));
  const teamName = text(formData.get('teamName')) || 'Team';
  if (!teamId) return { ok: false, message: 'No team selected.' };
  const submitted = formData.getAll('workTypeId').filter((v): v is string => typeof v === 'string');
  try {
    const diff = teamSaveDiff(await api.listWorkTypes(token), teamId, submitted);
    if (diff.changed) {
      await api.setTeamWorkTypes(token, teamId, { workTypeIds: diff.workTypeIds });
      revalidatePath(PATH);
    }
    return { ok: true, message: describeTeamSave(diff, teamName) };
  } catch (e) {
    return failure(e, `Could not save ${teamName}.`);
  }
}

export async function importClientsAction(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  const teamId = text(formData.get('teamId'));
  if (!teamId) return { ok: false, message: 'Pick a team.' };
  const names = parseNameList(text(formData.get('names')));
  if (names.length === 0) return { ok: false, message: 'Paste at least one client name.' };
  if (names.length > 500) {
    return { ok: false, message: `That is ${names.length} names; import at most 500 at a time.` };
  }
  try {
    const result = await api.bulkCreateProjects(token, { teamId, names });
    revalidatePath(PATH);
    revalidatePath('/projects');
    return {
      ok: true,
      message: `${result.created.length} imported, ${result.skipped.length} skipped`,
      created: result.created.map((p) => p.name),
      skipped: result.skipped,
    };
  } catch (e) {
    return failure(e, 'Could not import the clients.');
  }
}

export async function resyncAction(
  _prev: CatalogState,
  _formData: FormData,
): Promise<CatalogState> {
  const token = await adminToken();
  if (!token) return { ok: false, message: 'Not authorized.' };
  try {
    const counts = await api.resyncWorkTypes(token);
    revalidatePath(PATH);
    return { ok: true, message: describeCounts(counts) };
  } catch (e) {
    return failure(e, 'Re-sync failed.');
  }
}
```

- [ ] **Step 3: Write the client components**

Create `apps/dashboard/src/app/(app)/admin/catalog/ImportResult.tsx`:

```tsx
import type { CatalogState } from './actions';

/** What an import created and skipped (with reasons), or its error. */
export function ImportResult({ state }: { state: CatalogState }) {
  if (!state.ok) {
    return state.message ? (
      <p className="text-destructive text-body" role="status">
        {state.message}
      </p>
    ) : null;
  }
  const created = state.created ?? [];
  const skipped = state.skipped ?? [];
  if (created.length === 0 && skipped.length === 0) return null;
  return (
    <div className="text-caption grid gap-3 sm:grid-cols-2" role="status">
      <div>
        <p className="text-text-secondary mb-1">Created ({created.length})</p>
        <ul className="flex flex-col gap-0.5">
          {created.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-text-secondary mb-1">Skipped ({skipped.length})</p>
        <ul className="flex flex-col gap-0.5">
          {skipped.map((s, i) => (
            <li key={`${i}-${s.name}`}>
              {s.name} <span className="text-text-secondary">— {s.reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

Create `apps/dashboard/src/app/(app)/admin/catalog/AddWorkTypesForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { parseNameList } from '@timetrack/contracts';
import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { addWorkTypesAction, type CatalogState } from './actions';
import { ImportResult } from './ImportResult';

const INITIAL: CatalogState = { ok: false };

/** Paste box for new catalog entries; the count previews exactly what the server will receive. */
export function AddWorkTypesForm() {
  const [text, setText] = useState('');
  const [state, formAction, pending] = useToastAction(
    addWorkTypesAction,
    INITIAL,
    (s) => s.message ?? 'Work types added',
  );
  const count = parseNameList(text).length;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Add work types — one per line</span>
        <textarea
          name="names"
          rows={4}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={'Bookkeeping\nPayroll\nVAT/TAX Filling'}
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        />
      </label>
      <div>
        <Button type="submit" variant="secondary" disabled={pending || count === 0}>
          {pending ? 'Adding…' : `Add ${count} ${count === 1 ? 'work type' : 'work types'}`}
        </Button>
      </div>
      <ImportResult state={state} />
    </form>
  );
}
```

Create `apps/dashboard/src/app/(app)/admin/catalog/TeamColumnSaveForm.tsx`:

```tsx
'use client';

import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { saveTeamWorkTypesAction, type CatalogState } from './actions';

const INITIAL: CatalogState = { ok: false };

/**
 * The Save for one team column. The column's checkboxes live in the table body and join this
 * form through their `form` attribute, so each column saves as its own PUT without the whole
 * table becoming one form.
 */
export function TeamColumnSaveForm({
  formId,
  teamId,
  teamName,
}: {
  formId: string;
  teamId: string;
  teamName: string;
}) {
  const [state, formAction, pending] = useToastAction(
    saveTeamWorkTypesAction,
    INITIAL,
    (s) => s.message ?? `${teamName} saved`,
  );
  return (
    <form id={formId} action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="teamName" value={teamName} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : `Save ${teamName}`}
      </Button>
      {!state.ok && state.message ? (
        <p className="text-destructive text-caption" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
```

Create `apps/dashboard/src/app/(app)/admin/catalog/RenameWorkTypeForm.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { renameWorkTypeAction, type CatalogState } from './actions';

const INITIAL: CatalogState = { ok: false };

/** Inline rename, idle until clicked — the RenameTeamForm pattern (see its comments). */
export function RenameWorkTypeForm({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useToastAction(
    renameWorkTypeAction,
    INITIAL,
    'Work type renamed',
  );
  const [editing, setEditing] = useState(false);

  // Collapse once the server sends back a different name, so the next open shows the new one.
  useEffect(() => {
    setEditing(false);
  }, [name]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-label text-text-secondary hover:text-text cursor-pointer transition-colors"
      >
        Rename
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="name"
        defaultValue={name}
        required
        maxLength={200}
        aria-label={`New name for ${name}`}
        className="bg-surface border-separator text-text focus:border-accent text-label w-44 rounded-md border px-2.5 py-1.5 outline-none transition-colors"
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-label text-text-secondary hover:text-text cursor-pointer transition-colors"
      >
        Cancel
      </button>
      {state.message && !state.ok ? (
        <p className="text-destructive text-caption w-full text-right" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
```

Create `apps/dashboard/src/app/(app)/admin/catalog/WorkTypeArchiveToggle.tsx`:

```tsx
'use client';

import { useToastAction } from '../../../../components/ui/useToastAction';
import { setWorkTypeArchivedAction, type CatalogState } from './actions';

const INITIAL: CatalogState = { ok: false };

/**
 * Archive hides the work type from every client's picker (its rows archive, never delete);
 * Restore brings the same rows back for the teams that still have it selected.
 */
export function WorkTypeArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  const [state, formAction, pending] = useToastAction(
    setWorkTypeArchivedAction,
    INITIAL,
    (s) => s.message ?? 'Saved',
  );
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="text-label text-text-secondary hover:text-text cursor-pointer transition-colors disabled:opacity-50"
      >
        {archived ? 'Restore' : 'Archive'}
      </button>
      {!state.ok && state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
```

Create `apps/dashboard/src/app/(app)/admin/catalog/ImportClientsForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { parseNameList } from '@timetrack/contracts';
import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { importClientsAction, type CatalogState } from './actions';
import { ImportResult } from './ImportResult';

const INITIAL: CatalogState = { ok: false };

/** Paste clients, pick their team, preview the count, import (spec §8.2). */
export function ImportClientsForm({ teams }: { teams: { id: string; name: string }[] }) {
  const [text, setText] = useState('');
  const [state, formAction, pending] = useToastAction(
    importClientsAction,
    INITIAL,
    (s) => s.message ?? 'Clients imported',
  );
  const count = parseNameList(text).length;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Import clients — one per line, or paste a table</span>
        <textarea
          name="names"
          rows={6}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-body flex flex-col gap-1">
          <span className="text-text-secondary">Team</span>
          <select
            name="teamId"
            required
            defaultValue=""
            className="bg-surface border-separator text-text focus:border-accent text-label rounded-md border px-2 py-1.5 outline-none transition-colors"
          >
            <option value="" disabled>
              Pick a team
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" disabled={pending || count === 0}>
          {pending ? 'Importing…' : `Import ${count} ${count === 1 ? 'client' : 'clients'}`}
        </Button>
      </div>
      <ImportResult state={state} />
    </form>
  );
}
```

Create `apps/dashboard/src/app/(app)/admin/catalog/ResyncButton.tsx`:

```tsx
'use client';

import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { resyncAction, type CatalogState } from './actions';

const INITIAL: CatalogState = { ok: false };

/** The safety net (spec §8.3, §9): re-applies every team's work types to every client. */
export function ResyncButton() {
  const [state, formAction, pending] = useToastAction(
    resyncAction,
    INITIAL,
    (s) => s.message ?? 'Re-synced',
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Re-syncing…' : 'Re-sync all clients'}
      </Button>
      {state.message ? (
        <span
          className={`text-caption ${state.ok ? 'text-text-secondary' : 'text-destructive'}`}
          role="status"
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 4: Write the page and its loading state**

Create `apps/dashboard/src/app/(app)/admin/catalog/loading.tsx`:

```tsx
import { PageSkeleton } from '../../../../components/ui/Skeleton';

export default function Loading() {
  return <PageSkeleton />;
}
```

Create `apps/dashboard/src/app/(app)/admin/catalog/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../../lib/redirect';
import { Forbidden } from '../../../../components/ui/Forbidden';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { AdminTabs } from '../../../../components/ui/AdminTabs';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { ProjectTeamMove } from '../../../../components/projects/ProjectTeamMove';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { buildCatalogMatrix, clientRows, teamFormId } from '../../../../lib/catalog-view';
import { AddWorkTypesForm } from './AddWorkTypesForm';
import { TeamColumnSaveForm } from './TeamColumnSaveForm';
import { RenameWorkTypeForm } from './RenameWorkTypeForm';
import { WorkTypeArchiveToggle } from './WorkTypeArchiveToggle';
import { ImportClientsForm } from './ImportClientsForm';
import { ResyncButton } from './ResyncButton';

/**
 * Clients & work types (spec §8). ADMIN only. The catalog is a work-type × team matrix — each
 * team picks the kinds of work it does, and every client of that team shows exactly those —
 * plus the client import and the re-sync safety net. Nothing here changes the desktop apps:
 * the server materializes the selections as ordinary subprojects.
 */
export default async function AdminCatalogPage() {
  const session = await getSession();
  // Not `return null` — see admin/teams/page.tsx for why every page gates on its own.
  if (!session) redirect(refreshBackTo('/admin/catalog'));
  if (session.role !== 'ADMIN') return <Forbidden />;

  const token = session.accessToken;
  const [workTypes, teams] = await Promise.all([api.listWorkTypes(token), api.listTeams(token)]);
  // One call per team, in parallel (spec §8.2): GET /projects is team-scoped by design.
  const projectsByTeam = await Promise.all(
    teams.map((t) => api.listProjects(token, { includeArchived: true, teamId: t.id })),
  );
  const matrix = buildCatalogMatrix(workTypes, teams);
  const clients = clientRows(teams, projectsByTeam.flat());
  const teamName = new Map(teams.map((t) => [t.id, t.name] as const));

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />

      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <h2 className="text-text text-[15px] font-semibold">Work types</h2>
          <p className="text-text-secondary text-caption max-w-[70ch]">
            Tick the work types each team does, then save that team&apos;s column. Every client of
            the team gets them as subprojects; unticking archives them (their hours are kept).
          </p>

          <Card padding="none" className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>Work type</Th>
                  {matrix.teams.map((t) => (
                    <Th key={t.id}>
                      {t.name} <span className="tt-numeric">({t.selectedCount})</span>
                    </Th>
                  ))}
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <Tbody>
                {matrix.rows.map((row) => (
                  <Tr key={row.workTypeId}>
                    <Td>
                      <span className={row.archived ? 'text-text-secondary' : ''}>{row.name}</span>
                      {row.archived ? (
                        <span className="ml-2">
                          <Badge tone="neutral">Archived</Badge>
                        </span>
                      ) : null}
                    </Td>
                    {row.cells.map((cell) => (
                      <Td key={cell.teamId}>
                        <input
                          type="checkbox"
                          name="workTypeId"
                          value={row.workTypeId}
                          form={teamFormId(cell.teamId)}
                          defaultChecked={cell.checked}
                          disabled={row.archived}
                          aria-label={`${row.name} for ${teamName.get(cell.teamId) ?? 'team'}`}
                          className="accent-accent h-4 w-4"
                        />
                      </Td>
                    ))}
                    <Td align="right">
                      <div className="flex items-center justify-end gap-4">
                        <RenameWorkTypeForm id={row.workTypeId} name={row.name} />
                        <WorkTypeArchiveToggle id={row.workTypeId} archived={row.archived} />
                      </div>
                    </Td>
                  </Tr>
                ))}
                {matrix.rows.length > 0 ? (
                  <Tr>
                    <Td>
                      <span className="text-text-secondary text-caption">Save a column</span>
                    </Td>
                    {matrix.teams.map((t) => (
                      <Td key={t.id}>
                        <TeamColumnSaveForm
                          formId={teamFormId(t.id)}
                          teamId={t.id}
                          teamName={t.name}
                        />
                      </Td>
                    ))}
                    <Td>{null}</Td>
                  </Tr>
                ) : null}
              </Tbody>
            </Table>
          </Card>

          <AddWorkTypesForm />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-text text-[15px] font-semibold">Clients</h2>
          <ImportClientsForm teams={teams.map((t) => ({ id: t.id, name: t.name }))} />

          <Card padding="none" className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>Client</Th>
                  <Th>Team</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <Tbody>
                {clients.map((c) => (
                  <Tr key={c.id}>
                    <Td>{c.name}</Td>
                    <Td>
                      {teams.length < 2 ? (
                        c.teamName
                      ) : (
                        <ProjectTeamMove
                          id={c.id}
                          projectName={c.name}
                          teamId={c.teamId}
                          teams={teams}
                        />
                      )}
                    </Td>
                    <Td>
                      {c.archived ? (
                        <Badge tone="neutral">Archived</Badge>
                      ) : (
                        <Badge tone="good">Active</Badge>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-text text-[15px] font-semibold">Re-sync</h2>
          <p className="text-text-secondary text-caption max-w-[70ch]">
            Re-applies every team&apos;s work types to every client. Safe to run at any time; a
            second run changes nothing.
          </p>
          <ResyncButton />
        </section>
      </div>
    </>
  );
}
```

The section headings use `text-text text-[15px] font-semibold`, which is the `<h2>` style already used in `admin/settings/SettingsForm.tsx`.

- [ ] **Step 5: Typecheck, lint, test and build the dashboard**

Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard lint && pnpm --filter @timetrack/dashboard test && pnpm --filter @timetrack/dashboard build`
Expected: all PASS, and the build output lists `/admin/catalog` as a dynamic route. `exactOptionalPropertyTypes` errors show up only here, not under vitest. If one appears, conditionally spread the key rather than passing `undefined`.

- [ ] **Step 6: Commit**

```bash
git add "apps/dashboard/src/app/(app)/admin/catalog" \
  apps/dashboard/src/components/ui/AdminTabs.tsx \
  "apps/dashboard/src/app/(app)/projects/actions.ts"
git commit -m "feat(dashboard): add the Clients & work types admin page"
```

---

### Task 8: Final verification and a browser check

**Files:** none new. This task only fixes whatever the checks surface, inside the files earlier tasks touched.

**Interfaces:** consumes everything above and produces nothing new.

- [ ] **Step 1: Run the whole-repo gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. Paste the tail of each output into the PR description later. Never claim a pass you didn't see.

- [ ] **Step 2: Run the coverage gates**

Run: `pnpm --filter @timetrack/contracts test:coverage && RUN_E2E=1 pnpm --filter @timetrack/api test:coverage`
Expected: both ≥ 80%. Contracts binds on branches and the API on functions. If a gate misses, add tests for the uncovered code this plan added. Don't lower a threshold, and don't exclude a file.

- [ ] **Step 3: Run the full API e2e suite once more**

Run: `RUN_E2E=1 pnpm --filter @timetrack/api test:e2e`
Expected: every spec passes, including the new `work-types`, `projects-work-types` and `app-bootstrap` specs.

- [ ] **Step 4: Check the flow in a browser on the local stack**

This is the repo's bar: green tests are not enough.

1. Kill any stale dev processes first: `pnpm dev` survives Ctrl-C, and a stale API on :3001 serves pre-change code, which the UI shows as a silent Zod parse failure.
2. Then run `pnpm infra:up && pnpm db:deploy && pnpm dev`. `DASHBOARD_SESSION_SECRET` must reach the Next process, or login bounces back to `/login`.
3. Log in as an ADMIN with at least two teams, and check each of these:
   - **Nav:** `/admin/catalog` shows the "Clients & work types" tab.
   - **Work types paste:** paste the Task 1 fixture's first four lines. The preview count is 13: the `Sub-Project — 12 options` header plus the 12 work types (ruling R2). Delete the header line, add, and confirm the created and skipped lists.
   - **Team column:** tick three work types for one team and save its column. `/projects?teamId=<that team>` then shows each client with General plus those three.
   - **Archive and restore:** archive one work type, save the column again, then Restore it. The same rows come back, and the time on them is intact.
   - **Client import:** paste the table part of the fixture (from `┌` down) into Clients with a team selected. The preview count is 14. Import it. Then import the same paste again: every name comes back skipped with `Already exists in <team>`.
   - **Move:** move one client to the other team from the clients table. The table updates, and its work types swap.
   - **Re-sync:** click it twice. The second message reads `… 0 created · 0 linked · 0 restored · 0 renamed · 0 archived`.
   - **Forbidden:** log in as a MANAGER. `/admin/catalog` renders the Forbidden view.
4. If the browser route is blocked (the Chrome extension on localhost, or Playwright unable to fetch Chromium), drive the same flow through the API with `curl` against `http://localhost:3001/v1` using an admin bearer token. **Report in the PR that the visual check is unconfirmed.**

- [ ] **Step 5: Push, open the PR and hand off**

1. Run `gh auth status`. The active account must be the work account `rashedulhasannifty`.
2. Run `git push -u origin feat/team-work-types`, then `gh pr create --base main`.
   - Title: `feat(api): team work types and the client catalog`.
   - Body: what changed, the rulings list, the pasted gate outputs and the result of the browser check.
   - **No AI attribution anywhere.**
3. **Do not merge.** Hand the merge to the user.

---

## Self-review against the spec (done while writing; kept for the executor)

| Spec item                                                                                                                                       | Where                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §4 models, the two raw indexes, reserved General                                                                                                | Task 2; the General 409 is in Task 4 (service + e2e)                                                                                                   |
| §5 rules 1–4, the `work_type.reconcile` audit, `RECONCILE_TX`                                                                                   | Task 3 (planner + e2e); timeouts used in Tasks 4 and 5                                                                                                 |
| §5 triggers: selection, rename/archive/restore, create, bulk, setTeam, re-sync                                                                  | Task 4 (selection, update, resync); Task 5 (create, bulk, setTeam)                                                                                     |
| §5 guard rails: 409 on a linked PATCH, 409 on a duplicate POST                                                                                  | Task 5c                                                                                                                                                |
| §6 five work-type routes and `POST /projects/bulk` with limits and skip reasons                                                                 | Tasks 1, 4 and 5b                                                                                                                                      |
| §7 `parseNameList` and `normalizeName` on the literal table                                                                                     | Task 1                                                                                                                                                 |
| §8 page: matrix with per-team Save, rename, archive/restore, paste-add, client import with preview, clients table with move, re-sync, nav entry | Task 7 (using `ProjectTeamMove`, per R10)                                                                                                              |
| §9 additive migration; re-sync repairs the deploy window                                                                                        | Task 2; Task 4 e2e `re-sync repairs a project made by old code`                                                                                        |
| §10 every listed test                                                                                                                           | parse: Task 1. Reconcile: Tasks 3, 4 and 5a. Guard rails and 403s: Tasks 4 and 5. Bulk: Task 5b. Picker contract: Task 5c. Dashboard transform: Task 6 |
