# Shared clients: design

**Status:** approved in conversation on 2026-09-30.
**Builds on:** team work types and the client catalog (#249).

## 1. Problem

A client (a **project**) belongs to exactly one team through `projects.teamId`. Some clients are served by more than one team: "Acme" is worked on by both Design and Dev. Today the only option is a separate copy per team, so nobody can see Acme's total and the copies drift apart.

## 2. Decisions from the conversation

| Question                                         | Answer                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What "shared" means                              | **One client record, linked to several teams.** Its total time is split by team.                                                                                                                                                           |
| Work types on a shared client                    | **The union** of every linked team's work types. A Design employee may see Dev's work types under a shared client. No per-viewer filtering.                                                                                                |
| Which team a person's time counts toward         | **The team they were in when they tracked it.** The server stamps it on the time entry. Moving a person later does not move their history.                                                                                                 |
| Who may change a shared client                   | **ADMIN only** for share, unshare, archive and recolor (projects have no rename; move is already ADMIN-only). A manager keeps full control of a client that only their team uses, and may still add subprojects and tasks to a shared one. |
| May a manager see other teams' part of the split | **Yes.** A manager sees every team's total on a shared client they can see, but the per-member list shows only their own team's people (§5.6).                                                                                             |

## 3. Approach: home team plus a link table

`projects.teamId` stays and becomes the client's **home team**: non-null, unchanged in `/v1`. A new `project_teams` table lists **every** team linked to the client, the home team included. Everything that decides **who can use a client** reads `project_teams`.

**Constraint that forces this:** both shipped desktop apps decode `Project.teamId` as a required string (`apps/client-macos/Sources/TimeTrack/Projects/Project.swift`, `apps/client-windows/src/NiftyTimer/Projects/Project.cs`). `/v1` must keep sending exactly one `teamId` per project. **No desktop release is needed.**

Rejected:

- **Link table only, drop `projects.teamId`.** A deploy migrates before the PM2 reload and a rollback does not undo schema, so old code would run against a missing column. The response's `teamId` would also have to be invented per caller.
- **One copy per team, grouped by name in reports.** This is not one client: renames, archives and work types diverge.

## 4. Data model

```prisma
model Project {
  // … unchanged; teamId is now the HOME team
  teams ProjectTeam[]
}

/// Every team that may use a project, the home team (projects.teamId) included.
/// Invariant: (project.id, project.teamId) always has a row. The repository keeps it on
/// create, bulk import, move, and set-teams, inside the same transaction.
model ProjectTeam {
  projectId String
  teamId    String
  project   Project @relation(fields: [projectId], references: [id])
  team      Team    @relation(fields: [teamId], references: [id])

  @@id([projectId, teamId])
  @@index([teamId])
  @@map("project_teams")
}

model TimeEntry {
  // …
  /// The user's team when the entry was FIRST inserted, set by a BEFORE INSERT trigger
  /// (time_entries_stamp_team) from users."teamId". Only the runaway trim copies it onto split pieces, so a later upsert
  /// or edit can never change it. No FK, like projectId. Trigger is invisible to Prisma's diff.
  teamId String?
}
```

The migration (hand-authored; `migrate dev` needs a TTY here):

1. Create `project_teams`, backfill `INSERT INTO project_teams SELECT id, "teamId" FROM projects`.
2. Add `time_entries."teamId"`, backfill from `users."teamId"` by `userId`.
3. Create the `BEFORE INSERT` trigger that fills `NEW."teamId"` from `users` when it is null. It covers every insert path (sync, manual, seed), and because a deploy migrates before the reload it also covers old code in the deploy window.
4. Index `time_entries ("projectId", "teamId")` for the split query.

A client is **shared** when it has more than one `project_teams` row.

## 5. API (additive; `/v1` unbroken)

### 5.1 Reads

- `GET /v1/projects` for a team lists projects **linked** to it (`project_teams`), not those whose home is it. The rules for which `teamId` a caller may ask for are unchanged, and so is `allTeams` (ADMIN).
- `ProjectSchema` gains `teamIds: z.array(z.uuid()).optional()`, the linked teams, home first. Shipped clients ignore unknown fields.

### 5.2 Authorization

`ProjectsService` authorization splits into two checks:

- **Use** (subprojects, tasks): ADMIN; or MANAGER whose team is linked.
- **Own** (archive, recolor): ADMIN; or MANAGER whose team is linked **and** the client is not shared.

A MANAGER archiving or recoloring a shared client gets **403** with the title "Only an admin can change a shared client". Move stays ADMIN-only as today.

### 5.3 Share and unshare

`PUT /v1/projects/:id/teams` (ADMIN), body `{ teamIds: uuid[] }` (strict, 1–100 unique ids): the **full** set of linked teams.

- Must contain the home team, otherwise **422**. Unknown team id → **422**.
- One transaction: replace the rows, write an `AuditLog` row (`project_teams_set`, diff `{ from, to }`), reconcile the project (§5.4).
- Returns the project with `teamIds`.

Unsharing a team leaves that team's past entries on the client (they keep their `teamId`) and removes the client from that team's picker.

### 5.4 Reconcile

`planReconcile` takes each project's **list** of linked team ids. Desired work types = the union of those teams' selections, de-duplicated by work type id. Rules 1–4 (restore, adopt, create, archive) are unchanged, so an unshare archives only the work types no remaining team selects.

Triggers that reconcile gain:

- `PUT /projects/:id/teams`, for that project.
- A team's work-type selection change reconciles every project **linked** to the team (not only those it is home to).
- Move: the old home's link row is deleted and the new home's is inserted (skip if present); other links stay. To keep the old team, share it afterwards. Then reconcile.

Every write that changes links does so **before** calling reconcile in the same transaction, because reconcile reads `project_teams`.

### 5.5 Stamping `time_entries.teamId`

The trigger (§4) does it for every insert. It reads the **target** user's team from the database, not the caller's JWT (which can be stale, and is the manager's for a manual entry filed on someone's behalf).

Sync stays lenient: an entry for a client the user's team is not linked to is still stored (today's behaviour).

