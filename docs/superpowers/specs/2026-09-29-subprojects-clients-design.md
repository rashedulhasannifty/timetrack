# Subprojects — Phase 2 (desktop clients)

**Date:** 2026-09-29
**Status:** Approved design, pending implementation plan
**Depends on:** Phase 1 (PR #247, spec `2026-09-29-subprojects-design.md`) being **deployed** —
the API must serve `subprojects` / `tasks[].subprojectId` and accept `subprojectId` on
`POST /v1/time-entries` before any client from this phase is released.
**Scope:** `apps/client-macos` (Swift, 0.6.3 → 0.7.0) and `apps/client-windows` (C#/WPF,
0.2.6 → 0.3.0). No server, dashboard or contract change.

## 1. Goal

Let people pick a **subproject** (and optionally a task) in the desktop menu-bar / tray picker, and
send it with every time entry. Both clients behave identically.

Decisions made with the product owner:

| Question                    | Decision                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Picker shape                | **Drill-down**: Projects → Subprojects → Tasks, with a back control.                                                                                                             |
| Search                      | **Global flat results**: typing searches all levels and lists full paths; a click tracks immediately; clearing returns to the drill-down.                                        |
| Project with only "General" | **Skip** the one-row subproject screen — go straight to General's tasks, titled with the project name. The subproject level appears only when a project has a second subproject. |

### Constraints

- Shipped 0.6.x / 0.2.x clients are never force-updated and keep working: the server fills in the
  subproject for them. This phase must not require anything of old clients.
- Persisted client data (last selection, live span, project cache, queued payloads) written by an
  older version must still load after upgrade. New persisted fields are **optional**.
- The monitoring guarantees (CLAUDE.md §1) are untouched: no change to capture code, `AckGate`, the
  menu-bar/tray indicator, or what is captured.
- The server sync path never 422s over `subprojectId` (Phase 1 spec §2): a stale id falls back to
  the task's subproject, then the project default. Clients may therefore always send what they have.

### Non-goals

- Creating, renaming, archiving subprojects or tasks from a client.
- Showing archived projects/subprojects/tasks in the picker.
- Mac notarization / Developer ID cutover.
- Any change to the server, contracts or dashboard.

## 2. Picker behaviour (both clients)

**Root screen:** search field + active projects, each row with a `›` affordance. A header strip
above the list always shows the **current selection** as a path, e.g.
`● Website Redesign › Homepage › Hero copy` (or "No project").

**Click a project:**

- it has ≥ 2 active subprojects → **subproject screen**: `‹ <Project>` back row, then each active
  subproject (default first, then by name) with `›`;
- its only active subproject is the default → skip straight to that subproject's **task screen**,
  titled `‹ <Project>`.

**Task screen:** first row `<Subproject> (no task)` — tracks the subproject with no task (when the
subproject screen was skipped, the row reads `<Project> (no task)`). Then the subproject's active
tasks by name. Clicking any row **starts or switches tracking immediately**, with exactly the
semantics a row click has today (tracking → stop + start with the new selection; paused → reselect;
idle → select). A checkmark marks the current selection wherever it appears.

**Back:** `‹` returns one level. Closing and reopening the picker starts at the root.

**Search:** non-empty text replaces the drill-down with a flat list of matches across **all levels**,
each shown as a full path:

- a subproject row: `Project › Subproject`;
- a task row: `Project › Subproject › Task`;
- when a project's only subproject is the default, the default is omitted from paths
  (`Project`, `Project › Task`).

Matching is case-insensitive substring on any path component (same rule as today's search).
Clicking a result tracks it immediately. Clearing the text restores the drill-down level the user
was on.

**Offered items:** only what `GET /v1/projects` returns without `includeArchived` — active projects,
active subprojects, and tasks that are neither archived nor inside an archived subproject (the
server already filters these).

**Keyboard:** arrow keys + Enter work on every screen and in search results. On Windows `Esc` goes
back one level before it closes the popup; at the root it closes as today. macOS keeps its current
dismiss behaviour.

## 3. Structure

Each client gets a small, UI-free picker core so the behaviour above is unit-testable without
SwiftUI/WPF:

| Unit               | Responsibility                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `PickerTree`       | Build projects → subprojects → tasks from `[Project]`; apply the skip-General rule; ordering.           |
| `PickerSearch`     | Produce the flat full-path result list for a query.                                                     |
| `PickerNavigation` | Current level (root / project / subproject), back, screen title, header text for the current selection. |

The views (`MenuBarView` on macOS, `TrayPopupWindow` on Windows) render these and forward clicks to
the existing `MenuViewModel.select…` path. The old flattened `Choice` / `PickerChoice` list is
removed; every current consumer of it (view, view model, selection resolver, tests) moves to these
units.

## 4. Data

**Models** (decoded from `GET /v1/projects` and cached in `projects.json`):

- new `Subproject { id, projectId, name, archived, isDefault }`;
- `Project.subprojects: [Subproject]?` — optional/nullable;
- `ProjectTask.subprojectId: String?` — optional/nullable (a cache written by an old version lacks
  it; such a cache is replaced on the next successful fetch).

**Selection** gains `subprojectId` everywhere it flows:

- `TimeTracker.Selection` (projectId, subprojectId, taskId, note);
- `StoredSelection` (last pick, per user) — `subprojectId` **optional**;
- `LiveSpan` (open span for crash recovery) — `subprojectId` **optional**;
- the picker's selection value;
- `RecentSelectionClient` (fresh-install fallback reading recent entries) decodes `subprojectId`
  when present.

Widening a shared initializer/record and updating **all** of its call sites happen in the same task
(macOS is a single executable target: a half-updated init does not build). Windows records add the
parameter with a `null` default so existing construction sites keep compiling until updated.

**Upgrading an old stored selection** (no `subprojectId`): resolve against the current project
list — the task's `subprojectId` when the task exists, else the project's default subproject.

**Resolving a stored/live selection that has gone stale** (both clients, identical — this aligns
macOS with today's Windows behaviour, which already degrades project-level):

| What disappeared                    | Result                                |
| ----------------------------------- | ------------------------------------- |
| nothing                             | selection as stored                   |
| the task                            | same subproject, no task              |
| the subproject (or it was archived) | project's default subproject, no task |
| the project (or it was archived)    | no selection                          |

macOS keeps its guard that an **empty** project list (offline re-login) never clears the stored
selection.

## 5. Sync

Every `TimeEntryPayload` includes `subprojectId`:

- macOS: explicit `null` when there is no project (custom `encode` uses `encodeNil`, like
  `projectId`/`taskId`);
- Windows: serialized with the existing `DefaultIgnoreCondition = Never` options → explicit `null`.

Payloads already queued on disk by an older version decode with `subprojectId` absent and upload
unchanged — the server derives it.

Unchanged: auto-tracking, idle Keep/Discard bridge spans, live-span recovery and the runaway-split
worker all pass the selection through; the only change is that the selection now carries
`subprojectId`.

## 6. Testing

- **Picker core** (both clients): tree building incl. skip-General; ordering; archived items absent;
  navigation (drill, back, title, header text); search paths incl. default-omission rule and
  case-insensitive match; selecting from a result yields the right selection.
- **Persistence:** an old-format `StoredSelection` / `LiveSpan` / `projects.json` (no subproject
  fields) still decodes; the upgrade rule; every row of the stale-resolution table.
- **Payload:** `subprojectId` present (and explicit `null` when no project) on both clients; an
  old queued payload without it still decodes.
- **Existing suites** updated for the widened selection (MenuViewModel, TimeTracker, auto-tracking,
  idle, recovery, live-entry publisher).
- macOS: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test` (CommandLineTools
  lacks XCTest). Windows: `dotnet test` in the PR's `client-windows.yml` CI (no dotnet on the Mac).
- **Manual, on a real Mac install** (the only UI verification available): drill down, skip-General,
  back, search + click, switch while tracking; confirm on the dashboard that the entry carries the
  chosen subproject/task.

## 7. Release

1. Phase 1 (#247) merged and deployed, repair SQL run.
2. macOS 0.7.0 → pilot release repo (`rashedulhasansojib/timetrack-app`); unnotarized, testers
   reinstall manually; pin the niftyitsolution signing identity so TCC grants survive.
3. Windows 0.3.0 → `niftytimer-windows`; installs ≥ 0.2.5 self-update.

Old clients keep working indefinitely; nothing on the server gates on client version.
