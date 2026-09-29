# Subprojects Phase 2 — Desktop Client Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the macOS and Windows clients, let people pick Project → Subproject → (optional) Task in a drill-down picker with global search, and send `subprojectId` on every time entry.

**Architecture:** Each client gets a UI-free picker core (`PickerTree`, `PickerSearch`, `PickerNavigation`, plus a rewritten `SelectionResolver`) that turns `[Project]` into rows. The menu view models render those rows and replace the old flattened `Choice` / `PickerChoice` list. `subprojectId` is threaded through the selection value, the tracker, the live span, the live publisher and the wire payload, so every path that opens or closes an entry carries it.

**Tech Stack:**

- macOS: Swift 5.10, SwiftUI, XCTest, SwiftPM, platform macOS 14.
- Windows: C#/.NET 9, WPF, xUnit. There is no dotnet on the Mac, so Windows is verified only by the PR's `client-windows.yml` CI.

**Spec:** `docs/superpowers/specs/2026-09-29-subprojects-clients-design.md`

## Global Constraints

- **Scope:** `apps/client-macos` (0.6.3 → 0.7.0) and `apps/client-windows` (0.2.6 → 0.3.0). No server, dashboard or contract change.
- **Shipped clients:** 0.6.x and 0.2.x are never force-updated and keep working. Nothing here may require anything of them.
- **Persisted client data:** data written by an older version must still load. That covers `StoredSelection`, `LiveSpan`, `projects.json` and queued payloads. New persisted fields are **optional**.
- **Monitoring guarantees (CLAUDE.md §1):** no change to capture code, `AckGate`, the menu-bar/tray indicator, or what is captured.
- **Sync never 422s over `subprojectId`.** A stale id falls back to the task's subproject, then the project default. An explicit `null` alongside a `projectId` means "server derives it", verified in `apps/api/src/modules/time-entries/time-entries.service.ts` `pickSubproject`.
- **The server writes `subprojectId` only when it creates the row.** The time-entries repository upsert deliberately omits it on update. The live publish usually creates the row, so a live publish or `LiveSpan` that drops `subprojectId` files the entry under General permanently. This is visible only for "<non-default subproject> (no task)", because with a task set the server derives the subproject from the task. Every pass-through test below uses a **non-default subproject with a nil task** for exactly this reason.
- **Offered items:** only what `GET /v1/projects` returns without `includeArchived`, which is active projects, active subprojects and assignable tasks.
- **Search:** case-insensitive substring on any **displayed** path component. Surrounding whitespace is trimmed, and an empty or whitespace-only query means "not searching".
- **Path separator** in search results, the header strip and back titles is `" › "` (U+203A with spaces). The "no task" suffix is `" (no task)"`, and "No project" is the header when nothing is selected.
- **Git rules (CLAUDE.md §0):**
  - Commits use Conventional Commits with scope `client`.
  - No AI attribution anywhere.
  - Never stage `apps/worker/scratch-seed-demo.ts` or `apps/worker/scratch-seed-shots.ts`.
- **Mac tests:** `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`. CommandLineTools lacks XCTest.
- **Windows tests:** only via `client-windows.yml` on the pull request. Do not write "run it and see it fail" steps for Windows; each Windows task's gate is "CI green on the PR".

## Decisions fixed by this plan (rulings)

Implementers must not re-decide these.

1. **A task that still exists wins over the stored subproject.**
   - When the stored `taskId` is present among the project's active tasks, the resolved `subprojectId` is **that task's current subproject**, even if the stored `subprojectId` differs because the task was moved.
   - This also implements the spec's upgrade rule for old selections that have no `subprojectId`.
2. **An old-format cache becomes one implicit default.**
   - This applies when a cached project has no `subprojects` (or none active), for example a `projects.json` written by 0.6.x or 0.2.x.
   - The project becomes a single implicit default subproject with `id == nil` holding all its tasks. The skip-General rule applies, and the client sends `subprojectId: null`, so the server derives it.
   - A task with a nil `subprojectId` goes into the project's default subproject.
   - A task whose `subprojectId` matches no active subproject is dropped. The server already filters those.
3. **Ordering.**
   - Projects keep the server's order (name ascending).
   - Subprojects are ordered default first, then by name, case-insensitive: Swift `compare(_:options: .caseInsensitive)`, C# `StringComparer.OrdinalIgnoreCase`.
   - Tasks are ordered by name, case-insensitive.
4. **Titles.** The views add the arrows; titles never contain `‹` or `›` glyphs.
   - The back row on a project's subproject screen: `<Project>`.
   - The back row on a task screen: `<Project> › <Subproject>`, or just `<Project>` when the subproject screen was skipped.
   - The no-task row: `<Subproject> (no task)`, or `<Project> (no task)` when skipped.
   - The header strip: `Project › Subproject › Task`.
     - The subproject is omitted when the project skips the subproject level.
     - The task is omitted when there is none.
     - "No project" when the selection is nil or its project is not in the tree. The header never renders a missing name.
5. **A refresh can remove the level the picker is on.** The level is normalised against the tree on every read:
   - the project is gone → root;
   - the subproject is gone → re-open the project, which may skip straight to its default's tasks;
   - the project now has only its default → skip to its tasks.
6. **Reopening.** Opening the dropdown or popup resets the level to root and clears the highlight. The query is kept, as it is today.
7. **Keyboard.**
   - macOS: Up and Down move a highlight kept in the view model, and Return activates the highlighted row, or the first row when nothing is highlighted. Arrow keys through `.onKeyPress` on the search field are **verified by hand only** (Task 5). If the field editor swallows them, move `.onKeyPress` to the picker's `ScrollView`, made `.focusable()`.
   - Windows: rows are activated by a click or Enter, never by `ListBox.SelectionChanged`, because arrowing would otherwise drill or track on every keypress. Down in the search box moves focus into the list.
   - Windows Esc goes back one level. At the root it hides the popup; Windows has no Esc handler today.
8. **Checkmarks.** A checkmark shows on a _track_ row whose selection equals the current selection. On Windows it binds to `PickerRow.IsCurrent`, not `ListBoxItem.IsSelected`, which now means "keyboard highlight".
9. **The Mac intermediate commit sends `subprojectId: nil`.**
   - In Task 3, `MenuViewModel` still holds a `Choice`, which has no subproject, so it passes `subprojectId: nil`. A nil there is today's shipped behaviour (the server derives it), not a regression.
   - Task 4 replaces `Choice`.
10. **Release.** The version bumps are commits only (Tasks 5 and 9). Publishing to the release repos is the user's decision and is not part of this plan.

## Review Focus

These are the input classes most likely to hurt a real person that the spec implies but does not spell out. Each has a test in the task named.

1. A "<non-default subproject> (no task)" selection must reach the server intact through every path that writes an entry:
   - a note edit mid-span;
   - pause, then resume;
   - switching while paused;
   - an auto start and the Keep bridge;
   - the manual-idle Discard restart;
   - crash recovery;
   - the live publish, on both open overloads and the Windows heartbeat.

   Covered by Tasks 3 and 6.

2. An offline launch with a 0.6.x or 0.2.x `projects.json` (no subproject fields) must show a usable picker and send `null`, not crash or hide tasks. Covered by Tasks 2 and 7 (`PickerTree` implicit default) and Tasks 1 and 6 (decode).
3. A projects refresh that archives the subproject or project the picker is currently showing must not crash or show an empty screen with a dead back row. Covered by Tasks 2 and 7 (`normalize`).
4. A stored task that was moved to another subproject must resolve to its new subproject, not a mismatched pair. Covered by Tasks 2 and 7 (resolver).
5. On Windows, arrowing through the list must not change what is being tracked. Covered by Task 8 (activation by Enter or click only).

---

## File Structure

**macOS (`apps/client-macos`)**

| File                                                                                 | Change                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Sources/TimeTrack/Projects/Project.swift`                                           | Add `Subproject`, `Project.subprojects`, and `ProjectTask.subprojectId` (explicit inits with defaults).                                   |
| `Sources/TimeTrack/Projects/SelectionStore.swift`                                    | `StoredSelection.subprojectId` is optional, with an explicit init.                                                                        |
| `Sources/TimeTrack/Projects/RecentSelectionClient.swift`                             | Decode `subprojectId`.                                                                                                                    |
| `Sources/TimeTrack/Projects/PickerCore.swift`                                        | **New.** `PickerTask`, `PickerSubproject`, `PickerProject`, `PickerTree`, `PickerLevel`, `PickerRow`, `PickerNavigation`, `PickerSearch`. |
| `Sources/TimeTrack/Projects/SelectionResolver.swift`                                 | New `resolve(_:in projects:)` in Task 2; the old `Choice` overload is removed in Task 4.                                                  |
| `Sources/TimeTrack/Tracking/TimeTracker.swift`                                       | `Selection.subprojectId` (required init label); `start`/`recordSpan` take `subprojectId`; `setNote`, close and enqueue carry it.          |
| `Sources/TimeTrack/Sync/TimeEntryPayload.swift`                                      | `subprojectId` with `encodeNil`.                                                                                                          |
| `Sources/TimeTrack/Storage/LiveSpanStore.swift`                                      | `LiveSpan.subprojectId`; `begin` writes it.                                                                                               |
| `Sources/TimeTrack/Tracking/LiveSpanRecovery.swift`                                  | Pass it through.                                                                                                                          |
| `Sources/TimeTrack/Sync/LiveEntryPublisher.swift`                                    | Both overloads send it.                                                                                                                   |
| `Sources/TimeTrack/App/AutoTrackingCoordinator.swift`, `ManualIdleCoordinator.swift` | Pass it through.                                                                                                                          |
| `Sources/TimeTrack/App/AppDelegate.swift`                                            | l.~900 `.init(...)` fallback; `menuDidOpen` calls `pickerDidOpen()`.                                                                      |
| `Sources/TimeTrack/App/MenuViewModel.swift`                                          | Replace `Choice` with `selection: StoredSelection?`, `level`, `highlightedRowId`, rows, header, and the activate/back/highlight methods.  |
| `Sources/TimeTrack/UI/MenuBarView.swift`                                             | Header strip, row rendering (back, drill, track), keyboard.                                                                               |
| `Info.plist`                                                                         | 0.7.0, build number +1.                                                                                                                   |
| Tests                                                                                | `PickerCoreTests.swift` (new), `SelectionResolverTests.swift` (rewritten), plus updates across the existing suites.                       |

**Windows (`apps/client-windows`)**

| File                                                                                                                                          | Change                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/NiftyTimer/Projects/Project.cs`                                                                                                          | `Subproject` record; `Project.Subprojects`, `ProjectTask.SubprojectId` and `StoredSelection.SubprojectId` (all trailing, `= null`).                                                                         |
| `src/NiftyTimer/Projects/RecentSelectionClient.cs`                                                                                            | `RecentEntryRow.SubprojectId`.                                                                                                                                                                              |
| `src/NiftyTimer/Projects/PickerCore.cs`                                                                                                       | **New.** A port of the Swift core.                                                                                                                                                                          |
| `src/NiftyTimer/Projects/SelectionStore.cs`                                                                                                   | `SelectionResolver.Resolve` rewritten to the unified stale table.                                                                                                                                           |
| `src/NiftyTimer/Tracking/TimeTracker.cs`                                                                                                      | `Selection.SubprojectId`; `Start`/`RecordSpan` take `subprojectId`; `Enqueue` sends it.                                                                                                                     |
| `src/NiftyTimer/Sync/TimeEntryPayload.cs`                                                                                                     | `subprojectId` (explicit null); doc comment updated.                                                                                                                                                        |
| `src/NiftyTimer/Storage/LiveSpanStore.cs`                                                                                                     | `LiveSpan.SubprojectId`; `Begin` writes it.                                                                                                                                                                 |
| `src/NiftyTimer/Tracking/LiveSpanRecovery.cs`, `Sync/LiveEntryPublisher.cs`, `App/AutoTrackingCoordinator.cs`, `App/ManualIdleCoordinator.cs` | Pass it through.                                                                                                                                                                                            |
| `src/NiftyTimer/App/MenuViewModel.cs`                                                                                                         | Remove `PickerChoice`; add `Level`, `PickerRows`, `Activate`, `Back`, `ResetPicker`, `SelectProject(StoredSelection)`.                                                                                      |
| `src/NiftyTimer/UI/TrayPopupWindow.xaml(.cs)`                                                                                                 | Header strip, row template (back, drill, track, `IsCurrent`), click/Enter activation, Esc, Down.                                                                                                            |
| `src/NiftyTimer/NiftyTimer.csproj`                                                                                                            | 0.3.0.                                                                                                                                                                                                      |
| Tests                                                                                                                                         | `PickerCoreTests.cs` (new), plus `MenuPickerTests`, `AppAndProjectTests`, `TrayPopupWindowTests`, `WireContractTests`, `TrackingTests`, `AutoTrackingTests`, `ManualIdleTests` and `RecoveryTests` updated. |

---

## Task 1: macOS — decode subprojects and optional selection fields

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/Projects/Project.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/Projects/SelectionStore.swift:4-7`
- Modify: `apps/client-macos/Sources/TimeTrack/Projects/RecentSelectionClient.swift:68-81`
- Test: `apps/client-macos/Tests/TimeTrackTests/ProjectCacheTests.swift`, `SelectionStoreTests.swift`, `RecentSelectionClientTests.swift`

**Interfaces:**

- Produces:
  - `struct Subproject: Codable, Identifiable, Equatable { id, projectId, name: String; archived, isDefault: Bool }`
  - `Project.subprojects: [Subproject]?`
  - `ProjectTask.subprojectId: String?`
  - `StoredSelection(projectId: String, subprojectId: String? = nil, taskId: String?)` with a `subprojectId: String?` property

  Existing call sites that omit the new fields keep compiling.

- [ ] **Step 1: Write the failing tests**

Add to `ProjectCacheTests.swift`:

```swift
    /// A projects.json written by 0.6.x has no subproject fields. It must still load — the picker
    /// works offline from this file until the next successful fetch replaces it.
    func testLoadsACacheWrittenBeforeSubprojectsExisted() throws {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url) }
        let legacy = """
        [{"id":"p1","teamId":"t1","name":"Acme","archived":false,
          "tasks":[{"id":"k1","projectId":"p1","name":"Design"}]}]
        """
        try Data(legacy.utf8).write(to: url)

        let loaded = ProjectCache(fileURL: url).load()

        XCTAssertEqual(loaded.count, 1)
        XCTAssertNil(loaded[0].subprojects)
        XCTAssertNil(loaded[0].tasks?[0].subprojectId)
    }

    func testDecodesSubprojectsAndTaskSubprojectIds() throws {
        let json = """
        [{"id":"p1","teamId":"t1","name":"Acme","color":null,"archived":false,
          "tasks":[{"id":"k1","projectId":"p1","subprojectId":"s2","name":"Design","archived":false}],
          "subprojects":[{"id":"s1","projectId":"p1","name":"General","archived":false,"isDefault":true},
                         {"id":"s2","projectId":"p1","name":"Checkout","archived":false,"isDefault":false}]}]
        """
        let projects = try JSONDecoder().decode([Project].self, from: Data(json.utf8))

        XCTAssertEqual(projects[0].subprojects?.map(\.id), ["s1", "s2"])
        XCTAssertEqual(projects[0].subprojects?[0].isDefault, true)
        XCTAssertEqual(projects[0].tasks?[0].subprojectId, "s2")
    }