### 5.6 Split on the client detail

`GET /v1/projects/:id/detail` (dashboard-only) gains two required fields on `ProjectDetailSchema`:

- `teamIds: uuid[]`, home first.
- `byTeam: { teamId: uuid | null, teamName: string, trackedSeconds: int }[]`, grouped on `te."teamId"`; `null` → "Unassigned".

`totalSeconds` becomes the sum of `byTeam` (it was the sum of `members`).

**Members on a shared client:** for a MANAGER, `members` is filtered to entries with `te."teamId" = actor.teamId`, so it adds up to their own `byTeam` row. An ADMIN sees every member. Trend, tasks, subprojects and top apps stay whole-client aggregates. The reports `/reports/projects` summary is unchanged.

## 6. Dashboard

- **`/admin/catalog`:** each client row shows its teams (home first) and a **Shared** badge when there are 2+. ADMIN **Share…** opens a multi-select of teams, with the home team fixed, and calls `PUT /projects/:id/teams`. Team-column views group by `teamIds`, so a shared client appears under each linked team.
- **`/projects` and `/projects/[projectId]`:** the Shared badge. Archive and recolor are hidden for a MANAGER on a shared client (the API's 403 is the real guard). The detail page shows a per-team split table under the total when `byTeam` has more than one row.

## 7. Out of scope

- Switching the existing team, person and "tracking now" reports to `te."teamId"`. They keep scoping by the user's current team.
- Per-viewer filtering of work types on a shared client.
- Any desktop client change.

## 8. Rollout

1. Deploy the API and dashboard. No desktop release.
2. Press **Re-sync** on `/admin/catalog` once.
3. Entries need no repair: the trigger fills `teamId` even for old code. Old code creating a project between migrate and reload skips its `project_teams` row. Repair (idempotent, psql), after deploy and again after any rollback followed by a redeploy:

   ```sql
   INSERT INTO project_teams ("projectId", "teamId")
   SELECT p.id, p."teamId" FROM projects p
   ON CONFLICT DO NOTHING;
   ```

## 9. Testing

- **Unit:** `planReconcile` builds the union across teams, and unsharing archives only work types no remaining team selects.
- **API e2e (real Postgres):**
  - set-teams writes an audit row and returns `teamIds`
  - the home team can't be removed (422)
  - set-teams returns 403 for MANAGER and EMPLOYEE
  - a MANAGER's archive or recolor of a shared client returns 403, and the same actions on an unshared client return 200
  - the picker lists a shared client for both teams
  - a MANAGER of a linked, non-home team can add a subproject
  - a synced entry gets `teamId`, and a later upsert doesn't change it after the user moves team
  - `byTeam` sums to the total
  - a MANAGER of a non-home linked team sees only their own team's members
  - a team's selection change reaches a shared client it is not home to
- **Contracts:** new optional fields and the set-teams body (strict, home required at the API).
- **Dashboard:** vitest on the view-transforms, and a browser pass on the local stack: share a client, check both pickers, track under each, check the split.
