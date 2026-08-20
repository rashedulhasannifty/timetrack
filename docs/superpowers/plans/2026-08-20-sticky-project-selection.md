# Sticky Project Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop making the employee re-pick their project every day — restore the last selection on launch, per user, without ever pre-selecting a project they can no longer access.

**Architecture:** A small `SelectionStore` persists `{projectId, taskId}` to `UserDefaults` under a **userId-namespaced** key. On launch the client restores from it; on a fresh install with no stored selection it falls back to the project on the user's most recent time entry via the existing `GET /v1/time-entries`. Either way the restored choice is validated against the freshly refreshed project list before it is applied, and dropped if the project or task has gone.

**Tech Stack:** Swift 6 / SwiftUI (SPM executable target), XCTest, Foundation `UserDefaults`.

**Spec:** `docs/superpowers/specs/2026-08-20-dhaka-time-and-live-entries-design.md` (§6)

## Global Constraints

- Branch is `feat/dhaka-time-and-live-entries`, already created. Do not commit to `main`.
- **No AI attribution** in any commit message, trailer, author, or branch name (CLAUDE.md §0).
- **This is monitoring software.** No hidden or stealth mode. Never bypass `Policy/AckGate`. Manual tracking is deliberately not a capture path and is gated upstream by `MenuViewModel.isReady` — do not add an AckGate call here.
- **Never break `/v1`.** Use the existing `GET /v1/time-entries` endpoint; do not add a new one for the fallback.
- **The sign-out clearing behaviour must not regress.** `MenuViewModel.reset()` deliberately clears `selectedChoice`, `query`, and `projects` so a different user's next login cannot inherit a stale, wrong-team selection (CLAUDE.md §1 fail-safe posture). Per-user key namespacing is what lets persistence coexist with that guarantee.
- Swift tests need `DEVELOPER_DIR` pointed at Xcode — CommandLineTools has no XCTest. In `@testable` client tests a bare `Category` collides with the ObjC runtime type; qualify as `TimeTrack.Category`.
- Never write an eager stored `let center = UNUserNotificationCenter.current()` — it SIGABRTs the whole `swift test` binary. Use `lazy var`.
- The client is a **single executable target**. Widening a shared type's `init` with a required parameter must be done in the same task as every call-site update, or the task will not build. `SelectionStore` is therefore injected with a **default value** at every call site it is added to.
- Uploader/client `classify()` must treat all 2xx as success; 408/429/5xx are transient, never permanent.
- Never log or transmit keystroke content. The stored selection holds ids only — no names, no titles.

---

### Task 1: A per-user selection store

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/Projects/SelectionStore.swift`
- Create: `apps/client-macos/Tests/TimeTrackTests/SelectionStoreTests.swift`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `struct StoredSelection: Codable, Equatable { let projectId: String; let taskId: String? }`
  - `final class SelectionStore` with:
    - `init(defaults: UserDefaults = .standard)`
    - `func save(_ selection: StoredSelection, userId: String)`
    - `func load(userId: String) -> StoredSelection?`
    - `func clear(userId: String)`

- [ ] **Step 1: Write the failing test**

Create `apps/client-macos/Tests/TimeTrackTests/SelectionStoreTests.swift`:

```swift
import XCTest
@testable import TimeTrack