```

Add to `SelectionStoreTests.swift`, reusing the file's existing store-construction helper (the one `testRoundTripsASelection` uses):

```swift
    /// 0.6.x stored `{projectId, taskId}`. It must still decode after the upgrade.
    func testDecodesASelectionStoredBeforeSubprojectsExisted() throws {
        let legacy = Data(#"{"projectId":"p1","taskId":"t1"}"#.utf8)
        let decoded = try JSONDecoder().decode(StoredSelection.self, from: legacy)
        XCTAssertEqual(decoded, StoredSelection(projectId: "p1", subprojectId: nil, taskId: "t1"))
    }

    func testRoundTripsASubprojectSelection() {
        let store = makeStore()
        let selection = StoredSelection(projectId: "p1", subprojectId: "s2", taskId: nil)
        store.save(selection, userId: "u1")
        XCTAssertEqual(store.load(userId: "u1"), selection)
    }
```

If the file's helper is not named `makeStore()`, use its actual name. Read the top of `SelectionStoreTests.swift` first.

Add to `RecentSelectionClientTests.swift`:

```swift
    func testCarriesTheSubprojectWhenTheServerSendsOne() {
        let selection = decode("""
        [{"id":"b","startTime":"2026-08-20T04:00:00.000Z","projectId":"p1","subprojectId":"s2","taskId":null}]
        """)
        XCTAssertEqual(selection, StoredSelection(projectId: "p1", subprojectId: "s2", taskId: nil))
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter 'ProjectCacheTests|SelectionStoreTests|RecentSelectionClientTests'`

Expected: build FAILURE (`subprojects`, `subprojectId` and the `StoredSelection(projectId:subprojectId:taskId:)` init do not exist).

- [ ] **Step 3: Implement**

Replace `Project.swift`:

```swift
import Foundation

/// Client-side mirror of `ProjectSchema` / `SubprojectSchema` / `TaskSchema` in @timetrack/contracts.
/// Named `ProjectTask` because `Task` is Swift's concurrency primitive (CLAUDE.md /
/// plan Global Constraints).
///
/// `subprojects` and `ProjectTask.subprojectId` are optional: a `projects.json` written before
/// subprojects existed has neither, and it must still load (the picker treats such a project as
/// one implicit default — see `PickerTree`). Explicit inits keep every existing construction site
/// compiling; decoding is synthesized.
struct Project: Codable, Identifiable, Equatable {
    let id: String
    let teamId: String
    let name: String
    let archived: Bool
    let tasks: [ProjectTask]?
    let subprojects: [Subproject]?

    init(id: String, teamId: String, name: String, archived: Bool,
         tasks: [ProjectTask]?, subprojects: [Subproject]? = nil) {
        self.id = id
        self.teamId = teamId
        self.name = name
        self.archived = archived
        self.tasks = tasks
        self.subprojects = subprojects
    }
}

struct Subproject: Codable, Identifiable, Equatable {
    let id: String
    let projectId: String
    let name: String
    let archived: Bool
    /// The project's "General" bucket — exactly one per project, never archivable.
    let isDefault: Bool
}

struct ProjectTask: Codable, Identifiable, Equatable {
    let id: String
    let projectId: String
    let name: String
    let subprojectId: String?

    init(id: String, projectId: String, name: String, subprojectId: String? = nil) {
        self.id = id
        self.projectId = projectId
        self.name = name
        self.subprojectId = subprojectId
    }
}
```

In `SelectionStore.swift`, replace the `StoredSelection` struct:

```swift
/// The picker selection worth remembering across launches. Ids only — never names or titles.
///
/// `subprojectId` is optional so a selection stored by 0.6.x (`{projectId, taskId}`) still
/// decodes; `SelectionResolver` upgrades it against the current project list.
struct StoredSelection: Codable, Equatable {
    let projectId: String
    let subprojectId: String?
    let taskId: String?

    init(projectId: String, subprojectId: String? = nil, taskId: String?) {
        self.projectId = projectId
        self.subprojectId = subprojectId
        self.taskId = taskId
    }
}
```

In `RecentSelectionClient.newestSelection(in:)`, add `let subprojectId: String?` to `Row`, and build `StoredSelection(projectId: $0, subprojectId: row.subprojectId, taskId: row.taskId)`.

- [ ] **Step 4: Run the full Mac suite**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`

Expected: all tests PASS, including the four new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Projects/Project.swift \
        apps/client-macos/Sources/TimeTrack/Projects/SelectionStore.swift \
        apps/client-macos/Sources/TimeTrack/Projects/RecentSelectionClient.swift \
        apps/client-macos/Tests/TimeTrackTests/ProjectCacheTests.swift \
        apps/client-macos/Tests/TimeTrackTests/SelectionStoreTests.swift \
        apps/client-macos/Tests/TimeTrackTests/RecentSelectionClientTests.swift
git commit -m "feat(client): decode subprojects in the macOS client"
```

---

## Task 2: macOS — picker core and unified selection resolver

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/Projects/PickerCore.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/Projects/SelectionResolver.swift`
- Create: `apps/client-macos/Tests/TimeTrackTests/PickerCoreTests.swift`
- Modify: `apps/client-macos/Tests/TimeTrackTests/SelectionResolverTests.swift`

**Interfaces:**

- Consumes: Task 1 models.
- Produces (exact names; Task 4 uses them):
  - `PickerTree.build(_ projects: [Project]) -> [PickerProject]`
  - `PickerTree.node(_ project: Project) -> PickerProject`
  - `PickerProject { id, name, subprojects: [PickerSubproject], skipsSubprojectLevel: Bool, defaultSubproject: PickerSubproject?, subproject(_ id: String?) -> PickerSubproject? }`
  - `PickerSubproject { id: String?, name: String, isDefault: Bool, tasks: [PickerTask] }`
  - `PickerTask { id: String, name: String }`
  - `enum PickerLevel: Equatable { case root; case project(String); case subproject(projectId: String, subprojectId: String?) }`
  - `struct PickerRow: Identifiable, Equatable { id: String; title: String; action: Action }`, where `enum Action: Equatable { case back; case open(PickerLevel); case track(StoredSelection) }`
  - `PickerNavigation`:
    - `open(_: PickerProject) -> PickerLevel`
    - `back(from: PickerLevel, in: [PickerProject]) -> PickerLevel`
    - `normalize(_: PickerLevel, in: [PickerProject]) -> PickerLevel`
    - `rows(at: PickerLevel, in: [PickerProject]) -> [PickerRow]`
    - `headerText(for: StoredSelection?, in: [PickerProject]) -> String`
    - `moveHighlight(_ current: String?, by delta: Int, in rows: [PickerRow]) -> String?`
  - `PickerSearch.results(for query: String, in: [PickerProject]) -> [PickerRow]` and `PickerSearch.isSearching(_ query: String) -> Bool`
  - `SelectionResolver.resolve(_ stored: StoredSelection?, in projects: [Project]) -> StoredSelection?`. This is a new overload; the old `in choices: [Choice]` overload stays until Task 4.

- [ ] **Step 1: Write the failing tests**

Create `PickerCoreTests.swift`:

```swift
import XCTest
@testable import TimeTrack

final class PickerCoreTests: XCTestCase {
    // Acme: General + Checkout (two subprojects → subproject level shown).
    // Borealis: only General (skips the subproject level).
    // Legacy: a cache written before subprojects existed (implicit default, id nil).
    private let projects: [Project] = [
        Project(id: "p1", teamId: "t", name: "Acme", archived: false,
                tasks: [ProjectTask(id: "k2", projectId: "p1", name: "pay form", subprojectId: "s2"),
                        ProjectTask(id: "k1", projectId: "p1", name: "Audit", subprojectId: "s1"),
                        ProjectTask(id: "k3", projectId: "p1", name: "Cart", subprojectId: "s2")],
                subprojects: [Subproject(id: "s2", projectId: "p1", name: "checkout", archived: false, isDefault: false),
                              Subproject(id: "s1", projectId: "p1", name: "General", archived: false, isDefault: true)]),
        Project(id: "p2", teamId: "t", name: "Borealis", archived: false,
                tasks: [ProjectTask(id: "k4", projectId: "p2", name: "Hero copy", subprojectId: "s3")],
                subprojects: [Subproject(id: "s3", projectId: "p2", name: "General", archived: false, isDefault: true)]),
        Project(id: "p3", teamId: "t", name: "Legacy", archived: false,
                tasks: [ProjectTask(id: "k5", projectId: "p3", name: "Old task")]),
    ]
    private var tree: [PickerProject] { PickerTree.build(projects) }

    // MARK: tree

    func testOrdersSubprojectsDefaultFirstThenByNameAndTasksByName() {
        let acme = tree[0]
        XCTAssertEqual(acme.subprojects.map(\.id), ["s1", "s2"])
        XCTAssertEqual(acme.subprojects[1].tasks.map(\.name), ["Cart", "pay form"])
        XCTAssertEqual(acme.subprojects[0].tasks.map(\.id), ["k1"])
    }

    func testSkipsTheSubprojectLevelOnlyWhenTheDefaultIsAlone() {
        XCTAssertFalse(tree[0].skipsSubprojectLevel)
        XCTAssertTrue(tree[1].skipsSubprojectLevel)
    }

    func testALegacyCacheProjectBecomesOneImplicitDefaultHoldingEveryTask() {
        let legacy = tree[2]
        XCTAssertTrue(legacy.skipsSubprojectLevel)
        XCTAssertNil(legacy.subprojects[0].id)
        XCTAssertEqual(legacy.subprojects[0].tasks.map(\.id), ["k5"])
    }

    func testArchivedProjectsAndSubprojectsAreAbsentAndTheirTasksDropped() {
        let withArchived = [
            Project(id: "px", teamId: "t", name: "Gone", archived: true, tasks: nil),
            Project(id: "p1", teamId: "t", name: "Acme", archived: false,
                    tasks: [ProjectTask(id: "k9", projectId: "p1", name: "Hidden", subprojectId: "s9")],
                    subprojects: [Subproject(id: "s1", projectId: "p1", name: "General", archived: false, isDefault: true),
                                  Subproject(id: "s9", projectId: "p1", name: "Old", archived: true, isDefault: false)]),
        ]
        let built = PickerTree.build(withArchived)
        XCTAssertEqual(built.map(\.id), ["p1"])
        XCTAssertEqual(built[0].subprojects.map(\.id), ["s1"])
        XCTAssertTrue(built[0].subprojects[0].tasks.isEmpty)
    }

    // MARK: navigation

    func testRootRowsOpenEachProjectAtTheRightLevel() {
        let rows = PickerNavigation.rows(at: .root, in: tree)
        XCTAssertEqual(rows.map(\.title), ["Acme", "Borealis", "Legacy"])
        XCTAssertEqual(rows[0].action, .open(.project("p1")))
        XCTAssertEqual(rows[1].action, .open(.subproject(projectId: "p2", subprojectId: "s3")))
    }

    func testProjectScreenListsBackThenSubprojects() {
        let rows = PickerNavigation.rows(at: .project("p1"), in: tree)
        XCTAssertEqual(rows.map(\.title), ["Acme", "General", "checkout"])
        XCTAssertEqual(rows[0].action, .back)
        XCTAssertEqual(rows[2].action, .open(.subproject(projectId: "p1", subprojectId: "s2")))
    }

    func testTaskScreenOfAShownSubproject() {
        let rows = PickerNavigation.rows(at: .subproject(projectId: "p1", subprojectId: "s2"), in: tree)
        XCTAssertEqual(rows.map(\.title), ["Acme › checkout", "checkout (no task)", "Cart", "pay form"])
        XCTAssertEqual(rows[1].action, .track(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: nil)))
        XCTAssertEqual(rows[2].action, .track(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k3")))
    }

    func testTaskScreenOfASkippedProjectIsTitledWithTheProject() {
        let rows = PickerNavigation.rows(at: .subproject(projectId: "p2", subprojectId: "s3"), in: tree)
        XCTAssertEqual(rows.map(\.title), ["Borealis", "Borealis (no task)", "Hero copy"])
    }

    func testBackGoesUpOneLevelAndSkipsTheOmittedScreen() {
        XCTAssertEqual(PickerNavigation.back(from: .subproject(projectId: "p1", subprojectId: "s2"), in: tree), .project("p1"))
        XCTAssertEqual(PickerNavigation.back(from: .subproject(projectId: "p2", subprojectId: "s3"), in: tree), .root)
        XCTAssertEqual(PickerNavigation.back(from: .project("p1"), in: tree), .root)
        XCTAssertEqual(PickerNavigation.back(from: .root, in: tree), .root)
    }

    func testALevelARefreshRemovedFallsBackToAValidOne() {
        XCTAssertEqual(PickerNavigation.normalize(.project("gone"), in: tree), .root)
        XCTAssertEqual(PickerNavigation.normalize(.subproject(projectId: "p1", subprojectId: "gone"), in: tree), .project("p1"))
        XCTAssertEqual(PickerNavigation.normalize(.project("p2"), in: tree), .subproject(projectId: "p2", subprojectId: "s3"))
        XCTAssertEqual(PickerNavigation.rows(at: .project("gone"), in: tree).map(\.title), ["Acme", "Borealis", "Legacy"])
    }

    func testHeaderText() {
        XCTAssertEqual(PickerNavigation.headerText(for: nil, in: tree), "No project")
        XCTAssertEqual(PickerNavigation.headerText(for: StoredSelection(projectId: "gone", taskId: nil), in: tree), "No project")
        XCTAssertEqual(PickerNavigation.headerText(for: StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k3"), in: tree),
                       "Acme › checkout › Cart")
        XCTAssertEqual(PickerNavigation.headerText(for: StoredSelection(projectId: "p1", subprojectId: "s1", taskId: nil), in: tree),
                       "Acme › General")
        XCTAssertEqual(PickerNavigation.headerText(for: StoredSelection(projectId: "p2", subprojectId: "s3", taskId: "k4"), in: tree),
                       "Borealis › Hero copy")
        XCTAssertEqual(PickerNavigation.headerText(for: StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "gone"), in: tree),
                       "Acme › checkout")
    }

    func testMoveHighlightClampsAndStartsAtAnEnd() {
        let rows = PickerNavigation.rows(at: .root, in: tree)   // p:p1, p:p2, p:p3
        XCTAssertEqual(PickerNavigation.moveHighlight(nil, by: 1, in: rows), rows[0].id)
        XCTAssertEqual(PickerNavigation.moveHighlight(nil, by: -1, in: rows), rows[2].id)
        XCTAssertEqual(PickerNavigation.moveHighlight(rows[2].id, by: 1, in: rows), rows[2].id)
        XCTAssertEqual(PickerNavigation.moveHighlight(rows[1].id, by: -1, in: rows), rows[0].id)
        XCTAssertNil(PickerNavigation.moveHighlight(nil, by: 1, in: []))
    }

    // MARK: search

    func testSearchListsFullPathsAndOmitsALoneDefault() {
        let titles = PickerSearch.results(for: "o", in: tree).map(\.title)
        XCTAssertTrue(titles.contains("Acme › checkout"))
        XCTAssertTrue(titles.contains("Acme › checkout › Cart"))
        XCTAssertTrue(titles.contains("Borealis"))
        XCTAssertTrue(titles.contains("Borealis › Hero copy"))
        XCTAssertFalse(titles.contains { $0.contains("Borealis › General") })
    }

    func testSearchIsCaseInsensitiveTrimmedAndMatchesAnyComponent() {
        let rows = PickerSearch.results(for: "  PAY ", in: tree)
        XCTAssertEqual(rows.map(\.title), ["Acme › checkout › pay form"])
        XCTAssertEqual(rows[0].action, .track(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k2")))
        XCTAssertEqual(PickerSearch.results(for: "checkout", in: tree).map(\.title),
                       ["Acme › checkout", "Acme › checkout › Cart", "Acme › checkout › pay form"])
    }

    func testBlankQueryIsNotSearching() {
        XCTAssertFalse(PickerSearch.isSearching("   "))
        XCTAssertTrue(PickerSearch.results(for: " ", in: tree).isEmpty)
        XCTAssertTrue(PickerSearch.isSearching("a"))
    }

    func testALegacyProjectSearchResultSendsANilSubproject() {
        let rows = PickerSearch.results(for: "old task", in: tree)
        XCTAssertEqual(rows.map(\.title), ["Legacy › Old task"])
        XCTAssertEqual(rows[0].action, .track(StoredSelection(projectId: "p3", subprojectId: nil, taskId: "k5")))
    }
}
```

Replace `SelectionResolverTests.swift`:

```swift
import XCTest
@testable import TimeTrack

/// The unified stale-resolution table (spec §4), identical on Windows.
final class SelectionResolverTests: XCTestCase {
    private let projects: [Project] = [
        Project(id: "p1", teamId: "t", name: "Acme", archived: false,
                tasks: [ProjectTask(id: "k1", projectId: "p1", name: "Build", subprojectId: "s2")],
                subprojects: [Subproject(id: "s1", projectId: "p1", name: "General", archived: false, isDefault: true),
                              Subproject(id: "s2", projectId: "p1", name: "Checkout", archived: false, isDefault: false),
                              Subproject(id: "s3", projectId: "p1", name: "Other", archived: false, isDefault: false)]),
        Project(id: "p2", teamId: "t", name: "Archived", archived: true, tasks: nil),
        Project(id: "p3", teamId: "t", name: "Legacy", archived: false, tasks: nil),
    ]

    private func resolve(_ s: StoredSelection?) -> StoredSelection? {
        SelectionResolver.resolve(s, in: projects)
    }

    func testNothingDisappearedKeepsTheSelection() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k1")),
                       StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k1"))
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "s3", taskId: nil)),
                       StoredSelection(projectId: "p1", subprojectId: "s3", taskId: nil))
    }

    func testTaskGoneKeepsTheSubproject() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "s3", taskId: "gone")),
                       StoredSelection(projectId: "p1", subprojectId: "s3", taskId: nil))
    }

    func testSubprojectGoneFallsBackToTheDefault() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "gone", taskId: nil)),
                       StoredSelection(projectId: "p1", subprojectId: "s1", taskId: nil))
    }

    func testProjectGoneOrArchivedClearsTheSelection() {
        XCTAssertNil(resolve(StoredSelection(projectId: "gone", taskId: nil)))
        XCTAssertNil(resolve(StoredSelection(projectId: "p2", taskId: nil)))
        XCTAssertNil(resolve(nil))
    }

    /// Upgrade rule: a 0.6.x selection has no subprojectId.
    func testUpgradesAnOldSelectionFromItsTaskOrTheDefault() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", taskId: "k1")),
                       StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k1"))
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", taskId: nil)),
                       StoredSelection(projectId: "p1", subprojectId: "s1", taskId: nil))
    }

    /// Ruling 1: the task's CURRENT subproject wins over a stale stored one.
    func testAMovedTaskResolvesToItsNewSubproject() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p1", subprojectId: "s3", taskId: "k1")),
                       StoredSelection(projectId: "p1", subprojectId: "s2", taskId: "k1"))
    }

    func testALegacyCacheProjectResolvesWithANilSubproject() {
        XCTAssertEqual(resolve(StoredSelection(projectId: "p3", subprojectId: "s9", taskId: nil)),
                       StoredSelection(projectId: "p3", subprojectId: nil, taskId: nil))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter 'PickerCoreTests|SelectionResolverTests'`

Expected: build FAILURE (`PickerTree` etc. undefined).

- [ ] **Step 3: Implement `PickerCore.swift`**

```swift
import Foundation

/// The UI-free picker core (spec §3): Projects → Subprojects → Tasks as rows the menu renders.
/// No SwiftUI here, so every rule — skip-General, ordering, back, search paths — is unit-tested.
/// The Windows client's `PickerCore.cs` is a line-for-line port; change both together.

struct PickerTask: Equatable {
    let id: String
    let name: String
}

/// One subproject bucket. `id == nil` is the implicit default of a project decoded from a cache
/// written before subprojects existed — the client sends `subprojectId: null` and the server
/// derives it.
struct PickerSubproject: Equatable {
    let id: String?
    let name: String
    let isDefault: Bool
    let tasks: [PickerTask]
}

struct PickerProject: Equatable {
    let id: String
    let name: String
    /// Default first, then by name. Never empty.
    let subprojects: [PickerSubproject]

    /// Only the default is active: the subproject screen is skipped and search paths omit it.
    var skipsSubprojectLevel: Bool { subprojects.count == 1 && subprojects[0].isDefault }
    var defaultSubproject: PickerSubproject? { subprojects.first { $0.isDefault } }
    func subproject(_ id: String?) -> PickerSubproject? { subprojects.first { $0.id == id } }
}

enum PickerTree {
    /// Name of the implicit default built for a pre-subproject cache. Never displayed: such a
    /// project always skips the subproject level.
    static let implicitDefaultName = "General"

    static func build(_ projects: [Project]) -> [PickerProject] {
        projects.filter { !$0.archived }.map(node)
    }

    static func node(_ project: Project) -> PickerProject {
        let tasks = project.tasks ?? []
        let active = (project.subprojects ?? []).filter { !$0.archived }
        guard !active.isEmpty else {
            return PickerProject(id: project.id, name: project.name, subprojects: [
                PickerSubproject(id: nil, name: implicitDefaultName, isDefault: true, tasks: sorted(tasks)),
            ])
        }
        let ordered = active.sorted { a, b in
            a.isDefault != b.isDefault ? a.isDefault : precedes(a.name, b.name)
        }
        let defaultId = ordered.first { $0.isDefault }?.id
        return PickerProject(id: project.id, name: project.name, subprojects: ordered.map { sub in
            PickerSubproject(id: sub.id, name: sub.name, isDefault: sub.isDefault,
                             tasks: sorted(tasks.filter { ($0.subprojectId ?? defaultId) == sub.id }))
        })
    }

    static func precedes(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: .caseInsensitive) == .orderedAscending
    }

    private static func sorted(_ tasks: [ProjectTask]) -> [PickerTask] {
        tasks.sorted { precedes($0.name, $1.name) }.map { PickerTask(id: $0.id, name: $0.name) }
    }
}

enum PickerLevel: Equatable {
    case root
    case project(String)
    case subproject(projectId: String, subprojectId: String?)
}

struct PickerRow: Identifiable, Equatable {
    enum Action: Equatable {
        case back
        case open(PickerLevel)
        case track(StoredSelection)
    }

    let id: String
    let title: String
    let action: Action
}

enum PickerNavigation {
    static let separator = " › "

    static func open(_ project: PickerProject) -> PickerLevel {
        project.skipsSubprojectLevel
            ? .subproject(projectId: project.id, subprojectId: project.subprojects[0].id)
            : .project(project.id)
    }

    static func back(from level: PickerLevel, in tree: [PickerProject]) -> PickerLevel {
        guard case let .subproject(projectId, _) = normalize(level, in: tree),
              let project = tree.first(where: { $0.id == projectId }),
              !project.skipsSubprojectLevel
        else { return .root }
        return .project(projectId)
    }

    /// A level a refresh removed falls back to a valid one (ruling 5).
    static func normalize(_ level: PickerLevel, in tree: [PickerProject]) -> PickerLevel {
        switch level {
        case .root:
            return .root
        case let .project(id):
            guard let project = tree.first(where: { $0.id == id }) else { return .root }
            return open(project)
        case let .subproject(projectId, subprojectId):
            guard let project = tree.first(where: { $0.id == projectId }) else { return .root }
            return project.subproject(subprojectId) == nil ? open(project) : level
        }
    }

    static func rows(at level: PickerLevel, in tree: [PickerProject]) -> [PickerRow] {
        switch normalize(level, in: tree) {
        case .root:
            return tree.map { PickerRow(id: "p:\($0.id)", title: $0.name, action: .open(open($0))) }
        case let .project(id):
            guard let project = tree.first(where: { $0.id == id }) else { return rows(at: .root, in: tree) }
            return [PickerRow(id: "back", title: project.name, action: .back)]
                + project.subprojects.map { sub in
                    PickerRow(id: "s:\(sub.id ?? project.id)", title: sub.name,
                              action: .open(.subproject(projectId: project.id, subprojectId: sub.id)))
                }
        case let .subproject(projectId, subprojectId):
            guard let project = tree.first(where: { $0.id == projectId }),
                  let sub = project.subproject(subprojectId)
            else { return rows(at: .root, in: tree) }
            let skipped = project.skipsSubprojectLevel
            let backTitle = skipped ? project.name : project.name + separator + sub.name
            let noTask = (skipped ? project.name : sub.name) + " (no task)"
            return [
                PickerRow(id: "back", title: backTitle, action: .back),
                PickerRow(id: "n:\(sub.id ?? project.id)", title: noTask,
                          action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: nil))),
            ] + sub.tasks.map { task in
                PickerRow(id: "t:\(task.id)", title: task.name,
                          action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: task.id)))
            }
        }
    }

    /// The header strip's path for the current selection (ruling 4). Never renders a missing name.
    static func headerText(for selection: StoredSelection?, in tree: [PickerProject]) -> String {
        guard let selection, let project = tree.first(where: { $0.id == selection.projectId }) else {
            return "No project"
        }
        let taskHome = selection.taskId.flatMap { taskId in
            project.subprojects.first { $0.tasks.contains { $0.id == taskId } }
        }
        let sub = taskHome ?? project.subproject(selection.subprojectId)
        let task = selection.taskId.flatMap { taskId in taskHome?.tasks.first { $0.id == taskId } }
        var parts = [project.name]
        if let sub, !project.skipsSubprojectLevel { parts.append(sub.name) }
        if let task { parts.append(task.name) }
        return parts.joined(separator: separator)
    }

    /// Keyboard highlight (macOS). Nothing highlighted: Down starts at the top, Up at the bottom.
    static func moveHighlight(_ current: String?, by delta: Int, in rows: [PickerRow]) -> String? {
        guard !rows.isEmpty else { return nil }
        guard let current, let index = rows.firstIndex(where: { $0.id == current }) else {
            return delta >= 0 ? rows[0].id : rows[rows.count - 1].id
        }
        return rows[min(max(index + delta, 0), rows.count - 1)].id
    }
}

enum PickerSearch {
    static func isSearching(_ query: String) -> Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Flat full-path results across every level (spec §2). A lone default is omitted from paths.
    static func results(for query: String, in tree: [PickerProject]) -> [PickerRow] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return [] }
        var rows: [PickerRow] = []
        for project in tree {
            for sub in project.subprojects {
                let base = project.skipsSubprojectLevel ? [project.name] : [project.name, sub.name]
                if matches(base, q) {
                    rows.append(PickerRow(
                        id: "n:\(sub.id ?? project.id)",
                        title: base.joined(separator: PickerNavigation.separator),
                        action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: nil))))
                }
                for task in sub.tasks where matches(base + [task.name], q) {
                    rows.append(PickerRow(
                        id: "t:\(task.id)",
                        title: (base + [task.name]).joined(separator: PickerNavigation.separator),
                        action: .track(StoredSelection(projectId: project.id, subprojectId: sub.id, taskId: task.id))))
                }
            }
        }
        return rows
    }

    private static func matches(_ parts: [String], _ query: String) -> Bool {
        parts.contains { $0.range(of: query, options: .caseInsensitive) != nil }
    }
}
```

In `SelectionResolver.swift`, **add** this overload beside the existing one. Update the type's doc comment to describe the unified table and say the `Choice` overload is being retired.

```swift
    /// The unified stale-resolution table (spec §4), identical on Windows:
    /// nothing gone → as stored; task gone → same subproject, no task; subproject gone → the
    /// project's default, no task; project gone or archived → nil. A task that still exists wins
    /// over the stored subproject (it may have been moved). Also upgrades a 0.6.x selection,
    /// which has no `subprojectId`.
    static func resolve(_ stored: StoredSelection?, in projects: [Project]) -> StoredSelection? {
        guard let stored,
              let project = projects.first(where: { $0.id == stored.projectId && !$0.archived })
        else { return nil }
        let node = PickerTree.node(project)
        if let taskId = stored.taskId,
           let home = node.subprojects.first(where: { $0.tasks.contains { $0.id == taskId } }) {
            return StoredSelection(projectId: project.id, subprojectId: home.id, taskId: taskId)
        }
        if let subprojectId = stored.subprojectId, node.subproject(subprojectId) != nil {
            return StoredSelection(projectId: project.id, subprojectId: subprojectId, taskId: nil)
        }
        return StoredSelection(projectId: project.id, subprojectId: node.defaultSubproject?.id, taskId: nil)
    }
```

- [ ] **Step 4: Run the full Mac suite**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Projects/PickerCore.swift \
        apps/client-macos/Sources/TimeTrack/Projects/SelectionResolver.swift \
        apps/client-macos/Tests/TimeTrackTests/PickerCoreTests.swift \
        apps/client-macos/Tests/TimeTrackTests/SelectionResolverTests.swift
git commit -m "feat(client): add the macOS subproject picker core"
```

---

## Task 3: macOS — carry `subprojectId` through tracking, live span and sync

**Files:**

- Modify:
  - `Sources/TimeTrack/Tracking/TimeTracker.swift`
  - `Sources/TimeTrack/Sync/TimeEntryPayload.swift`
  - `Sources/TimeTrack/Storage/LiveSpanStore.swift`
  - `Sources/TimeTrack/Tracking/LiveSpanRecovery.swift`
  - `Sources/TimeTrack/Sync/LiveEntryPublisher.swift`
  - `Sources/TimeTrack/App/AutoTrackingCoordinator.swift`
  - `Sources/TimeTrack/App/ManualIdleCoordinator.swift`
  - `Sources/TimeTrack/App/AppDelegate.swift` (~l.900)
  - `Sources/TimeTrack/App/MenuViewModel.swift`
- Test:
  - `TimeTrackerTests.swift`
  - `TimeEntryPayloadTests.swift`
  - `LiveSpanStoreTests.swift`
  - `LiveSpanRecoveryTests.swift`
  - `LiveEntryPublisherTests.swift`
  - `AutoTrackingCoordinatorTests.swift`
  - `ManualIdleCoordinatorTests.swift`
  - every other test that constructs a `TimeTracker.Selection`, `LiveSpan` or `TimeEntryPayload`

All paths are under `apps/client-macos/`.

**Interfaces:**

- Produces:
  - `TimeTracker.Selection.init(projectId: String?, subprojectId: String?, taskId: String?, note: String? = nil)`. `subprojectId` is **required**, so the compiler lists every construction site, including `setNote`.
  - `TimeTracker.start(projectId: String?, subprojectId: String? = nil, taskId: String?, note:, source:, at:)`
  - `TimeTracker.recordSpan(id:start:end:projectId:subprojectId: String? = nil, taskId:source:note:)`
  - `TimeEntryPayload(id:projectId:subprojectId:taskId:startTime:endTime:source:note:)`, with `subprojectId` required and encoded with `encodeNil`.
  - `LiveSpan(entryId:startTime:projectId:subprojectId:taskId:source:lastAlive:userId:)`

`start` and `recordSpan` default `subprojectId` so the roughly 60 test call sites keep compiling. Every **production** call site listed below must pass it explicitly. Step 4 is a grep that proves it.

- [ ] **Step 1: Write the failing pass-through tests**

Every test uses a **non-default subproject with a nil task** (see Global Constraints).

`TimeTrackerTests.swift`:

```swift
    // A non-default subproject with NO task is the one case the server cannot re-derive: the
    // first write fixes the entry's subproject, so every path must carry it.
    func testTheSubprojectSurvivesStopNoteEditPauseResumeAndReselect() {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())

        tracker.start(projectId: "p1", subprojectId: "s2", taskId: nil)
        tracker.setNote("typing")                 // rebuilds the Selection in place
        clock.advance(60)
        tracker.pause()                           // closes entry #1
        tracker.resume()                          // opens entry #2 from the paused selection
        clock.advance(60)
        tracker.pause()                           // closes entry #2
        tracker.pause(reselecting: .init(projectId: "p1", subprojectId: "s3", taskId: nil))
        tracker.resume()
        tracker.stop()                            // closes entry #3

        XCTAssertEqual(spy.entries.count, 3)
        XCTAssertEqual(spy.object(at: 0)["subprojectId"] as? String, "s2")
        XCTAssertEqual(spy.object(at: 0)["note"] as? String, "typing")
        XCTAssertEqual(spy.object(at: 1)["subprojectId"] as? String, "s2")
        XCTAssertEqual(spy.object(at: 2)["subprojectId"] as? String, "s3")
    }

    func testRecordSpanCarriesTheSubproject() {
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: { self.t0 }, idGen: sequentialIdGen())
        tracker.recordSpan(start: t0, end: t0.addingTimeInterval(60),
                           projectId: "p1", subprojectId: "s2", taskId: nil, source: .auto)
        XCTAssertEqual(spy.object(at: 0)["subprojectId"] as? String, "s2")
    }

    func testANilSubprojectEncodesAsExplicitNull() {
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: { self.t0 }, idGen: sequentialIdGen())
        tracker.start(projectId: nil, taskId: nil)
        tracker.stop()
        XCTAssertTrue(spy.object(at: 0)["subprojectId"] is NSNull, "present as null, like projectId")
    }
