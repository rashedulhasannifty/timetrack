# Team work types and the client catalog: design

**Status:** approved in conversation on 2026-09-29.
**Builds on:** subprojects Phase 1 (#247) and the client pickers in Phase 2 (#248).

## 1. Problem

The org has about 98 clients (a client is a **project**) and 12 kinds of work (Bookkeeping, Payroll, VAT/TAX Filling and so on, which are **subprojects**). Today each subproject is created by hand on each project. Giving every client all 12 work types would mean about 1,200 rows to manage one by one, and every desktop picker would show all of them. Teams need to see only their own clients and only the work types they actually do.

## 2. Decisions from the conversation

| Question                    | Answer                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Client ↔ team               | **One team per client.** This is today's model, so the `Project.teamId` column is unchanged.                                          |
| How work types are narrowed | **Per team.** There is one global catalog, and each team picks the work types it does. Every client of that team shows exactly those. |
| Getting the 98 clients in   | **Paste a list** on a global admin page, and pick the team at the same time.                                                          |
| "General"                   | **Kept.** Every client still has its default General subproject.                                                                      |
| Who manages it              | **ADMIN only**, for the catalog, the per-team selection and the client import.                                                        |

## 3. Approach: materialized subprojects

For every enabled work type, the server keeps one ordinary `Subproject` row on each of the team's projects, linked back to the catalog entry.

Nothing the desktop apps read changes. That covers `GET /v1/projects`, the `subprojects[]` and `tasks[]` shapes, and time-entry sync. **Mac 0.7.0 and Windows 0.3.0 need no new release.** Reports, the day view, and the rule that the server sets `subprojectId` only when it creates a time entry are all unchanged.

Two approaches were rejected:

- **Global subprojects referenced directly by entries.** This breaks `/v1` and the clients that have already shipped.
- **A one-off "copy to all clients" action.** Renames and removals would never propagate.

## 4. Data model

```prisma
model WorkType {
  id          String         @id @default(uuid(7))
  name        String
  archived    Boolean        @default(false)
  teams       TeamWorkType[]
  subprojects Subproject[]
  @@map("work_types")
}

model TeamWorkType {
  teamId     String
  workTypeId String
  team       Team     @relation(fields: [teamId], references: [id])
  workType   WorkType @relation(fields: [workTypeId], references: [id])
  @@id([teamId, workTypeId])
  @@map("team_work_types")
}

// Subproject gains:
  workTypeId String?
  workType   WorkType? @relation(fields: [workTypeId], references: [id])
```

Two raw-SQL indexes are hand-authored in the migration. Prisma can't diff either of them; see the memory note on partial indexes.

- `work_types_name_ci_unique` is a unique index on `lower(name)`. Catalog names are unique regardless of case.
- `subprojects_one_per_work_type` is a partial unique index on `("projectId", "workTypeId") WHERE "workTypeId" IS NOT NULL`. A project never gets the same work type twice.

`General` (the `DEFAULT_SUBPROJECT_NAME`) is a reserved name, so the catalog can't contain it (409). General subprojects and hand-made subprojects keep `workTypeId = null`.

## 5. Reconcile: the single sync rule

`reconcile(tx, projectIds)` runs inside the transaction of every trigger:

| Trigger                                               | Projects reconciled                    |
| ----------------------------------------------------- | -------------------------------------- |
| A team's selection is saved                           | all of that team's projects            |
| A work type is renamed, archived or restored          | all projects of every team that has it |
| A project is created, one at a time or by bulk import | that project                           |
| A project is moved to another team (`setTeam`)        | that project                           |
| **Re-sync** (admin button)                            | every project                          |

For each project, the **desired** set is the non-archived work types selected by the project's current team.

1. **A desired work type with a linked row:** unarchive the row if it is archived, and rename it if its name differs from the catalog name. The same row id is reused, so its time history stays attached.
2. **A desired work type with no linked row, but an unlinked non-default subproject of the same name (case-insensitive):** link that row by setting `workTypeId`, and unarchive and rename it to the catalog spelling. This adopts subprojects made by hand since Phase 1 went live, instead of duplicating them.
3. **A desired work type with no row at all:** create it with `createMany`.
4. **A linked row that is no longer desired:** archive it. It is **never deleted**, so reports keep the history. A timer running on it keeps running, because the server doesn't rewrite an entry's subproject, and the clients' resolver already falls back to General for anything new.

Each reconcile call writes a single `AuditLog` row: action `work_type.reconcile`, with a diff of `{ trigger, projects, created, linked, restored, renamed, archived }`.

Transactions that reconcile many projects pass an explicit `{ timeout: 60_000, maxWait: 10_000 }`, because the default 5-second timeout isn't enough (see the memory note on Prisma transaction timeouts).

**Linked subprojects are managed centrally.**

- `PATCH /v1/projects/subprojects/:id` returns 409 for any rename or archive of a row whose `workTypeId` is set, with the message "Managed by the work type catalog".
- `POST /v1/projects/subprojects` returns 409 when the project already has a non-archived subproject of that name, compared case-insensitively.

## 6. API (ADMIN only, new `work-types` module)

| Route                              | Body / result                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/work-types`               | `WorkTypeWithTeams[]` = `{ id, name, archived, teamIds: uuid[] }`, sorted by name                                                                                |
| `POST /v1/work-types/bulk`         | `{ names: string[] }` (1–100 names) → `{ created: WorkType[], skipped: { name, reason }[] }`                                                                     |
| `PATCH /v1/work-types/:id`         | `{ name?, archived? }` (at least one) → `WorkType`, then reconciles                                                                                              |
| `PUT /v1/work-types/teams/:teamId` | `{ workTypeIds: uuid[] }` (the full set, max 100) → `{ teamId, workTypeIds }`, then reconciles. 404 if the team or any id is unknown; 422 if any id is archived. |
| `POST /v1/work-types/resync`       | empty body → `{ projects, created, linked, restored, renamed, archived }`                                                                                        |

The projects module gains one route:

| Route                            | Body / result                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /v1/projects/bulk` (ADMIN) | `{ teamId, names: string[] }` (1–500 names) → `{ created: Project[], skipped: { name, reason }[] }` |

Bulk project import:

- Each created project gets General, a palette colour assigned in turn, and a reconcile.
- The whole import runs in one transaction.
- A name that already exists **anywhere in the org** (case-insensitive) is skipped with the reason `Already exists in <team name>`. Duplicates within the pasted list are skipped with the reason `Duplicate in list`.

The single-project `POST /v1/projects` also reconciles, so a manager who creates a client still gets the team's work types.

## 7. Parsing a pasted list (contracts, pure)

`parseNameList(text): string[]` lives in `packages/contracts`, and both the dashboard preview and the API use it.

- It decodes HTML entities (`&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, and numeric forms) and turns a stray `&` before an entity into a plain `&`. For example, `Clean Up &&nbsp; Catch Up` becomes `Clean Up & Catch Up`.
- It treats U+00A0 as a space.
- It splits on newlines, tabs, `│` and `|` (table columns), and `·` (a middle dot with spaces around it).
- It drops runs made only of box-drawing characters, spaces or dashes. This covers table borders such as `┌───┬`.
- It trims, collapses internal whitespace, and drops empty strings.
- It de-duplicates case-insensitively, keeping the first spelling.

It does **not** split on `/` or `,`, because names like `ITR/STTR/CTR` and `Sellcrowd Technology Ltd.` must survive intact. `normalizeName(s)` is exported for single names.

## 8. Dashboard: `/admin/catalog` ("Clients & work types", ADMIN)

1. **Work types.**
   - The catalog is shown as a table: rows are work types, columns are teams, and each cell is a checkbox. Each team column has its own **Save** button, which sends a PUT for that team.
   - Each row has **Rename** and **Archive/Restore**.
   - A paste box ("one per line") adds work types, then lists what was created and what was skipped.
2. **Clients.**
   - A paste box plus a team select runs an import. A preview count comes from `parseNameList` before submitting. Afterwards, the created and skipped lists are shown with reasons.
   - Below that is a table of every client in every team: name, team (with the existing `ProjectTeamPicker` to move it) and archived state. It is filled by calling `listProjects` once per team in parallel.
3. **Re-sync** button. It shows the counts it returns, and is the safety net for the deploy window.

A nav entry is added beside the other admin pages. There are no changes to the Projects page or the desktop clients.

## 9. Deploy

- The migration is additive: new tables, a nullable column, and indexes.
- If old code runs during the deploy window, it can create a project that has no work-type subprojects. **Re-sync** repairs that from the dashboard, so no psql repair script is needed.

## 10. Testing

Tests use Vitest, and the API e2e tests use a real Postgres. Required coverage:

**`parseNameList`:** a unit test on the literal pasted table, covering:

- `&nbsp;` entities;
- `│` columns and border lines;
- `·` separators;
- `ITR/STTR/CTR` kept whole;
- case-insensitive de-duplication.

**Reconcile (e2e):**

- enabling a work type creates rows on every one of the team's projects;
- disabling archives them;
- re-enabling restores the **same id**;
- renaming a work type renames the linked rows;
- archiving a work type archives its rows;
- moving a project to another team swaps its work types;
- a same-named hand-made subproject is linked, not duplicated;
- re-sync is idempotent (a second run returns all zeros).

**Guard rails (e2e):**

- 409 on renaming or archiving a linked subproject;
- 409 on a duplicate subproject name;
- 409 on a catalog name "General" and on a case-insensitive duplicate;
- 403 for MANAGER and EMPLOYEE on every new route;
- 404 or 422 on a bad team selection.

**Bulk import (e2e):**

- skip reasons for an org-wide existing name and for an in-list duplicate;
- every created project has General plus the team's work types.

**Picker contract:** as an EMPLOYEE, `GET /v1/projects` returns only the team's projects, with General plus the enabled work types.

**Dashboard:** unit tests for the pure view transform that builds the team × work-type matrix and computes the per-team save diff.

## 11. Out of scope

- Per-client overrides of the team's work types.
- Assigning a client to several teams.
- Hiding General.
- Import by CSV.
- Any change to the desktop clients.
