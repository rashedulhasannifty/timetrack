# Admin all-teams picker: design

**Status:** approved in conversation on 2026-10-08.
**Builds on:** shared clients (`2026-09-30-shared-clients-design.md`) and the `allTeams` list query.

## 1. Problem

An ADMIN belongs to one team like everyone else. Both desktop clients call `GET /v1/projects` with no query, so the API scopes the list to the caller's own team (`ProjectsService.resolveTeam`), and an admin's picker shows only their own team's clients. Admins also work on other teams' clients and cannot pick them.

## 2. Decisions from the conversation

| Question                                 | Answer                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who gets the wider picker                | **ADMIN only.** EMPLOYEE and MANAGER pickers are unchanged.                                                                                                                                                                                |
| How teams are separated                  | **One grouped list.** A header per team: the admin's own team first ("My team (Name)"), then every other team A→Z. Search covers every section.                                                                                            |
| Which team an admin's hours count toward | **The admin's own team, as today.** The `time_entries_stamp_team` trigger stamps the user's team on insert. No DB or reporting change. Team B's report will not show an admin's hours on a Team B client.                                  |
| How the client learns team names         | **An optional `teamName` on each project** (the home team's name). Rejected: a second `GET /v1/teams` call joined client-side (two requests, join logic in both clients), and a new grouped endpoint (a second list contract to maintain). |

## 3. API and contracts

- `ProjectSchema` (`packages/contracts/src/projects.ts`) gains `teamName: z.string().optional()`: the name of the home team (`teamId`). It is additive. Shipped clients ignore unknown keys.
- `ProjectsRepository.findProjects` selects `team: { select: { name: true } }` and maps it to `teamName`, in the same query (no N+1). Every list response carries it, not just `allTeams`, so one mapping covers both paths.
- Unchanged: `GET /v1/projects` scoping (EMPLOYEE pinned to their own team, MANAGER sending `allTeams` gets 403, ADMIN `allTeams` lists every team), the response's `teamId`/`teamIds`, and time-entry validation and stamping.
- The time-entry sync already accepts any project id, so an admin's entry on another team's project syncs with no API change.

## 4. Clients (macOS and Windows, same behaviour)

**Fetch.** `ProjectClient` sends `?allTeams=true` only when the decoded access token's `role` is `ADMIN` (`JWTDecoder.swift`, `JwtDecoder.cs` already decode `role` and `teamId`). Every other role sends the request exactly as today.

**Model.** `Project` gains two optional fields, `teamName` and `teamIds`. Neither client decodes `teamIds` today. A missing value must decode cleanly so the new client works against an API that has not been deployed yet.

**Grouping (`PickerCore`).** Given the projects, the admin's `teamId` and the search text:

1. **My team (own team name):** every project whose `teamIds` contains the admin's team (home or shared in). If `teamIds` is absent, fall back to `teamId == ownTeamId`.
2. **Every other team:** each remaining project goes under its home team (`teamId`), with sections ordered by team name A→Z. A client shared between two other teams appears once, under its home team.
3. Projects keep their current order inside a section.
4. Search filters every section, and a section left empty is hidden.
5. A missing `teamName` shows the header "Other team". The own-team header uses the `teamName` of any project whose home team is the admin's team, or plain "My team" if there is none.

**Rendering.** A header is not a row. Grouping stamps a `section` title on each root or search row and stable-sorts them. The macOS view draws a non-clickable header where the section changes, and WPF groups the list by `Section` with a `GroupStyle` header. So activation, keyboard highlight and search Return are untouched.

When the user is not an ADMIN, the picker shows today's flat list with no headers. Grouping is a pure function so it can be unit-tested without UI.

**Viewer.** Grouping needs the viewer's role and team at render time, including on an offline launch with no access token. `AuthSession` mirrors `role` and `teamId` next to the existing `lastUserId` on sign-in and refresh, and clears them on sign-out. Admin status is never inferred from the projects: employees already receive shared-in clients whose home `teamId` is another team.

**Role changes.** The role is read from the current access token at fetch time. After a promotion or demotion, the next token refresh plus project refresh switches the mode. No new invalidation is added.

**Cache.** `ProjectCache` stores the fetched projects, `teamName` included, so the offline picker keeps its sections. A cache written by an older build has no `teamName` and degrades to "Other team" headers until the next refresh.

**Selection and recents.** These are keyed by project, subproject and task ids, so nothing changes. A remembered selection on another team's project resolves as long as the project is in the list.

## 5. Rollout

Deploy the API first, then publish the Mac and Windows builds. The clients tolerate a missing `teamName`, so the order is a preference here, not a hard requirement.

## 6. Testing

- **API e2e (`apps/api/test/projects-work-types.e2e-spec.ts`, beside the existing `allTeams` test):** an ADMIN with `allTeams=true` gets every team's projects with the correct `teamName`. A MANAGER with `allTeams=true` gets 403. An EMPLOYEE's response is still their own team only, now carrying `teamName`.
- **API e2e (`apps/api/test/time-entries.e2e-spec.ts`):** an ADMIN's synced entry on another team's client is accepted and stamped with the admin's own team. This pins §3's claim.
- **Contracts:** `ProjectSchema` parses with and without `teamName` (the branch-coverage gate).
- **macOS (`swift test`) and Windows (CI) unit tests for the grouping:** own team first, including shared-in projects; other teams A→Z; a shared-between-others project appears once; search hides empty sections; the missing-`teamName` fallback; non-admins get a flat list. Plus a `ProjectClient` test that the query is sent only for ADMIN.
- **Manual:** the Mac app against the local stack, signed in as an admin and then as an employee, with screenshots before the PR. Windows is verified through PR CI only (no dotnet on the dev Mac).

## 7. Out of scope

- Attributing admin hours to the project's team.
- A team switcher or collapsible sections.
- Any change to the dashboard.