```

`TimeEntryPayloadTests.swift`: add `subprojectId: nil,` after `projectId: nil,` in its four existing constructions, and add:

```swift
    func testEncodesTheSubprojectAndANilOneAsNull() throws {
        let withSub = try encoded(TimeEntryPayload(
            id: "e1", projectId: "p1", subprojectId: "s2", taskId: nil,
            startTime: "2026-09-29T09:00:00Z", endTime: "2026-09-29T10:00:00Z",
            source: "MANUAL", note: nil))
        XCTAssertEqual(withSub["subprojectId"] as? String, "s2")

        let without = try encoded(TimeEntryPayload(
            id: "e1", projectId: nil, subprojectId: nil, taskId: nil,
            startTime: "2026-09-29T09:00:00Z", endTime: nil, source: "MANUAL", note: nil))
        XCTAssertTrue(without["subprojectId"] is NSNull)
    }
```

`LiveSpanStoreTests.swift`: change `sel` to `.init(projectId: "p1", subprojectId: "s2", taskId: nil)`, and change the `taskId` assertion in `testBeginWritesASpanThatLoadRoundTrips` to `XCTAssertNil(span?.taskId)`. Also add `subprojectId: nil,` to the two `LiveSpan(...)` constructions in `testShouldRecoverGate`. Then add:

```swift
    func testBeginPersistsTheSubproject() {
        let (store, _) = makeStore()
        store.begin(entryId: "e1", startTime: t0, selection: sel, source: .manual)
        XCTAssertEqual(store.load()?.subprojectId, "s2")
    }

    /// A live-span.json written by 0.6.x has no subprojectId; recovery must still read it.
    func testLoadsASpanWrittenBeforeSubprojectsExisted() throws {
        let (store, url) = makeStore()
        let legacy = try JSONEncoder().encode(LiveSpan(entryId: "e1", startTime: t0, projectId: "p1",
                                                       subprojectId: nil, taskId: nil, source: "MANUAL",
                                                       lastAlive: t0, userId: "user-1"))
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: legacy) as? [String: Any])
        object.removeValue(forKey: "subprojectId")
        try JSONSerialization.data(withJSONObject: object).write(to: url)

        XCTAssertEqual(store.load()?.entryId, "e1")
        XCTAssertNil(store.load()?.subprojectId)
    }
