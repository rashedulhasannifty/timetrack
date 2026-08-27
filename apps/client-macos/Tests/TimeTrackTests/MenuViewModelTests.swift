import XCTest
@testable import TimeTrack

final class MenuViewModelTests: XCTestCase {
    private var isolatedSuiteNames: [String] = []

    override func tearDown() {
        // Each suite backing an isolated store is a real file under ~/Library/Preferences; drop
        // it so repeated test runs don't litter the filesystem (matches SelectionStoreTests).
        for suiteName in isolatedSuiteNames {
            UserDefaults(suiteName: suiteName)?.removePersistentDomain(forName: suiteName)
        }
        isolatedSuiteNames = []
        super.tearDown()
    }

    /// A `SelectionStore` backed by a throwaway `UserDefaults` suite, never `.standard` — tests
    /// that exercise `select`/`restoreSelection` must not write into the real user preferences of
    /// whatever machine runs the suite.
    private func makeIsolatedStore() -> SelectionStore {
        let suiteName = "MenuVM-\(UUID().uuidString)"
        isolatedSuiteNames.append(suiteName)
        return SelectionStore(defaults: UserDefaults(suiteName: suiteName)!)
    }

    private func makeVM(selectionStore: SelectionStore? = nil) -> MenuViewModel {
        let tracker = TimeTracker(buffer: BufferSpy(),
                                  clock: { Date(timeIntervalSince1970: 0) },
                                  idGen: { _ in "id-1" })
        return MenuViewModel(tracker: tracker,
                             dashboardURL: URL(string: "http://localhost:3000")!,
                             openURL: { _ in }, onSignIn: {}, onSignOut: {}, onQuit: {},
                             selectionStore: selectionStore ?? makeIsolatedStore())
    }

    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }

    /// A VM whose tracker writes to a spy and runs on a clock the test can move, so a
    /// switch mid-span produces two distinguishable entries.
    private func makeSwitchableVM() -> (MenuViewModel, BufferSpy, MutableClock) {
        let spy = BufferSpy()
        let clock = MutableClock(Date(timeIntervalSince1970: 1_700_000_000))
        var n = 0
        let tracker = TimeTracker(buffer: spy,
                                  clock: clock.read,
                                  idGen: { _ in n += 1; return "id-\(n)" })
        let vm = MenuViewModel(tracker: tracker,
                               dashboardURL: URL(string: "http://localhost:3000")!,
                               openURL: { _ in }, onSignIn: {}, onSignOut: {}, onQuit: {},
                               selectionStore: makeIsolatedStore())
        vm.markReady()
        return (vm, spy, clock)
    }

    private func choice(_ id: String) -> Choice {
        Choice(id: id, projectId: id, taskId: nil, projectName: id, taskName: nil)
    }

    // Regression: `select` used to only store the pick. TimeTracker captures the selection when
    // a span OPENS and enqueues it on close, so switching mid-span filed the ENTIRE span —
    // before and after the switch — under the previous project. In AUTO mode that span runs
    // from login to the first idle window, so it is hours of work on the wrong project.
    func testSwitchingProjectMidSpanClosesTheOldEntryAndOpensANewOne() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.select(choice("p1"))
        vm.start()
        clock.advance(3600)

        vm.select(choice("p2"))

        XCTAssertEqual(spy.entries.count, 1, "the running entry should have been closed")
        XCTAssertEqual(spy.object(at: 0)["projectId"] as? String, "p1")
        XCTAssertEqual(vm.phase, .tracking, "a new span should be running under p2")

        vm.stop()
        XCTAssertEqual(spy.entries.count, 2)
        XCTAssertEqual(spy.object(at: 1)["projectId"] as? String, "p2")
    }

    func testSwitchingProjectKeepsTheClockReadingAccumulatedTime() {
        let (vm, _, clock) = makeSwitchableVM()
        vm.select(choice("p1"))
        vm.start()
        let originalStart = vm.startedAt
        clock.advance(3600)

        vm.select(choice("p2"))

        // The new entry starts now; the header must keep counting the session, not reset to 0.
        XCTAssertEqual(vm.startedAt, originalStart)
    }

    func testSwitchingProjectWhilePausedChangesWhatResumeOpens() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.select(choice("p1"))
        vm.start()
        clock.advance(600)
        vm.pause()

        vm.select(choice("p2"))
        XCTAssertEqual(vm.phase, .paused, "switching must not resume a paused session")
        vm.resume()
        clock.advance(600)
        vm.stop()

        XCTAssertEqual(spy.object(at: 1)["projectId"] as? String, "p2")
    }

    func testSwitchingProjectWhileIdleRecordsNothing() {
        let (vm, spy, _) = makeSwitchableVM()
        vm.select(choice("p1"))
        vm.select(choice("p2"))
        XCTAssertTrue(spy.entries.isEmpty)
        XCTAssertEqual(vm.phase, .idle)
    }

    func testNoteIsEnqueuedWithTheSpan() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.start()
        vm.note = "  drafting the release notes  "
        clock.advance(600)
        vm.stop()

        // Trimmed, and carried on the entry the API stores.
        XCTAssertEqual(spy.object(at: 0)["note"] as? String, "drafting the release notes")
    }

    func testTypingANoteDoesNotSplitTheRunningSpan() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.start()
        clock.advance(300)
        vm.note = "a"
        vm.note = "ab"
        vm.note = "abc"
        clock.advance(300)
        // A note re-describes the span; it must not re-attribute it the way a project switch does.
        XCTAssertTrue(spy.entries.isEmpty, "nothing should have been closed while typing")
        vm.stop()
        XCTAssertEqual(spy.entries.count, 1)
        XCTAssertEqual(spy.object(at: 0)["note"] as? String, "abc")
    }

    func testAWhitespaceOnlyNoteIsSentAsNull() {
        let (vm, spy, _) = makeSwitchableVM()
        vm.start()
        vm.note = "   "
        vm.stop()
        XCTAssertNil(spy.object(at: 0)["note"] as? String)
    }

    func testStopClearsTheNoteSoTheNextEntryDoesNotInheritIt() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.start()
        vm.note = "first task"
        vm.stop()
        vm.start()
        clock.advance(60)
        vm.stop()

        XCTAssertEqual(vm.note, "")
        XCTAssertNil(spy.object(at: 1)["note"] as? String)
    }

    func testSwitchingProjectCarriesTheNoteOntoTheNewSpan() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.select(choice("p1"))
        vm.start()
        vm.note = "same work, right project"
        clock.advance(600)
        vm.select(choice("p2"))
        clock.advance(600)
        vm.stop()

        XCTAssertEqual(spy.object(at: 0)["note"] as? String, "same work, right project")
        XCTAssertEqual(spy.object(at: 1)["note"] as? String, "same work, right project")
    }

    func testToggleStartsThenStops() {
        let (vm, spy, clock) = makeSwitchableVM()
        vm.toggle()
        XCTAssertEqual(vm.phase, .tracking)
        clock.advance(600)
        vm.toggle()
        XCTAssertEqual(vm.phase, .idle)
        XCTAssertEqual(spy.entries.count, 1)
    }

    func testToggleResumesAPausedSessionRatherThanStartingFresh() {
        let (vm, _, clock) = makeSwitchableVM()
        vm.start()
        clock.advance(300)
        vm.pause()

        vm.toggle()
        // Starting fresh here would silently abandon a pause the person meant to come back to.
        XCTAssertEqual(vm.phase, .tracking)
    }

    func testToggleIsInertUntilReady() {
        let vm = makeVM()
        vm.toggle()
        XCTAssertEqual(vm.phase, .idle)
    }

    func testStartIsNoOpUntilReady() {
        let vm = makeVM()
        vm.select(Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Acme", taskName: nil))
        vm.start()
        XCTAssertEqual(vm.phase, .idle)
    }

    func testStartWhenReadyBeginsTracking() {
        let vm = makeVM()
        vm.markReady()
        vm.select(Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Acme", taskName: nil))
        vm.start()
        XCTAssertEqual(vm.phase, .tracking)
        XCTAssertNotNil(vm.startedAt)
        XCTAssertTrue(vm.iconIsTracking)
    }

    func testStopReturnsToIdle() {
        let vm = makeVM()
        vm.markReady()
        vm.start()
        vm.stop()
        XCTAssertEqual(vm.phase, .idle)
        XCTAssertFalse(vm.iconIsTracking)
    }

    func testPauseThenResume() {
        let vm = makeVM()
        vm.markReady()
        vm.start()
        vm.pause()
        XCTAssertEqual(vm.phase, .paused)
        XCTAssertTrue(vm.iconIsTracking, "the indicator stays visible while paused")
        vm.resume()
        XCTAssertEqual(vm.phase, .tracking)
    }

    func testSignOutResetsStateAndClosesInProgressSpan() {
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy,
                                  clock: { Date(timeIntervalSince1970: 0) },
                                  idGen: { _ in "id-1" })
        var signedOut = false
        let vm = MenuViewModel(tracker: tracker,
                               dashboardURL: URL(string: "http://localhost:3000")!,
                               openURL: { _ in }, onSignIn: {}, onSignOut: { signedOut = true }, onQuit: {},
                               selectionStore: makeIsolatedStore())

        vm.markReady()
        XCTAssertTrue(vm.isSignedIn, "precondition: a ready session reads as signed in")
        vm.currentUserId = "u1"
        vm.select(Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Acme", taskName: nil))
        vm.query = "acme"
        vm.projects = [Project(id: "p1", teamId: "t1", name: "Acme", archived: false, tasks: nil)]
        vm.start()
        XCTAssertEqual(vm.phase, .tracking, "precondition: a span must be in progress")

        vm.signOut()

        XCTAssertEqual(vm.phase, .idle)
        XCTAssertFalse(vm.isReady)
        // Regression: the dropdown must flip to signed-out so it no longer offers My Data /
        // Sign Out after the user signs out (the reported bug).
        XCTAssertFalse(vm.isSignedIn, "sign-out must clear the signed-in state")
        XCTAssertNil(vm.selectedChoice)
        XCTAssertEqual(vm.query, "")
        XCTAssertEqual(vm.projects, [])
        XCTAssertNil(vm.currentUserId, "so a subsequent select() before a new sign-in can never write under the old user")
        XCTAssertEqual(spy.entries.count, 1, "the in-progress span must be closed and enqueued")
        XCTAssertTrue(signedOut, "onSignOut must be invoked")
    }

    func testOpenMyDataOpensSelfView() {
        let tracker = TimeTracker(buffer: BufferSpy(),
                                  clock: { Date(timeIntervalSince1970: 0) },
                                  idGen: { _ in "id-1" })
        var opened: URL?
        let vm = MenuViewModel(tracker: tracker,
                               dashboardURL: URL(string: "http://localhost:3000")!,
                               openURL: { opened = $0 }, onSignIn: {}, onSignOut: {}, onQuit: {},
                               selectionStore: makeIsolatedStore())
        vm.openMyData()
        XCTAssertEqual(opened?.absoluteString, "http://localhost:3000/me",
                       "My Data must open the /me self-view, not the dashboard root")
    }

    func testSelectPersistsTheChoiceForTheSignedInUser() {
        let store = makeIsolatedStore()
        let vm = makeVM(selectionStore: store)
        vm.markReady()
        vm.currentUserId = "u1"
        vm.projects = [Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil)]

        vm.select(Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Apollo", taskName: nil))

        XCTAssertEqual(store.load(userId: "u1"), StoredSelection(projectId: "p1", taskId: nil))
    }

    func testSelectDoesNotPersistUnderANilUser() {
        // No signed-in user known yet (currentUserId nil) — must never write anywhere, since
        // there is no safe key to namespace it under.
        let store = makeIsolatedStore()
        let vm = makeVM(selectionStore: store)
        vm.projects = [Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil)]

        vm.select(Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Apollo", taskName: nil))

        XCTAssertNil(store.load(userId: "u1"))
        XCTAssertEqual(vm.selectedChoice?.projectId, "p1", "the in-memory selection still applies")
    }

    func testRestoreAppliesAStoredSelectionThatStillExists() {
        let store = makeIsolatedStore()
        store.save(StoredSelection(projectId: "p1", taskId: nil), userId: "u1")
        let vm = makeVM(selectionStore: store)
        vm.projects = [Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil)]

        vm.restoreSelection(userId: "u1")

        XCTAssertEqual(vm.selectedChoice?.projectId, "p1")
    }

    func testRestoreDropsAndClearsASelectionThatIsGone() {
        let store = makeIsolatedStore()
        store.save(StoredSelection(projectId: "gone", taskId: nil), userId: "u1")
        let vm = makeVM(selectionStore: store)
        vm.projects = [Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil)]

        vm.restoreSelection(userId: "u1")

        XCTAssertNil(vm.selectedChoice)
        // The dead key is cleaned up so it can't keep failing every launch.
        XCTAssertNil(store.load(userId: "u1"))
    }

    // Ruling A regression: ProjectCache is a single global unkeyed file, cleared wholesale on
    // sign-out (5c315c8) so one user's team never leaks into the next user's picker. That means
    // `projects` reads empty on every offline re-login until a network refresh succeeds — and an
    // empty list is indistinguishable from "your project was archived" to SelectionResolver. A
    // restore against an empty list must therefore leave the stored key untouched, never treat
    // "not loaded yet" as "gone".
    func testRestoreLeavesTheStoredSelectionUntouchedWhenTheProjectListIsEmpty() {
        let store = makeIsolatedStore()
        store.save(StoredSelection(projectId: "p1", taskId: nil), userId: "u1")
        let vm = makeVM(selectionStore: store)
        XCTAssertEqual(vm.projects, [], "precondition: nothing has loaded yet")

        vm.restoreSelection(userId: "u1")

        XCTAssertNil(vm.selectedChoice, "can't resolve against an empty list")
        XCTAssertEqual(store.load(userId: "u1"), StoredSelection(projectId: "p1", taskId: nil),
                       "the saved selection must survive an empty-list restore attempt")
    }

    // Ruling B regression: refreshProjects() runs at launch AND on every menu open, so restore
    // must never clobber a selection the user already made by hand in this session.
    func testRestoreDoesNotOverwriteASelectionMadeByHand() {
        let store = makeIsolatedStore()
        store.save(StoredSelection(projectId: "p1", taskId: nil), userId: "u1")
        let vm = makeVM(selectionStore: store)
        vm.projects = [
            Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil),
            Project(id: "p2", teamId: "team", name: "Beta", archived: false, tasks: nil),
        ]
        vm.select(Choice(id: "p2", projectId: "p2", taskId: nil, projectName: "Beta", taskName: nil))

        vm.restoreSelection(userId: "u1")

        XCTAssertEqual(vm.selectedChoice?.projectId, "p2", "the hand-made selection must win")
    }

    func testResetStillClearsTheInMemorySelection() {
        // Regression guard: sign-out must not start leaking a selection into the next user.
        let store = makeIsolatedStore()
        let vm = makeVM(selectionStore: store)
        vm.markReady()
        vm.currentUserId = "u1"
        vm.projects = [Project(id: "p1", teamId: "team", name: "Apollo", archived: false, tasks: nil)]
        vm.select(Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Apollo", taskName: nil))

        vm.reset()

        XCTAssertNil(vm.selectedChoice)
        XCTAssertTrue(vm.projects.isEmpty)
        XCTAssertEqual(vm.query, "")
        XCTAssertNil(vm.currentUserId)
        // Deliberate deviation from an earlier spec draft (design doc §6): the persisted key is
        // NOT cleared on sign-out. Clearing it would defeat the feature for anyone who signs out
        // at the end of the day; per-user namespacing is what keeps this safe, not an empty key.
        XCTAssertEqual(store.load(userId: "u1"), StoredSelection(projectId: "p1", taskId: nil),
                       "the persisted key deliberately survives sign-out; namespacing is the guard")
    }

    func testFilteredChoicesMatchQuery() {
        let vm = makeVM()
        vm.projects = [
            Project(id: "p1", teamId: "t1", name: "Acme", archived: false,
                    tasks: [ProjectTask(id: "k1", projectId: "p1", name: "Design")]),
            Project(id: "p2", teamId: "t1", name: "Beta", archived: false, tasks: nil),
        ]
        vm.query = "design"
        XCTAssertEqual(vm.filteredChoices.map(\.id), ["k1"])
        vm.query = ""
        XCTAssertEqual(vm.filteredChoices.count, 3) // Acme, Acme›Design, Beta
    }

    // Regression: auto tracking writes straight to `TimeTracker` from `AutoTrackingCoordinator`,
    // so no method on this type ever ran when an AUTO span opened or closed. `sync()` — the only
    // thing that moves `phase`/`startedAt` and fires `onPhaseChanged` — is reachable only from
    // the manual affordances, so the always-visible menu-bar indicator read "idle" for the whole
    // login-to-first-idle AUTO span, and would have read "tracking" after an auto-stop. Wire the
    // two the way AppDelegate does and assert the indicator follows the real tracker state.
    func testAutoTrackingStartAndStopDriveTheMenuBarPhase() {
        let spy = BufferSpy()
        let clock = MutableClock(Date(timeIntervalSince1970: 1_700_000_000))
        var n = 0
        let tracker = TimeTracker(buffer: spy,
                                  clock: clock.read,
                                  idGen: { _ in n += 1; return "id-\(n)" })
        let vm = MenuViewModel(tracker: tracker,
                               dashboardURL: URL(string: "http://localhost:3000")!,
                               openURL: { _ in }, onSignIn: {}, onSignOut: {}, onQuit: {},
                               selectionStore: makeIsolatedStore())
        vm.markReady()
        var iconStates: [Bool] = []
        vm.onPhaseChanged = { isTracking, _ in iconStates.append(isTracking) }

        let coordinator = AutoTrackingCoordinator(
            tracker: tracker,
            buffer: spy,
            thresholdSeconds: 300,
            currentSelection: { vm.selectionForAuto },
            presentAwayPrompt: { _, _ in },
            clock: clock.read,
            onTrackingStateChanged: { [weak vm] in vm?.refreshFromTracker() })

        coordinator.activate()                     // login: the AUTO span opens
        XCTAssertEqual(vm.phase, .tracking)
        XCTAssertEqual(vm.startedAt, clock.now)

        clock.advance(300)
        coordinator.tick(idleSeconds: 300)         // idle threshold: the AUTO span auto-stops
        XCTAssertEqual(vm.phase, .idle)
        XCTAssertNil(vm.startedAt)

        XCTAssertEqual(iconStates, [true, false],
                       "the menu-bar indicator must follow both auto transitions, not just the start")
    }
}