final class SelectionStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        // A throwaway suite per test — never touch the real .standard defaults.
        suiteName = "SelectionStoreTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testRoundTripsASelection() {
        let store = SelectionStore(defaults: defaults)
        let selection = StoredSelection(projectId: "p1", taskId: "t1")

        store.save(selection, userId: "u1")

        XCTAssertEqual(store.load(userId: "u1"), selection)
    }

    func testRoundTripsAProjectOnlySelection() {
        let store = SelectionStore(defaults: defaults)
        let selection = StoredSelection(projectId: "p1", taskId: nil)

        store.save(selection, userId: "u1")

        XCTAssertEqual(store.load(userId: "u1"), selection)
    }

    func testReturnsNilForAUserWithNothingStored() {
        let store = SelectionStore(defaults: defaults)
        XCTAssertNil(store.load(userId: "nobody"))
    }

    // The guarantee that lets persistence coexist with sign-out clearing: one user can never
    // inherit another user's (possibly wrong-team) selection.
    func testOneUsersSelectionIsInvisibleToAnother() {
        let store = SelectionStore(defaults: defaults)
        store.save(StoredSelection(projectId: "p1", taskId: nil), userId: "u1")

        XCTAssertNil(store.load(userId: "u2"))
    }

    func testClearRemovesOnlyThatUsersSelection() {
        let store = SelectionStore(defaults: defaults)
        store.save(StoredSelection(projectId: "p1", taskId: nil), userId: "u1")
        store.save(StoredSelection(projectId: "p2", taskId: nil), userId: "u2")

        store.clear(userId: "u1")

        XCTAssertNil(store.load(userId: "u1"))
        XCTAssertEqual(store.load(userId: "u2")?.projectId, "p2")
    }

    func testSavingTwiceOverwrites() {
        let store = SelectionStore(defaults: defaults)
        store.save(StoredSelection(projectId: "p1", taskId: "t1"), userId: "u1")
        store.save(StoredSelection(projectId: "p2", taskId: nil), userId: "u1")

        XCTAssertEqual(store.load(userId: "u1"), StoredSelection(projectId: "p2", taskId: nil))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter SelectionStoreTests`
Expected: FAIL to compile — `SelectionStore` and `StoredSelection` do not exist.

- [ ] **Step 3: Write the store**

Create `apps/client-macos/Sources/TimeTrack/Projects/SelectionStore.swift`:

```swift
import Foundation

/// The picker selection worth remembering across launches. Ids only — never names or titles.
struct StoredSelection: Codable, Equatable {
    let projectId: String
    let taskId: String?
}

/// Persists the last picker selection so the employee doesn't re-pick their project every day
/// (spec §6).
///
/// Keyed by userId. `MenuViewModel.reset()` deliberately clears the in-memory selection on
/// sign-out so a different user cannot inherit a stale, wrong-team selection (CLAUDE.md §1);
/// namespacing the persisted value per user is what lets it survive a relaunch without
/// reopening that hole. Nothing here is a capture path — no AckGate.
final class SelectionStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func save(_ selection: StoredSelection, userId: String) {
        guard let data = try? JSONEncoder().encode(selection) else { return }
        defaults.set(data, forKey: Self.key(for: userId))
    }

    func load(userId: String) -> StoredSelection? {
        guard let data = defaults.data(forKey: Self.key(for: userId)) else { return nil }
        return try? JSONDecoder().decode(StoredSelection.self, from: data)
    }

    func clear(userId: String) {
        defaults.removeObject(forKey: Self.key(for: userId))
    }

    private static func key(for userId: String) -> String {
        "TimeTrack.lastSelection.\(userId)"
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter SelectionStoreTests`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Projects/SelectionStore.swift \
        apps/client-macos/Tests/TimeTrackTests/SelectionStoreTests.swift
git commit -m "feat(client): persist the last project selection per user"
```

---

### Task 2: Validate a restored selection against the live project list

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/Projects/SelectionResolver.swift`
- Create: `apps/client-macos/Tests/TimeTrackTests/SelectionResolverTests.swift`

**Interfaces:**

- Consumes: `StoredSelection` (Task 1), `Choice` + `Project` / `ProjectTask` (existing).
- Produces: `enum SelectionResolver { static func resolve(_ stored: StoredSelection?, in choices: [Choice]) -> Choice? }`

**Why a separate pure unit.** The validation is the part that can silently break the product — pre-selecting a project the user has lost access to means every Start fails server-side with a confusing error. Keeping it a pure function makes it exhaustively testable without `UserDefaults`, a network, or a view model.

- [ ] **Step 1: Write the failing test**

Create `apps/client-macos/Tests/TimeTrackTests/SelectionResolverTests.swift`:

```swift
import XCTest
@testable import TimeTrack

final class SelectionResolverTests: XCTestCase {
    private let choices: [Choice] = [
        Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Apollo", taskName: nil),
        Choice(id: "t1", projectId: "p1", taskId: "t1", projectName: "Apollo", taskName: "Build"),
        Choice(id: "p2", projectId: "p2", taskId: nil, projectName: "Gemini", taskName: nil),
    ]

    func testResolvesAProjectOnlySelection() {
        let got = SelectionResolver.resolve(
            StoredSelection(projectId: "p2", taskId: nil), in: choices
        )
        XCTAssertEqual(got?.id, "p2")
    }

    func testResolvesAProjectAndTaskSelection() {
        let got = SelectionResolver.resolve(
            StoredSelection(projectId: "p1", taskId: "t1"), in: choices
        )
        XCTAssertEqual(got?.id, "t1")
        XCTAssertEqual(got?.taskId, "t1")
    }

    func testDropsASelectionWhoseProjectIsGone() {
        // Archived, deleted, or the user was moved off that team.
        XCTAssertNil(SelectionResolver.resolve(
            StoredSelection(projectId: "gone", taskId: nil), in: choices
        ))
    }

    func testDropsASelectionWhoseTaskIsGone() {
        // The project survives but the task does not — do NOT silently fall back to the
        // project, because that would start tracking against something never chosen.
        XCTAssertNil(SelectionResolver.resolve(
            StoredSelection(projectId: "p1", taskId: "gone"), in: choices
        ))
    }

    func testDropsEverythingWhenTheProjectListIsEmpty() {
        // Offline first launch with an empty cache — never pre-select from nothing.
        XCTAssertNil(SelectionResolver.resolve(
            StoredSelection(projectId: "p1", taskId: nil), in: []
        ))
    }

    func testNilStoredSelectionResolvesToNil() {
        XCTAssertNil(SelectionResolver.resolve(nil, in: choices))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter SelectionResolverTests`
Expected: FAIL to compile — `SelectionResolver` does not exist.

- [ ] **Step 3: Write the resolver**

Create `apps/client-macos/Sources/TimeTrack/Projects/SelectionResolver.swift`:

```swift
import Foundation

/// Matches a persisted selection against the CURRENT project list (spec §6).
///
/// A stored selection is only ever a hint. If the project was archived, deleted, or the user
/// was moved off that team, restoring it would pre-select something the server will reject on
/// Start — so an unmatched selection is dropped, never approximated. A stored task that no
/// longer exists does NOT silently degrade to its project: the employee never chose the
/// project on its own.
enum SelectionResolver {
    static func resolve(_ stored: StoredSelection?, in choices: [Choice]) -> Choice? {
        guard let stored else { return nil }
        return choices.first { $0.projectId == stored.projectId && $0.taskId == stored.taskId }
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter SelectionResolverTests`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Projects/SelectionResolver.swift \
        apps/client-macos/Tests/TimeTrackTests/SelectionResolverTests.swift
git commit -m "feat(client): validate a restored selection against live projects"
```

---

### Task 3: Persist on select, restore after the project refresh

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/App/MenuViewModel.swift` (`select`, `reset`, plus a new `restore`)
- Modify: `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift:273-285` (`refreshProjects` and the bootstrap around it)
- Test: `apps/client-macos/Tests/TimeTrackTests/MenuViewModelTests.swift`

**Interfaces:**

- Consumes: `SelectionStore` (Task 1), `SelectionResolver` (Task 2).
- Produces: `MenuViewModel.restoreSelection(userId: String)` — resolves the stored selection against the CURRENT `choices` and applies it, or clears the stored key if it no longer resolves.

**The ordering that matters.** The restore must run **after** the project list has been refreshed, not at construction. Restoring against an empty or stale cached list would either drop a valid selection or apply one the user has since lost.

- [ ] **Step 1: Write the failing test**

Append to `apps/client-macos/Tests/TimeTrackTests/MenuViewModelTests.swift` (match the existing fixture/constructor style in that file — the `makeViewModel` helper below is illustrative):

```swift
func testSelectPersistsTheChoiceForTheSignedInUser() {
    let defaults = UserDefaults(suiteName: "MenuVM-\(UUID().uuidString)")!
    let store = SelectionStore(defaults: defaults)
    let vm = makeViewModel(selectionStore: store)
    vm.markReady()
    vm.currentUserId = "u1"
    vm.projects = [Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil)]

    vm.select(Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Apollo", taskName: nil))

    XCTAssertEqual(store.load(userId: "u1"), StoredSelection(projectId: "p1", taskId: nil))
}

func testRestoreAppliesAStoredSelectionThatStillExists() {
    let defaults = UserDefaults(suiteName: "MenuVM-\(UUID().uuidString)")!
    let store = SelectionStore(defaults: defaults)
    store.save(StoredSelection(projectId: "p1", taskId: nil), userId: "u1")
    let vm = makeViewModel(selectionStore: store)
    vm.projects = [Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil)]

    vm.restoreSelection(userId: "u1")

    XCTAssertEqual(vm.selectedChoice?.projectId, "p1")
}

func testRestoreDropsAndClearsASelectionThatIsGone() {
    let defaults = UserDefaults(suiteName: "MenuVM-\(UUID().uuidString)")!
    let store = SelectionStore(defaults: defaults)
    store.save(StoredSelection(projectId: "gone", taskId: nil), userId: "u1")
    let vm = makeViewModel(selectionStore: store)
    vm.projects = [Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil)]

    vm.restoreSelection(userId: "u1")

    XCTAssertNil(vm.selectedChoice)
    // The dead key is cleaned up so it can't keep failing every launch.
    XCTAssertNil(store.load(userId: "u1"))
}

func testResetStillClearsTheInMemorySelection() {
    // Regression guard: sign-out must not start leaking a selection into the next user.
    let defaults = UserDefaults(suiteName: "MenuVM-\(UUID().uuidString)")!
    let vm = makeViewModel(selectionStore: SelectionStore(defaults: defaults))
    vm.markReady()
    vm.currentUserId = "u1"
    vm.projects = [Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil)]
    vm.select(Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Apollo", taskName: nil))

    vm.reset()

    XCTAssertNil(vm.selectedChoice)
    XCTAssertTrue(vm.projects.isEmpty)
    XCTAssertEqual(vm.query, "")
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter MenuViewModelTests`
Expected: FAIL to compile — `selectionStore`, `currentUserId`, and `restoreSelection` do not exist.

- [ ] **Step 3: Add the store to `MenuViewModel`**

The client is a single executable target, so the new `init` parameter gets a **default value** and every existing call site keeps compiling. In `apps/client-macos/Sources/TimeTrack/App/MenuViewModel.swift`:

```swift
private let selectionStore: SelectionStore

/// The signed-in user, set by AppDelegate once the session resolves. Selection persistence is
/// namespaced by it so one user can never inherit another's (possibly wrong-team) project.
var currentUserId: String?
```

and in `init`, add the parameter last with a default:

```swift
init(
    tracker: TimeTracker,
    dashboardURL: URL,
    openURL: @escaping (URL) -> Void,
    onSignIn: @escaping () -> Void,
    onSignOut: @escaping () -> Void,
    onQuit: @escaping () -> Void,
    selectionStore: SelectionStore = SelectionStore()
) {
    // ...existing assignments unchanged
    self.selectionStore = selectionStore
}
```

- [ ] **Step 4: Persist on select**

```swift
func select(_ choice: Choice) {
    selectedChoice = choice
    guard let currentUserId else { return }
    selectionStore.save(
        StoredSelection(projectId: choice.projectId, taskId: choice.taskId),
        userId: currentUserId
    )
}
```

- [ ] **Step 5: Add `restoreSelection`**

```swift
/// Apply the persisted selection for `userId`, if it still exists in the CURRENT project list.
/// Called by AppDelegate AFTER the project refresh — restoring against a stale or empty cache
/// would either drop a valid selection or apply one the user has since lost access to. A
/// selection that no longer resolves is dropped AND its stored key cleared, so a dead project
/// doesn't keep failing every launch.
func restoreSelection(userId: String) {
    let stored = selectionStore.load(userId: userId)
    guard let restored = SelectionResolver.resolve(stored, in: choices) else {
        if stored != nil { selectionStore.clear(userId: userId) }
        return
    }
    selectedChoice = restored
}
```

- [ ] **Step 6: Leave `reset()` clearing in-memory state, and clear the key on sign-out**

`reset()` keeps clearing `selectedChoice`, `query`, and `projects` exactly as today. Add the persisted-key cleanup and drop the user id:

```swift
func reset() {
    stop()
    isReady = false
    isSignedIn = false
    selectedChoice = nil
    query = ""
    projects = []
    currentUserId = nil
}
```

**Do not clear the stored key in `reset()`.** Sign-out should not forget the selection for the next time that same user signs back in — that is the whole feature. The key is namespaced, so leaving it is safe; dropping `currentUserId` is what prevents cross-user writes.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter MenuViewModelTests`
Expected: PASS.

- [ ] **Step 8: Wire the restore into the launch sequence**

In `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift`, `refreshProjects` (`:282-285`) currently ends by assigning the fresh list. Set the user id when the session resolves, and restore after the refresh:

```swift
private func refreshProjects() async {
    guard let fresh = try? await projectClient.list() else { return }
    projectCache.save(fresh)
    let userId = await session.userId()
    await MainActor.run {
        menuViewModel.projects = fresh
        menuViewModel.currentUserId = userId
        if let userId { menuViewModel.restoreSelection(userId: userId) }
    }
}
```

**Read the surrounding code before editing.** `refreshProjects` is also called from `refreshProjectsOnMenuOpen` (`:298-300`), so `restoreSelection` will run again each time the menu opens. That is harmless — it re-applies the same resolved choice — but confirm it does not stomp a selection the user just made by hand. If it can, guard the restore with `menuViewModel.selectedChoice == nil` and note that in the commit body.

- [ ] **Step 9: Build and run the full client suite**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/client-macos
git commit -m "feat(client): restore the last project selection on launch"
```

---

### Task 4: Fall back to the last entry's project on a fresh install

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/Projects/RecentSelectionClient.swift`
- Create: `apps/client-macos/Tests/TimeTrackTests/RecentSelectionClientTests.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift` (`refreshProjects`)

**Interfaces:**

- Consumes: `AuthSession` (existing), `StoredSelection` (Task 1), `SelectionStore` (Task 1).
- Produces: `final class RecentSelectionClient { func mostRecentSelection() async -> StoredSelection? }` — queries `GET /v1/time-entries` for a recent window and returns the newest entry's project/task, or nil.

**Scope guard.** This is a **fallback only** — it runs when `SelectionStore.load(userId:)` returns nil (fresh install, new Mac, reinstall). It must never override a stored local selection, and it must never block the UI: a failure simply leaves nothing pre-selected.

- [ ] **Step 1: Write the failing test**

Create `apps/client-macos/Tests/TimeTrackTests/RecentSelectionClientTests.swift`. Test the **pure decoding/selection logic**, not the network orchestration — that is the pattern `TimeEntryUploader.classify` already follows:

```swift
import XCTest
@testable import TimeTrack

final class RecentSelectionClientTests: XCTestCase {
    private func decode(_ json: String) -> StoredSelection? {
        RecentSelectionClient.newestSelection(in: Data(json.utf8))
    }

    func testPicksTheNewestEntrysProjectAndTask() {
        let selection = decode("""
        [
          {"id":"a","startTime":"2026-08-18T04:00:00.000Z","projectId":"p-old","taskId":null},
          {"id":"b","startTime":"2026-08-20T04:00:00.000Z","projectId":"p-new","taskId":"t-new"}
        ]
        """)
        XCTAssertEqual(selection, StoredSelection(projectId: "p-new", taskId: "t-new"))
    }

    func testIgnoresEntriesWithNoProject() {
        // An entry tracked with nothing selected tells us nothing to restore.
        let selection = decode("""
        [
          {"id":"a","startTime":"2026-08-18T04:00:00.000Z","projectId":"p-old","taskId":null},
          {"id":"b","startTime":"2026-08-20T04:00:00.000Z","projectId":null,"taskId":null}
        ]
        """)
        XCTAssertEqual(selection, StoredSelection(projectId: "p-old", taskId: nil))
    }

    func testReturnsNilForAnEmptyList() {
        XCTAssertNil(decode("[]"))
    }

    func testReturnsNilForMalformedJson() {
        XCTAssertNil(decode("not json"))
    }

    func testReturnsNilWhenNoEntryHasAProject() {
        XCTAssertNil(decode("""
        [{"id":"a","startTime":"2026-08-20T04:00:00.000Z","projectId":null,"taskId":null}]
        """))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter RecentSelectionClientTests`
Expected: FAIL to compile — `RecentSelectionClient` does not exist.

- [ ] **Step 3: Write the client**

Create `apps/client-macos/Sources/TimeTrack/Projects/RecentSelectionClient.swift`:

```swift
import Foundation

/// Fallback for a FRESH INSTALL: what project was this user last tracking against? (spec §6)
///
/// Reads the existing `GET /v1/time-entries` — no new endpoint, no `/v1` change. Strictly a
/// fallback: only consulted when `SelectionStore` has nothing for this user, and a failure
/// simply leaves nothing pre-selected rather than blocking the UI. Not a capture path.
final class RecentSelectionClient {
    private let baseURL: URL
    private let session: AuthSession
    /// How far back to look for a previous entry. A fortnight covers a holiday or a new Mac
    /// arriving mid-sprint without dragging back a project abandoned months ago.
    private static let lookbackDays = 14

    init(baseURL: URL, session: AuthSession) {
        self.baseURL = baseURL
        self.session = session
    }

    func mostRecentSelection() async -> StoredSelection? {
        guard let token = try? await session.accessToken() else { return nil }
        let now = Date()
        let from = now.addingTimeInterval(-Double(Self.lookbackDays) * 86_400)

        var components = URLComponents(
            url: baseURL.appendingPathComponent("time-entries"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "from", value: TimeEntryPayload.iso.string(from: from)),
            URLQueryItem(name: "to", value: TimeEntryPayload.iso.string(from: now)),
        ]
        guard let url = components?.url else { return nil }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode)
        else { return nil }

        return Self.newestSelection(in: data)
    }

    /// Pure decode + pick (unit-tested; the async orchestration above is build-verified).
    /// Returns the newest entry that actually names a project.
    static func newestSelection(in data: Data) -> StoredSelection? {
        struct Row: Decodable {
            let startTime: String
            let projectId: String?
            let taskId: String?
        }
        guard let rows = try? JSONDecoder().decode([Row].self, from: data) else { return nil }
        return rows
            .filter { $0.projectId != nil }
            .max { $0.startTime < $1.startTime }
            .flatMap { row in
                row.projectId.map { StoredSelection(projectId: $0, taskId: row.taskId) }
            }
    }
}
```

Note `startTime` values are ISO-8601 UTC and lexicographically ordered, so string comparison is a valid recency sort here. If the API ever returns offset-bearing timestamps this breaks — the e2e serialisation is `toISOString()`, so confirm that before relying on it.

- [ ] **Step 4: Run it to verify it passes**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter RecentSelectionClientTests`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the fallback into the launch sequence**

In `AppDelegate`, add the stored property beside the other clients and initialise it where `projectClient` is built (`:96`):

```swift
private let recentSelectionClient: RecentSelectionClient
// ...
self.recentSelectionClient = RecentSelectionClient(baseURL: baseURL, session: session)
```

Then extend `refreshProjects` so the fallback runs **only** when nothing is stored locally:

```swift
private func refreshProjects() async {
    guard let fresh = try? await projectClient.list() else { return }
    projectCache.save(fresh)
    let userId = await session.userId()

    // Fresh install / new Mac: nothing stored locally, so ask the server what this user was
    // last tracking against. Best-effort — a failure just means nothing is pre-selected.
    if let userId, selectionStore.load(userId: userId) == nil,
       let remote = await recentSelectionClient.mostRecentSelection() {
        selectionStore.save(remote, userId: userId)
    }

    await MainActor.run {
        menuViewModel.projects = fresh
        menuViewModel.currentUserId = userId
        if let userId { menuViewModel.restoreSelection(userId: userId) }
    }
}
```

`AppDelegate` needs its own `selectionStore` reference for that check — construct one (`SelectionStore()`) and pass the **same instance** into `MenuViewModel`, so both read and write the same defaults.

- [ ] **Step 6: Build and run the full client suite**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/client-macos
git commit -m "feat(client): seed the project selection from the last entry"
```

---

### Task 5: Full verification

- [ ] **Step 1: Build and test the client**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS. Paste the actual output.

- [ ] **Step 2: Manual smoke test — the reported problem**

1. Launch the client, sign in, pick a project, Start, Stop, quit the app.
2. Relaunch. **The project must already be selected** — no re-picking.
3. Sign out, sign in as a **different** user. Their picker must be empty, **not** showing the first user's project.
4. Sign back in as the first user. Their selection returns.
5. Archive the selected project in the dashboard, then relaunch the client. The picker must be **empty**, not showing a project that would fail on Start.

Record what you actually observed for each step.

- [ ] **Step 3: Confirm the sign-out guarantee did not regress**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter MenuViewModelTests`
Expected: PASS, including `testResetStillClearsTheInMemorySelection`. This is the CLAUDE.md §1 fail-safe behaviour — if it regressed, stop and fix before shipping.