```

`LiveSpanRecoveryTests.swift`: in `span(userId:)`, add `subprojectId: "s2",` after `projectId: "p1",` and change `taskId: "k1"` to `taskId: nil`. If any existing assertion in the file checks `taskId == "k1"`, change it to `taskId is NSNull`. Add:

```swift
    func testKeepCarriesTheSubproject() {
        let (recovery, buffer, _) = make(currentUserId: "u1")
        recovery.apply(.keep, to: span(userId: "u1"))
        XCTAssertEqual(buffer.object(at: 0)["subprojectId"] as? String, "s2")
    }
```

`LiveEntryPublisherTests.swift`:

- Change the `TimeTracker.Selection(projectId: nil, taskId: nil)` constructions to `TimeTracker.Selection(projectId: nil, subprojectId: nil, taskId: nil)`.
- Add `subprojectId: nil,` to the `LiveSpan(...)` constructions.
- Add:

```swift
    func testBothOverloadsSendTheSubproject() async throws {
        let spy = SpyUploader()
        let publisher = LiveEntryPublisher(uploader: spy)
        await publisher.publish(entryId: "01920000-0000-7000-8000-000000000012",
                                start: Date(timeIntervalSince1970: 1_787_000_000),
                                selection: TimeTracker.Selection(projectId: "p1", subprojectId: "s2", taskId: nil),
                                source: .manual)
        await publisher.publish(LiveSpan(entryId: "01920000-0000-7000-8000-000000000013",
                                         startTime: Date(timeIntervalSince1970: 1_787_000_000),
                                         projectId: "p1", subprojectId: "s2", taskId: nil, source: "AUTO",
                                         lastAlive: Date(timeIntervalSince1970: 1_787_000_600), userId: nil))
        XCTAssertEqual(try json(spy.bodies[0])["subprojectId"] as? String, "s2")
        XCTAssertEqual(try json(spy.bodies[1])["subprojectId"] as? String, "s2")
    }
```

`AutoTrackingCoordinatorTests.swift`: change the default `selection:` of `make` to `.init(projectId: "p1", subprojectId: "s2", taskId: nil)`. Update the `.init(projectId: nil, taskId: nil)` sites to `.init(projectId: nil, subprojectId: nil, taskId: nil)`. If an existing assertion expects `taskId == "k1"` from the default selection, pass the old selection explicitly to that test's `make(selection: .init(projectId: "p1", subprojectId: nil, taskId: "k1"))` rather than weakening it. Then add:

```swift
    func testAutoStartAndTheKeepBridgeCarryTheSubproject() {
        let (coordinator, _, spy, clock, resolver) = make(threshold: 300)
        coordinator.activate()                                   // AUTO entry opens at t0
        clock.advance(300); coordinator.tick(idleSeconds: 300)   // stops it at the away start
        clock.advance(120); coordinator.tick(idleSeconds: 5)     // back → prompt
        resolver()?(.keep)                                       // bridge span is recorded

        let entries = spy.entries.indices
            .filter { spy.entries[$0].kind == .timeEntry }
            .map { spy.object(at: $0) }
        XCTAssertGreaterThanOrEqual(entries.count, 2, "the auto entry and the Keep bridge")
        XCTAssertTrue(entries.allSatisfy { $0["subprojectId"] as? String == "s2" })
    }
```

`ManualIdleCoordinatorTests.swift`: add the following test. It follows the file's existing Discard test; copy the tick sequence from `testKeepLeavesEntryRunningAndEmitsKeptIdleEvent` and resolve with `.discard`.

```swift
    func testDiscardRestartKeepsTheSubproject() {
        let (c, tracker, spy, clock, resolver, _, _) = make(threshold: 300)
        tracker.start(projectId: "p1", subprojectId: "s2", taskId: nil)
        c.tick(idleSeconds: 0)
        clock.advance(300); c.tick(idleSeconds: 300)
        clock.advance(120); c.tick(idleSeconds: 5)
        resolver()?(.discard)                                  // trims + reopens at the return

        guard case let .tracking(_, _, selection, _) = tracker.state else {
            return XCTFail("the replacement entry should be running")
        }
        XCTAssertEqual(selection.subprojectId, "s2")
        XCTAssertEqual(timeEntries(spy).first?["subprojectId"] as? String, "s2")
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`

Expected: build FAILURE (the `subprojectId` labels do not exist yet).

- [ ] **Step 3: Implement**

`TimeTracker.swift`:

```swift
    struct Selection: Equatable {
        let projectId: String?
        /// Required label, deliberately: `setNote`, `pause(reselecting:)` and every coordinator
        /// rebuild a Selection, and a defaulted field here would compile while silently dropping
        /// the subproject — which the server then fixes to General forever (it writes the
        /// subproject only when it creates the row).
        let subprojectId: String?
        let taskId: String?
        /// What the person says they were doing. Free text, theirs, and optional.
        let note: String?

        init(projectId: String?, subprojectId: String?, taskId: String?, note: String? = nil) {
            self.projectId = projectId
            self.subprojectId = subprojectId
            self.taskId = taskId
            self.note = note
        }
    }
```

In the same file:

- Add `subprojectId: String? = nil` after `projectId` in `start(...)` and in `recordSpan(...)`, and pass it into `Selection(...)` / `enqueue(...)`.
- `setNote` builds `Selection(projectId: selection.projectId, subprojectId: selection.subprojectId, taskId: selection.taskId, note: note)`.
- `close` passes `subprojectId: selection.subprojectId`.
- `enqueue` gains a `subprojectId: String?` parameter and passes it to `TimeEntryPayload`.

`TimeEntryPayload.swift`:

- Add `let subprojectId: String?` after `projectId`.
- Add `subprojectId` to `CodingKeys` after `projectId`.
- In `encode`, add `if let subprojectId { try c.encode(subprojectId, forKey: .subprojectId) } else { try c.encodeNil(forKey: .subprojectId) }`.
- In the doc comment, add `subprojectId` to the list of `.nullable()` fields. The server schema is `.nullable().optional()`, and sending an explicit null means "derive it".

`LiveSpanStore.swift`: add `let subprojectId: String?` after `projectId` in `LiveSpan`. An Optional `let` decodes with `decodeIfPresent`, so an old file still loads. `begin` writes `subprojectId: selection.subprojectId`.

`LiveSpanRecovery.swift`: pass `subprojectId: span.subprojectId` to `recordSpan`.

`LiveEntryPublisher.swift`: pass `subprojectId: selection.subprojectId` and `subprojectId: span.subprojectId` in the two `TimeEntryPayload(...)` constructions.

`AutoTrackingCoordinator.swift`: `tracker.start(projectId: s.projectId, subprojectId: s.subprojectId, taskId: s.taskId, source: .auto)`, and the same `subprojectId: s.subprojectId` in the Keep `recordSpan`.

`ManualIdleCoordinator.swift`: `tracker.start(projectId: selection.projectId, subprojectId: selection.subprojectId, taskId: selection.taskId, note: selection.note, source: .manual, at: resume)`.

`AppDelegate.swift` ~l.900: `.init(projectId: nil, subprojectId: nil, taskId: nil)`.

`MenuViewModel.swift` (ruling 9, temporary until Task 4): pass `subprojectId: nil` in:

- `selectionForAuto`;
- `select`'s `tracker.start` and `pause(reselecting:)`;
- `start()`.

Add one comment at `selectionForAuto`: "`Choice` has no subproject; the server derives it (as for shipped clients). Replaced by the subproject picker."

Then fix every remaining test construction the compiler reports: `TimeTracker.Selection(...)` / `.init(projectId:...)` / `LiveSpan(...)` gets `subprojectId: nil`. Do **not** change assertions beyond what Step 1 lists.

- [ ] **Step 4: Prove every production site passes the subproject**

Run:

```bash
cd apps/client-macos && grep -rn -A6 "\.start(projectId\|recordSpan(\|TimeEntryPayload(\|LiveSpan(entryId" Sources
```

Read every hit through the end of its call. Each call must name `subprojectId`, except the function _declarations_ in `TimeTracker.swift`. A call without it silently drops the subproject; fix it. `Selection(...)` construction needs no check, because its label is required and the compiler already enforces it.

- [ ] **Step 5: Run the full Mac suite**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client-macos/Sources apps/client-macos/Tests
git commit -m "feat(client): send the subproject from the macOS tracker"
```

---

## Task 4: macOS — drill-down picker in the view model and menu

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/App/MenuViewModel.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/UI/MenuBarView.swift` (the `picker`, `pickerListHeight` and `header` sections)
- Modify: `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift` (`menuDidOpen`)
- Modify: `apps/client-macos/Sources/TimeTrack/Projects/SelectionResolver.swift` (remove the `Choice` overload)
- Test: `apps/client-macos/Tests/TimeTrackTests/MenuViewModelTests.swift`

**Interfaces:**

- Consumes: Task 2 core, Task 3 `start(projectId:subprojectId:taskId:...)`.
- Produces on `MenuViewModel`:
  - `@Published private(set) var selection: StoredSelection?` (replaces `selectedChoice`)
  - `@Published private(set) var level: PickerLevel`
  - `@Published private(set) var highlightedRowId: String?`
  - `var pickerRows: [PickerRow]`
  - `var selectionHeader: String`
  - `func isCurrent(_ row: PickerRow) -> Bool`
  - `func activate(_ row: PickerRow)`
  - `func moveHighlight(by delta: Int)`
  - `func activateHighlighted()`
  - `func pickerDidOpen()`
  - `func select(_ selection: StoredSelection)`
  - `Choice`, `choices` and `filteredChoices` are **deleted**.

- [ ] **Step 1: Rewrite the affected tests (failing)**

In `MenuViewModelTests.swift`:

- Delete `private func choice(_:)`. Add:

```swift
    private func sel(_ projectId: String, _ subprojectId: String? = nil, _ taskId: String? = nil) -> StoredSelection {
        StoredSelection(projectId: projectId, subprojectId: subprojectId, taskId: taskId)
    }
```

- Replace every `vm.select(choice("x"))` with `vm.select(sel("x"))`.
- Replace every `vm.select(Choice(id: …, projectId: P, taskId: T, …))` with `vm.select(sel(P, nil, T))`.
- Replace `vm.selectedChoice?.id == "k1"` with `vm.selection?.taskId == "k1"`, `vm.selectedChoice?.projectId` with `vm.selection?.projectId`, and `XCTAssertNil(vm.selectedChoice)` with `XCTAssertNil(vm.selection)`.
- Delete `testFilteredChoicesMatchQuery`.

Then add:

```swift
    private let tree: [Project] = [
        Project(id: "p1", teamId: "t1", name: "Acme", archived: false,
                tasks: [ProjectTask(id: "k1", projectId: "p1", name: "Cart", subprojectId: "s2")],
                subprojects: [Subproject(id: "s1", projectId: "p1", name: "General", archived: false, isDefault: true),
                              Subproject(id: "s2", projectId: "p1", name: "Checkout", archived: false, isDefault: false)]),
        Project(id: "p2", teamId: "t1", name: "Beta", archived: false, tasks: nil,
                subprojects: [Subproject(id: "s3", projectId: "p2", name: "General", archived: false, isDefault: true)]),
    ]

    func testDrillingDownAndTrackingASubprojectWithNoTask() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.projects = tree
        vm.activate(vm.pickerRows[0])                              // Acme → subproject screen
        XCTAssertEqual(vm.level, .project("p1"))
        vm.activate(vm.pickerRows.first { $0.title == "Checkout" }!)
        XCTAssertEqual(vm.pickerRows.map(\.title), ["Acme › Checkout", "Checkout (no task)", "Cart"])
        vm.activate(vm.pickerRows[1])                              // track Checkout, no task

        XCTAssertEqual(vm.selection, sel("p1", "s2", nil))
        XCTAssertTrue(vm.isCurrent(vm.pickerRows[1]))
        XCTAssertEqual(vm.selectionHeader, "Acme › Checkout")

        vm.start(); clock.advance(60); vm.stop()
        XCTAssertEqual(spy.object(at: 0)["subprojectId"] as? String, "s2")
        XCTAssertTrue(spy.object(at: 0)["taskId"] is NSNull)
    }

    func testAProjectWithOnlyGeneralSkipsToItsTasksAndBackReturnsToRoot() {
        let vm = makeVM()
        vm.projects = tree
        vm.activate(vm.pickerRows[1])                              // Beta
        XCTAssertEqual(vm.level, .subproject(projectId: "p2", subprojectId: "s3"))
        vm.activate(vm.pickerRows[0])                              // ‹ Beta
        XCTAssertEqual(vm.level, .root)
    }

    func testSearchTracksAResultImmediatelyAndClearingRestoresTheLevel() {
        let (vm, _, _) = makeSwitchableVM()
        vm.projects = tree
        vm.activate(vm.pickerRows[0])                              // at Acme's subproject screen
        vm.query = "cart"
        XCTAssertEqual(vm.pickerRows.map(\.title), ["Acme › Checkout › Cart"])
        vm.activate(vm.pickerRows[0])
        XCTAssertEqual(vm.selection, sel("p1", "s2", "k1"))
        vm.query = ""
        XCTAssertEqual(vm.level, .project("p1"))
    }

    func testSwitchingWhileTrackingRefilesUnderTheNewSubproject() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.projects = tree
        vm.select(sel("p1", "s1", nil))
        vm.start(); clock.advance(60)
        vm.select(sel("p1", "s2", nil))
        clock.advance(60); vm.stop()
        XCTAssertEqual(spy.object(at: 0)["subprojectId"] as? String, "s1")
        XCTAssertEqual(spy.object(at: 1)["subprojectId"] as? String, "s2")
    }

    func testSwitchingWhilePausedResumesUnderTheNewSubproject() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.projects = tree
        vm.select(sel("p1", "s1", nil))
        vm.start(); clock.advance(60); vm.pause()
        vm.select(sel("p1", "s2", nil))
        vm.resume(); clock.advance(60); vm.stop()
        XCTAssertEqual(spy.object(at: 1)["subprojectId"] as? String, "s2")
    }

    func testAutoSelectionCarriesTheSubproject() {
        let vm = makeVM()
        vm.select(sel("p1", "s2", nil))
        XCTAssertEqual(vm.selectionForAuto, TimeTracker.Selection(projectId: "p1", subprojectId: "s2", taskId: nil))
    }

    func testKeyboardHighlightMovesAndReturnActivates() {
        let vm = makeVM()
        vm.projects = tree
        vm.moveHighlight(by: 1)
        XCTAssertEqual(vm.highlightedRowId, "p:p1")
        vm.moveHighlight(by: 1)
        vm.activateHighlighted()                                   // Beta
        XCTAssertEqual(vm.level, .subproject(projectId: "p2", subprojectId: "s3"))
        XCTAssertNil(vm.highlightedRowId, "a level change resets the highlight")
        vm.activateHighlighted()                                   // nothing highlighted → first row (back)
        XCTAssertEqual(vm.level, .root)
    }

    func testReopeningStartsAtTheRootAndSignOutClearsTheLevel() {
        let vm = makeVM()
        vm.projects = tree
        vm.activate(vm.pickerRows[0])
        vm.pickerDidOpen()
        XCTAssertEqual(vm.level, .root)
        vm.activate(vm.pickerRows[0])
        vm.reset()
        XCTAssertEqual(vm.level, .root)
        XCTAssertNil(vm.selection)
    }

    func testRestoreUpgradesAnOldStoredSelectionToTheDefaultSubproject() {
        let store = makeIsolatedStore()
        store.save(StoredSelection(projectId: "p1", taskId: nil), userId: "u1")
        let vm = makeVM(selectionStore: store)
        vm.projects = tree
        vm.restoreSelection(userId: "u1")
        XCTAssertEqual(vm.selection, sel("p1", "s1", nil))
    }
```

Update the existing restore tests:

- `testRestoreAppliesAStoredSelectionThatStillExists` and its neighbours need `vm.projects` to be set to a list containing `p1` before `restoreSelection`. Most already set one; keep it.
- A stored `taskId` that no longer exists is now _degraded_ (task gone → same subproject), not dropped. If an existing test asserts the old drop behaviour for a missing task, change it to expect `sel("p1", <default id>, nil)` and add a comment naming ruling/spec §4. The missing-**project** tests keep expecting nil and a cleared store.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter MenuViewModelTests`

Expected: build FAILURE (`selection`, `pickerRows` and the other new members do not exist yet).

- [ ] **Step 3: Implement the view model**

In `MenuViewModel.swift`:

- Delete the `Choice` struct, `choices` and `filteredChoices`.
- Replace `selectedChoice` with `selection`.
- Make `query` reset the highlight: `@Published var query: String = "" { didSet { highlightedRowId = nil } }`.
- Add:

```swift
    /// The picker's current selection. Always resolved against the current tree (spec §4).
    @Published private(set) var selection: StoredSelection?
    /// Where the drill-down is. Reset to the root each time the dropdown opens.
    @Published private(set) var level: PickerLevel = .root { didSet { highlightedRowId = nil } }
    /// Keyboard highlight (Up/Down); Return activates it.
    @Published private(set) var highlightedRowId: String?

    private var tree: [PickerProject] { PickerTree.build(projects) }

    /// Search results while searching, else the drill-down level's rows. The level survives a
    /// search, so clearing the text returns to it.
    var pickerRows: [PickerRow] {
        PickerSearch.isSearching(query)
            ? PickerSearch.results(for: query, in: tree)
            : PickerNavigation.rows(at: level, in: tree)
    }

    var selectionHeader: String { PickerNavigation.headerText(for: selection, in: tree) }

    func isCurrent(_ row: PickerRow) -> Bool {
        if case let .track(s) = row.action { return s == selection }
        return false
    }

    func activate(_ row: PickerRow) {
        switch row.action {
        case .back: level = PickerNavigation.back(from: level, in: tree)
        case let .open(target): level = target
        case let .track(s): select(s)
        }
    }

    func moveHighlight(by delta: Int) {
        highlightedRowId = PickerNavigation.moveHighlight(highlightedRowId, by: delta, in: pickerRows)
    }

    /// Return: the highlighted row, or the first one when nothing is highlighted.
    func activateHighlighted() {
        let rows = pickerRows
        guard let row = rows.first(where: { $0.id == highlightedRowId }) ?? rows.first else { return }
        activate(row)
    }

    /// Closing and reopening the dropdown starts at the root (spec §2). The query is kept.
    func pickerDidOpen() {
        level = .root
        highlightedRowId = nil
    }
```

Then:

- `select(_ selection: StoredSelection)`: the body is the old `select(_ choice:)` with `choice.x` replaced by `selection.x`. Pass `subprojectId: selection.subprojectId` to `tracker.start` and `TimeTracker.Selection(...)` in the `.paused` branch. `persist` saves the selection as is.
- `selectionForAuto`: `TimeTracker.Selection(projectId: selection?.projectId, subprojectId: selection?.subprojectId, taskId: selection?.taskId)`.
- `start()`: `tracker.start(projectId: selection?.projectId, subprojectId: selection?.subprojectId, taskId: selection?.taskId, note: trimmedNote)`.
- `restoreSelection`: keep both guards (never overwrite a hand-made pick; never clear on an empty list). Replace the body's resolution with:

```swift
        guard selection == nil else { return }
        guard let stored = selectionStore.load(userId: userId) else { return }
        if let restored = SelectionResolver.resolve(stored, in: projects) {
            selection = restored
        } else if !projects.isEmpty {
            selectionStore.clear(userId: userId)
        }
```

- `reset()`: `selection = nil`, `level = .root`, `highlightedRowId = nil`, plus the existing lines.
- Remove the `selectionForAuto` comment added in Task 3.

In `SelectionResolver.swift`, delete the `resolve(_:in choices: [Choice])` overload and the old type doc comment, keeping the unified one.

In `AppDelegate.menuDidOpen()`, call `menuViewModel.pickerDidOpen()` before `refreshProjectsOnMenuOpen()`.

- [ ] **Step 4: Implement the view**

In `MenuBarView.swift`, replace `pickerListHeight` and `picker`:

```swift
    private var pickerListHeight: CGFloat {
        let rows = max(viewModel.pickerRows.count, 1)
        return min(CGFloat(rows) * 32, 300)
    }

    @ViewBuilder private var picker: some View {
        VStack(alignment: .leading, spacing: TT.Space.x2) {
            Text("SWITCH PROJECT")
                .font(.ttCaption).foregroundStyle(TT.Palette.textSecondary)
            // The current selection as a path, always visible whichever level the list shows.
            HStack(spacing: 6) {
                Circle().fill(viewModel.selection == nil ? TT.Palette.textSecondary : TT.Palette.accent)
                    .frame(width: 6, height: 6)
                Text(viewModel.selectionHeader).font(.ttCaption).lineLimit(1).truncationMode(.middle)
            }
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(TT.Palette.textSecondary)
                TextField("Search projects and tasks", text: $viewModel.query)
                    .textFieldStyle(.plain)
                    .onSubmit { viewModel.activateHighlighted() }
                    // Verified by hand (Task 5). If the field editor swallows the arrows, move
                    // these two to the ScrollView below and make it `.focusable()`.
                    .onKeyPress(.downArrow) { viewModel.moveHighlight(by: 1); return .handled }
                    .onKeyPress(.upArrow) { viewModel.moveHighlight(by: -1); return .handled }
            }
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(TT.Palette.surface, in: RoundedRectangle(cornerRadius: TT.Radius.sm))

            ScrollView {
                VStack(spacing: 0) {
                    ForEach(viewModel.pickerRows) { row in
                        Button { viewModel.activate(row) } label: { pickerRow(row) }
                            .buttonStyle(.plain)
                    }
                }
            }
            // Definite height (see pickerListHeight) so the list isn't squeezed to ~2 rows once
            // the tracking header grows; caps before it starts scrolling.
            .frame(height: pickerListHeight)
        }
        .padding(.horizontal, TT.Space.x4)
        .padding(.vertical, TT.Space.x3)
    }

    @ViewBuilder private func pickerRow(_ row: PickerRow) -> some View {
        HStack(spacing: 6) {
            if case .back = row.action {
                Image(systemName: "chevron.left").foregroundStyle(TT.Palette.textSecondary)
            }
            Text(row.title)
                .font(row.action == .back ? .ttCaption : .ttLabel)
                .foregroundStyle(row.action == .back ? TT.Palette.textSecondary : TT.Palette.text)
                .lineLimit(1).truncationMode(.middle)
            Spacer()
            if viewModel.isCurrent(row) {
                Image(systemName: "checkmark").foregroundStyle(TT.Palette.accent)
            }
            if case .open = row.action {
                Image(systemName: "chevron.right").foregroundStyle(TT.Palette.textSecondary)
            }
        }
        .contentShape(Rectangle())
        .padding(.horizontal, 8).padding(.vertical, 7)
        .background(viewModel.highlightedRowId == row.id ? TT.Palette.surface : Color.clear,
                    in: RoundedRectangle(cornerRadius: TT.Radius.sm))
    }
```

If a `TT.Palette` or font token named here does not exist, use the nearest existing one from `TimeTrackTokens.swift`; do not add tokens.

- [ ] **Step 5: Run the full Mac suite and build**

Run:

```bash
cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build
```

Expected: all PASS; the build succeeds. `grep -rn "Choice\b\|selectedChoice\|filteredChoices" Sources Tests` prints only the unrelated `DefaultChoice`/`defaultChoice` lines in `TimePromptView`, `AwayResolutionView` and `RecoveryView`.

- [ ] **Step 6: Commit**

```bash
git add apps/client-macos/Sources apps/client-macos/Tests
git commit -m "feat(client): drill-down subproject picker in the macOS menu"
```

---

## Task 5: macOS — hand verification and 0.7.0

**Files:**

- Modify: `apps/client-macos/Info.plist` (`CFBundleShortVersionString` 0.6.3 → 0.7.0; `CFBundleVersion` +1)

- [ ] **Step 1: Run the local stack**

Run `docker compose -f infra/docker-compose.yml up -d`, then `pnpm dev` from the repo root. The API is on 3001. Kill any stale `pnpm dev` first; see memory "Stale dev API blanks the dashboard".

In the dashboard, make sure one local project has a second subproject with a task (for example "Backend Migration" → "Checkout (verify)" → "Pay form (verify)", already in the local DB) and another project has only General.

- [ ] **Step 2: Build and install the app**

Build and install it the way previous client releases were installed locally, with `CODESIGN_IDENTITY` pinned to the niftyitsolution Apple Development identity (see memory "Client reinstall signing identity"). This keeps the TCC grants.

- [ ] **Step 3: Check by hand and note each result in the PR body**

1. The root lists projects with `›`. The header strip reads "No project" or the current path.
2. The project with two subprojects opens its subproject screen: back row, General first, then the others.
3. The General-only project goes straight to its tasks, titled with the project. The first row is "<Project> (no task)".
4. Back returns one level. Closing and reopening the menu starts at the root.
5. Search "pay" shows `Backend Migration › Checkout (verify) › Pay form (verify)`. Clicking it tracks immediately, and clearing the search returns to the previous level.
6. Up/Down move a highlight and Return activates. If the arrows do nothing, apply the ruling 7 fallback: `.onKeyPress` on a `.focusable()` ScrollView. Commit that as `fix(client): …` and re-check.
7. While tracking, switch to "Checkout (verify) (no task)", wait a minute and stop. On the dashboard `/me` day view the entry reads `Backend Migration · Checkout (verify)`.

- [ ] **Step 4: Bump the version and commit**

```bash
git add apps/client-macos/Info.plist
git commit -m "build(client): bump the macOS client to 0.7.0"
```

---

## Task 6: Windows — models, selection pass-through and wire payload

**Files (all under `apps/client-windows/`):**

- Modify:
  - `src/NiftyTimer/Projects/Project.cs`
  - `src/NiftyTimer/Projects/RecentSelectionClient.cs`
  - `src/NiftyTimer/Tracking/TimeTracker.cs`
  - `src/NiftyTimer/Sync/TimeEntryPayload.cs`
  - `src/NiftyTimer/Storage/LiveSpanStore.cs`
  - `src/NiftyTimer/Tracking/LiveSpanRecovery.cs`
  - `src/NiftyTimer/Sync/LiveEntryPublisher.cs`
  - `src/NiftyTimer/App/AutoTrackingCoordinator.cs`
  - `src/NiftyTimer/App/ManualIdleCoordinator.cs`
  - `src/NiftyTimer/App/MenuViewModel.cs` (the `SelectionForAuto`, `Start` and `SelectProject` pass-through only)
- Test:
  - `tests/NiftyTimer.Tests/TrackingTests.cs`
  - `WireContractTests.cs`
  - `AutoTrackingTests.cs`
  - `ManualIdleTests.cs`
  - `RecoveryTests.cs`
  - `AppAndProjectTests.cs`
  - `CaptureStorageTests.cs` or `StorageAndSyncTests.cs` (wherever `LiveSpanStore` is tested; grep for `new LiveSpanStore(`)

**Interfaces:**

- Produces (every new member is trailing with `= null`, so existing positional construction keeps compiling):
  - `public sealed record Subproject(string Id, string ProjectId, string Name, bool Archived, bool IsDefault)` with JSON names `id`, `projectId`, `name`, `archived`, `isDefault`
  - `Project(..., IReadOnlyList<ProjectTask>? Tasks, IReadOnlyList<Subproject>? Subprojects = null)`
  - `ProjectTask(string Id, string ProjectId, string Name, string? SubprojectId = null)`
  - `StoredSelection(string ProjectId, string? TaskId, string? SubprojectId = null)`
  - `RecentEntryRow(..., string? TaskId, string? SubprojectId = null)`
  - `TimeTracker.Selection(string? ProjectId, string? TaskId, string? Note = null, string? SubprojectId = null)`
  - `TimeTracker.Start(string? projectId, string? taskId, string? note = null, EntrySource source = Manual, DateTimeOffset? startTime = null, string? subprojectId = null)`
  - `TimeTracker.RecordSpan(start, end, projectId, taskId, source, note = null, id = null, string? subprojectId = null)`
  - `TimeEntryPayload.SubprojectId` (JSON `subprojectId`, explicit null)
  - `LiveSpan.SubprojectId` (JSON `subprojectId`)

- [ ] **Step 1: Open the draft PR so Windows CI runs**

Push the branch and open a **draft** PR against `main`. Check the work account first (`gh auth status`, see memory "Use the work GitHub account"). `client-windows.yml` runs only on `pull_request`.

```bash
git push -u origin feat/subprojects-clients
gh pr create --draft --base main --title "feat(client): subproject pickers in the desktop clients" \
  --body "Phase 2 of subprojects. Spec: docs/superpowers/specs/2026-09-29-subprojects-clients-design.md. Plan: docs/superpowers/plans/2026-09-29-subprojects-clients.md. Draft while the Windows tasks land."
```

If `gh pr create` fails, give the user the `pull/new` link printed by the push and continue; CI starts once the PR exists.

- [ ] **Step 2: Write the tests**

Every pass-through test uses a non-default subproject with a null task.

`TrackingTests.cs` (class `TimeTrackerTests`):

```csharp
    /// <summary>
    /// A non-default subproject with no task is the one case the server cannot re-derive: the first
    /// write fixes the entry's subproject, so every path that rebuilds a selection must carry it.
    /// </summary>
    [Fact]
    public void TheSubprojectSurvivesStopNoteEditPauseResumeAndReselect()
    {
        var now = T0;
        var (tracker, buffer, _) = NewTracker(() => now);

        tracker.Start("p1", null, subprojectId: "s2");
        tracker.SetNote("typing");
        now = T0.AddMinutes(1);
        tracker.Pause();
        tracker.Resume();
        now = T0.AddMinutes(2);
        tracker.Pause();
        tracker.Reselect(new TimeTracker.Selection("p1", null, SubprojectId: "s3"));
        tracker.Resume();
        tracker.Stop();

        var payloads = buffer.Entries.Select(e => Decode(e.Payload)).ToList();
        Assert.Equal(["s2", "s2", "s3"], payloads.Select(p => p.SubprojectId));
        Assert.Equal("typing", payloads[0].Note);
    }

    [Fact]
    public void RecordSpanCarriesTheSubproject()
    {
        var (tracker, buffer, _) = NewTracker(() => T0);
        tracker.RecordSpan(T0, T0.AddMinutes(1), "p1", null, TimeTracker.EntrySource.Auto, subprojectId: "s2");
        Assert.Equal("s2", Decode(Assert.Single(buffer.Entries).Payload).SubprojectId);
    }
```

Also in `TrackingTests.cs`, in the `LiveEntryPublisher` test class: change the shared `Selection` to `new("p1", null, SubprojectId: "s2")`. Then add:

```csharp
    [Fact]
    public async Task OpenCloseAndHeartbeatAllSendTheSubproject()
    {
        var uploader = new FakeUploader();
        var publisher = new LiveEntryPublisher(uploader);

        await Publish(publisher);
        await publisher.PublishCloseAsync(Closed());
        await publisher.HeartbeatAsync(new TrackerState.Tracking("entry-1", T0, Selection, TimeTracker.EntrySource.Manual));

        Assert.All(uploader.Uploads, body =>
            Assert.Equal("s2", JsonSerializer.Deserialize<TimeEntryPayload>(body)!.SubprojectId));
    }
```

If an existing assertion in that class checks `TaskId == "t1"`, change it to `Assert.Null(payload.TaskId)`.

`WireContractTests.cs` `SendsExactlyTheFieldsTheSchemaDefines`: add `SubprojectId = "s1",` to the payload, and change the expected keys to `["endTime", "id", "note", "projectId", "source", "startTime", "subprojectId", "taskId"]`. Add:

```csharp
    /// <summary><c>subprojectId</c> is nullable on the server, so null is sent explicitly — the server then derives it.</summary>
    [Fact]
    public void ANullSubprojectIsSentAsExplicitNull()
    {
        var json = Serialize(new TimeEntryPayload
        {
            Id = "0192f000-0000-7000-8000-000000000000",
            StartTime = "2026-08-25T09:00:00Z",
            Source = "MANUAL",
        });
        Assert.Equal(JsonValueKind.Null, JsonDocument.Parse(json).RootElement.GetProperty("subprojectId").ValueKind);
    }

    /// <summary>A queued payload written by 0.2.x has no subprojectId and must still read back.</summary>
    [Fact]
    public void APayloadQueuedBeforeSubprojectsStillDeserializes()
    {
        var old = """{"id":"e1","projectId":"p1","taskId":null,"startTime":"2026-08-25T09:00:00Z","endTime":"2026-08-25T09:30:00Z","source":"MANUAL"}""";
        var payload = JsonSerializer.Deserialize<TimeEntryPayload>(old)!;
        Assert.Equal("p1", payload.ProjectId);
        Assert.Null(payload.SubprojectId);
    }
```

`AutoTrackingTests.cs`: add

```csharp
    [Fact]
    public void AutoStartAndTheKeepBridgeCarryTheSubproject()
    {
        var h = Harness.Build();
        h.Selection = new TimeTracker.Selection("p1", null, SubprojectId: "s2");
        h.Coordinator.Activate();
        h.Now = T0.AddMinutes(5);
        h.Coordinator.Tick(300);            // auto-stop at the away start
        h.Now = T0.AddMinutes(7);
        h.Coordinator.Tick(5);              // back → prompt
        h.Resolve!(AwayResolution.Keep);    // bridge span recorded

        Assert.True(h.TimeEntries().Count >= 2);
        Assert.All(h.TimeEntries(), e => Assert.Equal("s2", e.SubprojectId));
    }
```

If the harness's tick/resolve names differ, follow the file's existing Keep test (search `AwayResolution.Keep`) and keep the two assertions.

`ManualIdleTests.cs`: add a test modelled on the file's existing Discard test (search `AwayResolution.Discard`). It must start with `h.Tracker.Start("p1", null, subprojectId: "s2")` and assert both:

```csharp
        Assert.Equal("s2", ((TrackerState.Tracking)h.Tracker.State).Selection.SubprojectId);
        Assert.Equal("s2", h.TimeEntries()[0].SubprojectId);
```

`RecoveryTests.cs`: in `Span(...)`, set `SubprojectId = "s2"` and `TaskId = null`. If an existing assertion checks `TaskId == "t1"`, change it to `Assert.Null(...)`. Add:

```csharp
    [Fact]
    public void KeepCarriesTheSubproject()
    {
        var (recovery, buffer, _) = New(() => "user-1");
        recovery.Apply(AwayResolution.Keep, Span());
        Assert.Equal("s2", Only(buffer).SubprojectId);
    }
```

Use the file's actual apply method name; read an existing Keep test first.

In the `LiveSpanStore` test file, add a round-trip test: `Begin` with `new TimeTracker.Selection("p1", null, SubprojectId: "s2")`, then `Load()!.SubprojectId == "s2"`. Also add a legacy test that writes `{"entryId":"e1","startTime":"2026-08-25T09:00:00+00:00","projectId":"p1","taskId":null,"source":"MANUAL","lastAlive":"2026-08-25T09:00:00+00:00","userId":null}` to the path and asserts `Load()!.SubprojectId` is null and `EntryId == "e1"`.

`AppAndProjectTests.cs`: add JSON decode tests mirroring Task 1:

- a legacy project JSON without `subprojects` gives `Subprojects == null` and a task with `SubprojectId == null`;
- the new JSON decodes `Subprojects[0].IsDefault` and the task's `SubprojectId`;
- a legacy `StoredSelection` JSON `{"projectId":"p1","taskId":"t1"}` gives `SubprojectId == null`;
- `RecentSelectionClient.NewestSelection` carries `SubprojectId` from a row.

- [ ] **Step 3: Implement**

`Project.cs`:

- Add the `Subproject` record.
- Add a trailing `[property: JsonPropertyName("subprojects")] IReadOnlyList<Subproject>? Subprojects = null` to `Project`.
- Add `[property: JsonPropertyName("subprojectId")] string? SubprojectId = null` to `ProjectTask`, and the same to `StoredSelection`, with doc lines saying they are optional so 0.2.x files still load.

`RecentSelectionClient.cs`:

- Add a trailing `[property: JsonPropertyName("subprojectId")] string? SubprojectId = null` to `RecentEntryRow`.
- `NewestSelection` builds `new StoredSelection(r.ProjectId!, r.TaskId, r.SubprojectId)`.

`TimeTracker.cs`:

- `public sealed record Selection(string? ProjectId, string? TaskId, string? Note = null, string? SubprojectId = null);`
- `Start(...)` gains a trailing `string? subprojectId = null` and opens `new Selection(projectId, taskId, note, subprojectId)`.
- `RecordSpan(...)` gains a trailing `string? subprojectId = null`, passes it to `Enqueue`, and builds `new Selection(projectId, taskId, note, subprojectId)`.
- `Close` passes `tracking.Selection.SubprojectId` to `Enqueue`.
- `Enqueue` gains a `string? subprojectId` parameter after `projectId` and sets `SubprojectId = subprojectId`.
- `SetNote` and `Reselect` already use `with` or a whole `Selection`, so no change there.

`TimeEntryPayload.cs`: add

```csharp
    [JsonPropertyName("subprojectId")]
    public string? SubprojectId { get; init; }
```

after `ProjectId`. Also edit the doc comment:

- the nullable list reads "`projectId`/`subprojectId`/`taskId`/`endTime`";
- the last paragraph reads "Nothing else may be added here without adding it to `CreateTimeEntrySchema` first …";
- note that `subprojectId` is `.nullable().optional()` on the server and an explicit null means the server derives it.

`LiveSpanStore.cs`: add `[JsonPropertyName("subprojectId")] public string? SubprojectId { get; init; }` after `ProjectId`, and set `SubprojectId = selection.SubprojectId` in `Begin`.

`LiveSpanRecovery.cs`: add `subprojectId: span.SubprojectId` to `RecordSpan`.

`LiveEntryPublisher.cs`: set `SubprojectId = …Selection.SubprojectId` in all **three** payloads (`PublishAsync`, `PublishCloseAsync`, `HeartbeatAsync`).

`AutoTrackingCoordinator.cs`: `_tracker.Start(selection.ProjectId, selection.TaskId, source: TimeTracker.EntrySource.Auto, subprojectId: selection.SubprojectId);` and `subprojectId: selection.SubprojectId` on the Keep `RecordSpan`.

`ManualIdleCoordinator.cs`: add `subprojectId: tracking.Selection.SubprojectId` to the Discard `Start`.

`MenuViewModel.cs`:

- `SelectionForAuto => new(_selection?.ProjectId, _selection?.TaskId, SubprojectId: _selection?.SubprojectId);`
- `Start()`: `_tracker.Start(_selection?.ProjectId, _selection?.TaskId, NoteOrNull(), subprojectId: _selection?.SubprojectId);`
- `SelectProject(projectId, taskId)` is unchanged in this task (it stores a null subproject, which the server derives). Task 7 replaces it.

- [ ] **Step 4: Prove every production site passes the subproject**

```bash
cd apps/client-windows && grep -rn "_tracker.Start(\|\.RecordSpan(\|new TimeEntryPayload" src | grep -v "/obj/"
```

Every hit, except the `TimeTracker.cs` internals and `MenuViewModel.SelectProject`, must mention `ubprojectId` on the same statement. Read each multi-line hit to confirm.

- [ ] **Step 5: Commit, push, and gate on CI**

```bash
git add apps/client-windows/src apps/client-windows/tests
git commit -m "feat(client): send the subproject from the Windows tracker"
git push
gh pr checks --watch
```

Expected: `Client (Windows)` green. On red, read the log (`gh run view --log-failed`), fix, and push again. Each push costs Windows minutes billed at 2x (see memory "Actions minutes & per-job rounding"), so batch the fixes.

---

## Task 7: Windows — picker core, resolver and view model

**Files:**

- Create: `apps/client-windows/src/NiftyTimer/Projects/PickerCore.cs`
- Modify: `apps/client-windows/src/NiftyTimer/Projects/SelectionStore.cs` (the `SelectionResolver` class)
- Modify: `apps/client-windows/src/NiftyTimer/App/MenuViewModel.cs`
- Create: `apps/client-windows/tests/NiftyTimer.Tests/PickerCoreTests.cs`
- Modify: `apps/client-windows/tests/NiftyTimer.Tests/MenuPickerTests.cs`, `AppAndProjectTests.cs` (remove the `PickerChoice` / `FilteredChoices` tests; they move to the new ones)

**Interfaces:**

- Consumes: Task 6 models.
- Produces (Task 8 uses them):
  - `PickerTree.Build(IReadOnlyList<Project>) -> IReadOnlyList<PickerProject>` and `PickerTree.Node(Project)`
  - `PickerProject(Id, Name, Subprojects)` with `.SkipsSubprojectLevel`, `.DefaultSubproject` and `.FindSubproject(string?)`
  - `PickerSubproject(string? Id, string Name, bool IsDefault, IReadOnlyList<PickerTask> Tasks)` and `PickerTask(string Id, string Name)`
  - `abstract record PickerLevel` with `PickerLevel.Root`, `PickerLevel.ProjectLevel(string ProjectId)` and `PickerLevel.SubprojectLevel(string ProjectId, string? SubprojectId)`
  - `enum PickerRowKind { Back, Open, Track }`
  - `sealed record PickerRow(string Id, string Title, PickerRowKind Kind, PickerLevel? Target, StoredSelection? Selection, bool IsCurrent = false)`
  - `PickerNavigation.Open / Back / Normalize / Rows / HeaderText`
  - `PickerSearch.IsSearching / Results`
  - `SelectionResolver.Resolve(StoredSelection?, IReadOnlyList<Project>)`, now following the unified table
  - `MenuViewModel`:
    - `PickerLevel Level { get; }`
    - `IReadOnlyList<PickerRow> PickerRows`, with `IsCurrent` set
    - `string SelectionLabel`, now the header text
    - `void Activate(PickerRow)`
    - `bool Back()`, which returns false when already at the root
    - `void ResetPicker()`
    - `void SelectProject(StoredSelection selection)`
  - `PickerChoice`, `Choices`, `FilteredChoices`, `SelectedChoice`, `ChoicesFor` and `Filter` are **deleted**.

- [ ] **Step 1: Write the tests**

Create `PickerCoreTests.cs`. It is a direct port of the Swift `PickerCoreTests` and `SelectionResolverTests` from Task 2: the same fixtures (Acme/Borealis/Legacy for the core; the Acme/Archived/Legacy set for the resolver), the same inputs and the same expected titles, levels and selections. Port every Swift test method as one `[Fact]`, except `testMoveHighlightClampsAndStartsAtAnEnd`, which is macOS-only. For reference, the first three are:

```csharp
using NiftyTimer.Projects;
using Xunit;

namespace NiftyTimer.Tests;

public class PickerCoreTests
{
    private static readonly IReadOnlyList<Project> Projects =
    [
        new Project("p1", "t", "Acme", false,
            [new ProjectTask("k2", "p1", "pay form", "s2"), new ProjectTask("k1", "p1", "Audit", "s1"), new ProjectTask("k3", "p1", "Cart", "s2")],
            [new Subproject("s2", "p1", "checkout", false, false), new Subproject("s1", "p1", "General", false, true)]),
        new Project("p2", "t", "Borealis", false,
            [new ProjectTask("k4", "p2", "Hero copy", "s3")],
            [new Subproject("s3", "p2", "General", false, true)]),
        new Project("p3", "t", "Legacy", false, [new ProjectTask("k5", "p3", "Old task")]),
    ];

    private static IReadOnlyList<PickerProject> Tree => PickerTree.Build(Projects);

    [Fact]
    public void OrdersSubprojectsDefaultFirstThenByNameAndTasksByName()
    {
        var acme = Tree[0];
        Assert.Equal(["s1", "s2"], acme.Subprojects.Select(s => s.Id));
        Assert.Equal(["Cart", "pay form"], acme.Subprojects[1].Tasks.Select(t => t.Name));
    }

    [Fact]
    public void TaskScreenOfAShownSubproject()
    {
        var rows = PickerNavigation.Rows(new PickerLevel.SubprojectLevel("p1", "s2"), Tree);
        Assert.Equal(["Acme › checkout", "checkout (no task)", "Cart", "pay form"], rows.Select(r => r.Title));
        Assert.Equal(new StoredSelection("p1", null, "s2"), rows[1].Selection);
        Assert.Equal(PickerRowKind.Back, rows[0].Kind);
    }

    [Fact]
    public void AMovedTaskResolvesToItsNewSubproject()
    {
        IReadOnlyList<Project> projects =
        [
            new Project("p1", "t", "Acme", false, [new ProjectTask("k1", "p1", "Build", "s2")],
                [new Subproject("s1", "p1", "General", false, true), new Subproject("s2", "p1", "Checkout", false, false),
                 new Subproject("s3", "p1", "Other", false, false)]),
        ];
        Assert.Equal(new StoredSelection("p1", "k1", "s2"),
            SelectionResolver.Resolve(new StoredSelection("p1", "k1", "s3"), projects));
    }
}
```

Watch the argument order: C# `StoredSelection` is `(ProjectId, TaskId, SubprojectId)`, which differs from the Swift labels.

Replace the obsolete tests in `MenuPickerTests.cs` and `AppAndProjectTests.cs` (the `PickerChoice` / `Filter` / `FilteredChoices` ones) with view-model tests ported from Task 4 Step 1:

- `DrillingDownAndTrackingASubprojectWithNoTask`
- `AProjectWithOnlyGeneralSkipsToItsTasksAndBackReturnsToRoot`
- `SearchTracksAResultImmediatelyAndClearingRestoresTheLevel`
- `SwitchingWhileTrackingRefilesUnderTheNewSubproject`
- `SwitchingWhilePausedResumesUnderTheNewSubproject`
- `AutoSelectionCarriesTheSubproject`
- `ReopeningStartsAtTheRootAndSignOutClearsTheLevel`, using `ResetPicker()` and `Reset()`
- `RestoreUpgradesAnOldStoredSelectionToTheDefaultSubproject`

Plus these Windows-only tests:

```csharp
    [Fact]
    public void BackAtTheRootReportsThatThereIsNowhereToGo()
    {
        var vm = new MenuViewModel(new TimeTracker(new BufferSpy()), new SelectionStore(new InMemoryUserSettings()));
        Assert.False(vm.Back());
    }

    [Fact]
    public void DrillingRaisesPickerRowsSoThePopupRerenders()
    {
        var vm = new MenuViewModel(new TimeTracker(new BufferSpy()), new SelectionStore(new InMemoryUserSettings()))
        {
            Projects = Projects,
        };
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);
        vm.Activate(vm.PickerRows[0]);
        Assert.Contains(nameof(MenuViewModel.PickerRows), raised);
    }

    [Fact]
    public void OnlyTheCurrentTrackRowIsMarkedCurrent()
    {
        var vm = new MenuViewModel(new TimeTracker(new BufferSpy()), new SelectionStore(new InMemoryUserSettings()))
        {
            Projects = Projects,
        };
        vm.SelectProject(new StoredSelection("p2", null, "s3"));
        vm.Activate(vm.PickerRows[1]);                              // Borealis → its tasks
        Assert.Equal(["Borealis (no task)"], vm.PickerRows.Where(r => r.IsCurrent).Select(r => r.Title));
    }
```

Here `Projects` is the fixture from `PickerCoreTests`; copy it into the test class or make it `internal static` in `PickerCoreTests`.

- [ ] **Step 2: Implement `PickerCore.cs`**

This is a line-for-line port of Task 2's `PickerCore.swift` and resolver. Same rules and same titles; the sorting uses `StringComparer.OrdinalIgnoreCase`, with `OrderBy` for tasks and `OrderByDescending(IsDefault).ThenBy(Name, OrdinalIgnoreCase)` for subprojects.

```csharp
namespace NiftyTimer.Projects;

/// <summary>
/// The UI-free picker core (spec §3): Projects → Subprojects → Tasks as rows the popup renders.
/// A line-for-line port of the macOS client's PickerCore.swift — change both together.
/// </summary>
public sealed record PickerTask(string Id, string Name);

/// <summary>
/// One subproject bucket. A null <c>Id</c> is the implicit default of a project decoded from a
/// cache written before subprojects existed: the client sends <c>subprojectId: null</c> and the
/// server derives it.
/// </summary>
public sealed record PickerSubproject(string? Id, string Name, bool IsDefault, IReadOnlyList<PickerTask> Tasks);

public sealed record PickerProject(string Id, string Name, IReadOnlyList<PickerSubproject> Subprojects)
{
    /// <summary>Only the default is active: the subproject screen is skipped and search paths omit it.</summary>
    public bool SkipsSubprojectLevel => Subprojects.Count == 1 && Subprojects[0].IsDefault;

    public PickerSubproject? DefaultSubproject => Subprojects.FirstOrDefault(s => s.IsDefault);

    public PickerSubproject? FindSubproject(string? id) => Subprojects.FirstOrDefault(s => s.Id == id);
}

public static class PickerTree
{
    /// <summary>Name of the implicit default for a pre-subproject cache. Never displayed.</summary>
    public const string ImplicitDefaultName = "General";

    public static IReadOnlyList<PickerProject> Build(IReadOnlyList<Project> projects) =>
        projects.Where(p => !p.Archived).Select(Node).ToList();

    public static PickerProject Node(Project project)
    {
        var tasks = project.Tasks ?? [];
        var active = (project.Subprojects ?? []).Where(s => !s.Archived).ToList();
        if (active.Count == 0)
        {
            return new PickerProject(project.Id, project.Name,
                [new PickerSubproject(null, ImplicitDefaultName, true, Sorted(tasks))]);
        }

        var ordered = active
            .OrderByDescending(s => s.IsDefault)
            .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var defaultId = ordered.FirstOrDefault(s => s.IsDefault)?.Id;
        return new PickerProject(project.Id, project.Name, ordered
            .Select(s => new PickerSubproject(s.Id, s.Name, s.IsDefault,
                Sorted(tasks.Where(t => (t.SubprojectId ?? defaultId) == s.Id))))
            .ToList());
    }

    private static IReadOnlyList<PickerTask> Sorted(IEnumerable<ProjectTask> tasks) =>
        tasks.OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase).Select(t => new PickerTask(t.Id, t.Name)).ToList();
}

public abstract record PickerLevel
{
    private PickerLevel()
    {
    }

    public static PickerLevel Root { get; } = new RootLevel();

    public sealed record RootLevel : PickerLevel;

    public sealed record ProjectLevel(string ProjectId) : PickerLevel;

    public sealed record SubprojectLevel(string ProjectId, string? SubprojectId) : PickerLevel;
}

public enum PickerRowKind
{
    Back,
    Open,
    Track,
}

/// <summary>
/// One picker row. <c>Target</c> is set for <see cref="PickerRowKind.Open"/>, <c>Selection</c> for
/// <see cref="PickerRowKind.Track"/>. <c>IsCurrent</c> drives the checkmark — NOT
/// <c>ListBoxItem.IsSelected</c>, which is the keyboard highlight.
/// </summary>
public sealed record PickerRow(
    string Id,
    string Title,
    PickerRowKind Kind,
    PickerLevel? Target,
    StoredSelection? Selection,
    bool IsCurrent = false);

public static class PickerNavigation
{
    public const string Separator = " › ";

    public static PickerLevel Open(PickerProject project) =>
        project.SkipsSubprojectLevel
            ? new PickerLevel.SubprojectLevel(project.Id, project.Subprojects[0].Id)
            : new PickerLevel.ProjectLevel(project.Id);

    public static PickerLevel Back(PickerLevel level, IReadOnlyList<PickerProject> tree) =>
        Normalize(level, tree) is PickerLevel.SubprojectLevel sub
        && tree.FirstOrDefault(p => p.Id == sub.ProjectId) is { SkipsSubprojectLevel: false }
            ? new PickerLevel.ProjectLevel(sub.ProjectId)
            : PickerLevel.Root;

    /// <summary>A level a refresh removed falls back to a valid one (plan ruling 5).</summary>
    public static PickerLevel Normalize(PickerLevel level, IReadOnlyList<PickerProject> tree)
    {
        switch (level)
        {
            case PickerLevel.ProjectLevel p:
                return tree.FirstOrDefault(x => x.Id == p.ProjectId) is { } project ? Open(project) : PickerLevel.Root;
            case PickerLevel.SubprojectLevel s:
                if (tree.FirstOrDefault(x => x.Id == s.ProjectId) is not { } owner)
                {
                    return PickerLevel.Root;
                }

                return owner.Subprojects.Any(x => x.Id == s.SubprojectId) ? level : Open(owner);
            default:
                return PickerLevel.Root;
        }
    }

    public static IReadOnlyList<PickerRow> Rows(PickerLevel level, IReadOnlyList<PickerProject> tree)
    {
        switch (Normalize(level, tree))
        {
            case PickerLevel.ProjectLevel p when tree.FirstOrDefault(x => x.Id == p.ProjectId) is { } project:
                return
                [
                    new PickerRow("back", project.Name, PickerRowKind.Back, null, null),
                    .. project.Subprojects.Select(s => new PickerRow(
                        $"s:{s.Id ?? project.Id}", s.Name, PickerRowKind.Open,
                        new PickerLevel.SubprojectLevel(project.Id, s.Id), null)),
                ];
            case PickerLevel.SubprojectLevel s
                when tree.FirstOrDefault(x => x.Id == s.ProjectId) is { } owner
                     && owner.FindSubproject(s.SubprojectId) is { } sub:
                var skipped = owner.SkipsSubprojectLevel;
                return
                [
                    new PickerRow("back", skipped ? owner.Name : owner.Name + Separator + sub.Name,
                        PickerRowKind.Back, null, null),
                    new PickerRow($"n:{sub.Id ?? owner.Id}", (skipped ? owner.Name : sub.Name) + " (no task)",
                        PickerRowKind.Track, null, new StoredSelection(owner.Id, null, sub.Id)),
                    .. sub.Tasks.Select(t => new PickerRow($"t:{t.Id}", t.Name, PickerRowKind.Track, null,
                        new StoredSelection(owner.Id, t.Id, sub.Id))),
                ];
            default:
                return tree.Select(p => new PickerRow($"p:{p.Id}", p.Name, PickerRowKind.Open, Open(p), null)).ToList();
        }
    }

    /// <summary>The header strip's path (plan ruling 4). Never renders a missing name.</summary>
    public static string HeaderText(StoredSelection? selection, IReadOnlyList<PickerProject> tree)
    {
        if (selection is null || tree.FirstOrDefault(p => p.Id == selection.ProjectId) is not { } project)
        {
            return "No project";
        }

        var taskHome = selection.TaskId is null
            ? null
            : project.Subprojects.FirstOrDefault(s => s.Tasks.Any(t => t.Id == selection.TaskId));
        var sub = taskHome ?? project.FindSubproject(selection.SubprojectId);
        var task = taskHome?.Tasks.FirstOrDefault(t => t.Id == selection.TaskId);

        var parts = new List<string> { project.Name };
        if (sub is not null && !project.SkipsSubprojectLevel)
        {
            parts.Add(sub.Name);
        }

        if (task is not null)
        {
            parts.Add(task.Name);
        }

        return string.Join(Separator, parts);
    }
}

public static class PickerSearch
{
    public static bool IsSearching(string? query) => !string.IsNullOrWhiteSpace(query);

    /// <summary>Flat full-path results across every level (spec §2). A lone default is omitted from paths.</summary>
    public static IReadOnlyList<PickerRow> Results(string? query, IReadOnlyList<PickerProject> tree)
    {
        if (!IsSearching(query))
        {
            return [];
        }

        var q = query!.Trim();
        var rows = new List<PickerRow>();
        foreach (var project in tree)
        {
            foreach (var sub in project.Subprojects)
            {
                string[] path = project.SkipsSubprojectLevel ? [project.Name] : [project.Name, sub.Name];
                if (Matches(path, q))
                {
                    rows.Add(new PickerRow($"n:{sub.Id ?? project.Id}", string.Join(PickerNavigation.Separator, path),
                        PickerRowKind.Track, null, new StoredSelection(project.Id, null, sub.Id)));
                }

                foreach (var task in sub.Tasks)
                {
                    string[] full = [.. path, task.Name];
                    if (Matches(full, q))
                    {
                        rows.Add(new PickerRow($"t:{task.Id}", string.Join(PickerNavigation.Separator, full),
                            PickerRowKind.Track, null, new StoredSelection(project.Id, task.Id, sub.Id)));
                    }
                }
            }
        }

        return rows;
    }

    private static bool Matches(IEnumerable<string> parts, string query) =>
        parts.Any(p => p.Contains(query, StringComparison.OrdinalIgnoreCase));
}
```

Replace `SelectionResolver.Resolve` in `SelectionStore.cs`. Update the doc comment to say the unified table is identical on macOS and a moved task wins.

```csharp
    public static StoredSelection? Resolve(StoredSelection? stored, IReadOnlyList<Project> projects)
    {
        if (stored is null || projects.FirstOrDefault(p => p.Id == stored.ProjectId && !p.Archived) is not { } project)
        {
            return null; // gone or archived — no selection
        }

        var node = PickerTree.Node(project);
        if (stored.TaskId is { } taskId && node.Subprojects.FirstOrDefault(s => s.Tasks.Any(t => t.Id == taskId)) is { } home)
        {
            return new StoredSelection(project.Id, taskId, home.Id);
        }

        if (stored.SubprojectId is { } subprojectId && node.FindSubproject(subprojectId) is not null)
        {
            return new StoredSelection(project.Id, null, subprojectId);
        }

        return new StoredSelection(project.Id, null, node.DefaultSubproject?.Id);
    }
```

- [ ] **Step 3: Implement the view model**

In `MenuViewModel.cs`:

- Delete `PickerChoice`, `Choices`, `FilteredChoices`, `SelectedChoice`, `Filter` and `ChoicesFor`.
- `Projects` raises `[nameof(PickerRows), nameof(SelectionLabel)]`. `Query` raises `[nameof(PickerRows)]`. `Selection` raises `[nameof(SelectionLabel), nameof(PickerRows)]`.
- Add:

```csharp
    private PickerLevel _level = PickerLevel.Root;

    /// <summary>Where the drill-down is. Reset to the root each time the popup opens.</summary>
    public PickerLevel Level
    {
        get => _level;
        private set => Set(ref _level, value, [nameof(PickerRows)]);
    }

    private IReadOnlyList<PickerProject> Tree => PickerTree.Build(_projects);

    /// <summary>
    /// Search results while searching, else the drill-down level's rows, with the current selection
    /// marked. The level survives a search, so clearing the text returns to it. Rows are records, so
    /// the popup's SequenceEqual guard compares them by value.
    /// </summary>
    public IReadOnlyList<PickerRow> PickerRows =>
        (PickerSearch.IsSearching(_query) ? PickerSearch.Results(_query, Tree) : PickerNavigation.Rows(_level, Tree))
            .Select(r => r.Kind == PickerRowKind.Track && r.Selection == _selection ? r with { IsCurrent = true } : r)
            .ToList();

    public void Activate(PickerRow row)
    {
        switch (row.Kind)
        {
            case PickerRowKind.Back:
                Back();
                break;
            case PickerRowKind.Open when row.Target is { } target:
                Level = target;
                break;
            case PickerRowKind.Track when row.Selection is { } selection:
                SelectProject(selection);
                break;
        }
    }

    /// <summary>One level up. False when already at the root — the popup then hides (Esc).</summary>
    public bool Back()
    {
        var normalized = PickerNavigation.Normalize(_level, Tree);
        if (normalized == PickerLevel.Root)
        {
            Level = PickerLevel.Root;
            return false;
        }

        Level = PickerNavigation.Back(normalized, Tree);
        return true;
    }

    /// <summary>Closing and reopening the popup starts at the root (spec §2). The query is kept.</summary>
    public void ResetPicker() => Level = PickerLevel.Root;
```

- `SelectionLabel` body: `=> PickerNavigation.HeaderText(_selection, Tree);`
- `SelectProject(StoredSelection selection)` replaces `SelectProject(string, string?)`. The body is the old one with `Selection = selection`, `_tracker.Start(selection.ProjectId, selection.TaskId, NoteOrNull(), subprojectId: selection.SubprojectId)` and `_tracker.Reselect(new TimeTracker.Selection(selection.ProjectId, selection.TaskId, NoteOrNull(), selection.SubprojectId))`.
- `Reset()` adds `Level = PickerLevel.Root;`.
- `RestoreSelection` is unchanged (it already calls `SelectionResolver.Resolve`, now with the new rules).

`TrayPopupWindow.xaml.cs` still references `PickerChoice` until Task 8. Task 7 and Task 8 are pushed **together**: commit Task 7, do not push, then do Task 8 and push both. CI would fail on Task 7 alone.

- [ ] **Step 4: Commit (no push yet)**

```bash
git add apps/client-windows/src/NiftyTimer/Projects apps/client-windows/src/NiftyTimer/App/MenuViewModel.cs apps/client-windows/tests
git commit -m "feat(client): add the Windows subproject picker core"
```

---

## Task 8: Windows — drill-down popup

**Files:**

- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml` (lines ~99-168: header strip and list template)
- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs` (`ShowNearTray`, `OnViewModelChanged`, `RenderPicker`, `OnProjectSelected`, plus the new key and click handlers)
- Modify: `apps/client-windows/tests/NiftyTimer.Tests/TrayPopupWindowTests.cs`

**Interfaces:**

- Consumes: Task 7 `MenuViewModel.PickerRows / Activate / Back / ResetPicker / SelectionLabel` and `PickerRow`.

- [ ] **Step 1: Rewrite the popup tests**

In `TrayPopupWindowTests.cs`:

- Replace the fixtures `Website` and `Billing` with these:

```csharp
    private static readonly Project Website = new("p1", "team", "Website", false,
        [new ProjectTask("t1", "p1", "Design review", "s2")],
        [new Subproject("s1", "p1", "General", false, true), new Subproject("s2", "p1", "Checkout", false, false)]);

    private static readonly Project Billing = new("p2", "team", "Billing", false, [],
        [new Subproject("s3", "p2", "General", false, true)]);
```

- The layout `Build` helper at ~l.600 gets the same treatment: `new Project(id, "team", name, false, tasks, [new Subproject(...General..., true)])`.
- Replace `list.Items.Cast<PickerChoice>()` with `list.Items.Cast<PickerRow>()`.
- Replace `PickingARowSelectsItsProjectAndTask` (which set `SelectedItem`) with:

```csharp
    [Fact]
    public void MovingTheHighlightDoesNotChangeWhatIsTracked()
    {
        var selection = WithPopup((vm, window) =>
        {
            var list = (ListBox)window.FindName("ProjectList");
            list.SelectedIndex = 1;               // keyboard highlight only
            return vm.Selection;
        });

        Assert.Null(selection);
    }

    [Fact]
    public void EnterActivatesTheHighlightedRowAndDrillsIn()
    {
        var (level, rows) = WithPopup((vm, window) =>
        {
            var list = (ListBox)window.FindName("ProjectList");
            list.SelectedIndex = 0;               // Website — two subprojects
            window.ActivateHighlightedForTest();
            return (vm.Level, list.Items.Cast<PickerRow>().ToList());
        });

        Assert.Equal(new PickerLevel.ProjectLevel("p1"), level);
        Assert.Equal(["Website", "General", "Checkout"], rows.Select(r => r.Title));
        Assert.Equal(PickerRowKind.Back, rows[0].Kind);
    }

    [Fact]
    public void EscapeGoesBackOneLevelThenHidesAtTheRoot()
    {
        var (afterFirst, stillVisible, afterSecond, visible) = WithPopup((vm, window) =>
        {
            window.Show();
            vm.Activate(vm.PickerRows[0]);
            var first = window.HandleEscapeForTest();
            var mid = window.IsVisible;
            var second = window.HandleEscapeForTest();
            return (first, mid, second, window.IsVisible);
        });

        Assert.True(afterFirst);
        Assert.True(stillVisible);
        Assert.False(afterSecond);
        Assert.False(visible);
    }

    [Fact]
    public void ReopeningThePopupStartsAtTheRoot()
    {
        var level = WithPopup((vm, window) =>
        {
            vm.Activate(vm.PickerRows[0]);
            window.ShowNearTray();
            return vm.Level;
        });

        Assert.Equal(PickerLevel.Root, level);
    }

    [Fact]
    public void TheHeaderStripShowsTheSelectionPath()
    {
        var text = WithPopup((vm, window) =>
        {
            vm.SelectProject(new StoredSelection("p1", null, "s2"));
            return ((TextBlock)window.FindName("SelectionHeader")).Text;
        });

        Assert.Equal("Website › Checkout", text);
    }
```

Rewrite `TypingInTheSearchFieldFiltersTheListBySubstring` so that `"design"` yields exactly one row titled `Website › Checkout › Design review`.

- The `ItemsSource` guard tests (~l.583-760): keep their intent, that `Tick()` must not reassign `ItemsSource` when rows are unchanged. Retarget `PickerChoice` → `PickerRow`. Replace `SelectedItem = target` (which used to select) with `vm.Activate(target)` wherever the test means "the person picked this row". Keep `SelectedItem` wherever it means the highlight.
- The layout-measuring tests keep `IsSignedIn = true` (memory "Windows popup tests must sign in"). If a measured-height assertion fails because of the new header strip row, update the expected value and say so in the commit body.

- [ ] **Step 2: Implement the XAML**

Directly under the `SWITCH PROJECT` label, add the header strip:

```xml
            <!-- The current selection as a path, whichever level the list shows (spec §2). -->
            <TextBlock x:Name="SelectionHeader"
                       Style="{StaticResource CaptionText}"
                       TextTrimming="CharacterEllipsis"
                       Margin="0,0,0,4" />
```

Replace the `ListBox`'s `SelectionChanged="OnProjectSelected"` with `PreviewKeyDown="OnListKeyDown"` and `MouseLeftButtonUp="OnListClicked"`. Add `PreviewKeyDown="OnSearchKeyDown"` to `SearchBox`. Replace the item template's inner content:

```xml
                    <DataTemplate>
                        <Grid>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="Auto" />
                                <ColumnDefinition Width="*" />
                                <ColumnDefinition Width="Auto" />
                            </Grid.ColumnDefinitions>
                            <!-- ‹ on the back row, › on rows that drill; set in code from Kind. -->
                            <TextBlock Grid.Column="0" Text="{Binding Kind, Converter={StaticResource PickerRowLeadingGlyph}}"
                                       Style="{StaticResource CaptionText}" Margin="0,0,4,0" />
                            <TextBlock Grid.Column="1" Text="{Binding Title}" Style="{StaticResource LabelText}"
                                       TextTrimming="CharacterEllipsis" />
                            <StackPanel Grid.Column="2" Orientation="Horizontal">
                                <!-- Checkmark follows IsCurrent, NOT IsSelected (the keyboard highlight). -->
                                <Path Width="11" Height="9" Stretch="Uniform" VerticalAlignment="Center"
                                      Data="M 0,5 L 4,9 L 11,1" Stroke="{DynamicResource Accent}" StrokeThickness="1.8"
                                      StrokeStartLineCap="Round" StrokeEndLineCap="Round"
                                      Visibility="{Binding IsCurrent, Converter={StaticResource BoolToVisibility}}" />
                                <TextBlock Text="{Binding Kind, Converter={StaticResource PickerRowTrailingGlyph}}"
                                           Style="{StaticResource CaptionText}" Margin="6,0,0,0" />
                            </StackPanel>
                        </Grid>
                    </DataTemplate>
```

Add the two converters as small `IValueConverter` classes in `TrayPopupWindow.xaml.cs` (or `UI/PickerRowGlyph.cs`) and register them in the window's resources next to how `BoolToVisibility` is declared:

- `PickerRowLeadingGlyph` maps `Back` → `"‹"` and everything else → `""`.
- `PickerRowTrailingGlyph` maps `Open` → `"›"` and everything else → `""`.

Change the search box's `AutomationProperties.Name` and hint text only if needed; the current "Search projects and tasks" can stay.

- [ ] **Step 3: Implement the code-behind**

- `ShowNearTray()`: call `_viewModel.ResetPicker();` before `Render();`.
- `OnViewModelChanged`: re-render the picker for `nameof(MenuViewModel.Projects)`, `nameof(MenuViewModel.Selection)`, `nameof(MenuViewModel.PickerRows)` and `nameof(MenuViewModel.Query)`. Remove `FilteredChoices`.
- `RenderPicker()`:

```csharp
    private void RenderPicker()
    {
        if (SearchBox.Text != _viewModel.Query)
        {
            SearchBox.Text = _viewModel.Query;
        }

        SearchHint.Visibility = _viewModel.Query.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        SelectionHeader.Text = _viewModel.SelectionLabel;

        // Guarded for the reason documented above: Tick() re-renders every second, and a fresh
        // ItemsSource would snap a scrolled list back to the top. PickerRow is a record.
        var rows = _viewModel.PickerRows;
        if (ProjectList.ItemsSource is not IReadOnlyList<PickerRow> shown || !shown.SequenceEqual(rows))
        {
            ProjectList.ItemsSource = rows;
        }
    }
```

Keep the existing doc comment above it, updated from `PickerChoice` to `PickerRow` and with the selection-restore paragraph removed. The checkmark is now bound, so selection is no longer restored here.

- Delete `OnProjectSelected`. Add:

```csharp
    /// <summary>
    /// Rows are activated by a click or Enter, never by SelectionChanged: with drill rows, arrowing
    /// through the list would otherwise drill or switch tracking on every keypress.
    /// </summary>
    private void OnListClicked(object sender, MouseButtonEventArgs e)
    {
        if (ItemsControl.ContainerFromElement(ProjectList, (DependencyObject)e.OriginalSource) is ListBoxItem { DataContext: PickerRow row })
        {
            _viewModel.Activate(row);
        }
    }

    private void OnListKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            ActivateHighlighted();
            e.Handled = true;
        }
        else if (e.Key == Key.Escape)
        {
            HandleEscape();
            e.Handled = true;
        }
    }

    private void OnSearchKeyDown(object sender, KeyEventArgs e)
    {
        switch (e.Key)
        {
            case Key.Down when ProjectList.Items.Count > 0:
                ProjectList.SelectedIndex = 0;
                (ProjectList.ItemContainerGenerator.ContainerFromIndex(0) as ListBoxItem)?.Focus();
                e.Handled = true;
                break;
            case Key.Enter:
                ActivateHighlighted();
                e.Handled = true;
                break;
            case Key.Escape:
                HandleEscape();
                e.Handled = true;
                break;
        }
    }

    /// <summary>Enter: the highlighted row, or the first one when nothing is highlighted.</summary>
    private void ActivateHighlighted()
    {
        var row = ProjectList.SelectedItem as PickerRow ?? ProjectList.Items.OfType<PickerRow>().FirstOrDefault();
        if (row is not null)
        {
            _viewModel.Activate(row);
        }
    }

    /// <summary>Esc goes back one level; at the root it hides the popup (plan ruling 7).</summary>
    private bool HandleEscape()
    {
        if (_viewModel.Back())
        {
            return true;
        }

        Hide();
        return false;
    }

    internal void ActivateHighlightedForTest() => ActivateHighlighted();

    internal bool HandleEscapeForTest() => HandleEscape();
```

Add `using System.Windows.Input;` and `using NiftyTimer.Projects;` if missing. Check that the test project can see `internal` members: grep for `InternalsVisibleTo` in `AssemblyInfo.cs`. If it cannot, make the two test hooks `public` with a `/// <summary>Test seam.</summary>` comment.

- [ ] **Step 4: Prove no stale picker references remain**

```bash
cd apps/client-windows && grep -rn "PickerChoice\|FilteredChoices\|SelectedChoice\|ChoicesFor\|OnProjectSelected" src tests | grep -v /obj/
```

Expected: no output.

- [ ] **Step 5: Commit, push Tasks 7 and 8 together, and gate on CI**

```bash
git add apps/client-windows/src apps/client-windows/tests
git commit -m "feat(client): drill-down subproject picker in the Windows popup"
git push
gh pr checks --watch
```

Expected: `Client (Windows)` and `Client (macOS)` both green. On red: `gh run view --log-failed`, fix, and push again, batching the fixes.

---

## Task 9: Windows 0.3.0 and hand-off

**Files:**

- Modify: `apps/client-windows/src/NiftyTimer/NiftyTimer.csproj` (version 0.2.6 → 0.3.0; change exactly the field commit `2277670` changed)

- [ ] **Step 1: Bump and commit**

```bash
git add apps/client-windows/src/NiftyTimer/NiftyTimer.csproj
git commit -m "build(client): bump the Windows client to 0.3.0"
git push
gh pr checks --watch
```

- [ ] **Step 2: Finish the PR body and mark it ready**

- Replace the draft body. Include:
  - what changed on each client;
  - rulings 1 to 10;
  - the Task 5 hand-check results;
  - the note that Windows UI behaviour is verified by CI tests only (there is no Windows machine).
- Say explicitly that publishing Mac 0.7.0 to `rashedulhasansojib/timetrack-app` and Windows 0.3.0 to `niftytimer-windows` is **not done** and is the user's call.
- Then run `gh pr ready`.
- Hand the merge to the user; the classifier blocks `gh pr merge`.
