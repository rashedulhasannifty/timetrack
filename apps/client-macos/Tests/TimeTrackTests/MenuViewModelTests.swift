import XCTest
@testable import TimeTrack

final class MenuViewModelTests: XCTestCase {
    private func makeVM() -> MenuViewModel {
        let tracker = TimeTracker(buffer: BufferSpy(),
                                  clock: { Date(timeIntervalSince1970: 0) },
                                  idGen: { _ in "id-1" })
        return MenuViewModel(tracker: tracker,
                             dashboardURL: URL(string: "http://localhost:3000")!,
                             openURL: { _ in }, onSignIn: {}, onSignOut: {}, onQuit: {})
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
                               openURL: { _ in }, onSignIn: {}, onSignOut: { signedOut = true }, onQuit: {})

        vm.markReady()
        XCTAssertTrue(vm.isSignedIn, "precondition: a ready session reads as signed in")
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
        XCTAssertEqual(spy.entries.count, 1, "the in-progress span must be closed and enqueued")
        XCTAssertTrue(signedOut, "onSignOut must be invoked")
    }

    // Manual idle Discard: the coordinator trims the entry at away-start and opens a fresh one
    // (real start = the return instant) directly on TimeTracker, then calls
    // continueClockAfterDiscard(idleSeconds:). The clock must keep reading accumulated WORKED time
    // — anchor shifted forward by exactly the idle gap — not reset to the fresh entry's 0. The
    // selected project must carry over.
    func testDiscardContinuesClockFromWorkedTimeAndKeepsProject() {
        var now = Date(timeIntervalSince1970: 1_000)
        let tracker = TimeTracker(buffer: BufferSpy(), clock: { now }, idGen: { _ in UUID().uuidString })
        let vm = MenuViewModel(tracker: tracker,
                               dashboardURL: URL(string: "http://localhost:3000")!,
                               openURL: { _ in }, onSignIn: {}, onSignOut: {}, onQuit: {})
        var iconStart: Date?
        vm.onPhaseChanged = { _, startedAt in iconStart = startedAt }
        vm.markReady()
        vm.select(Choice(id: "k1", projectId: "p1", taskId: "k1", projectName: "Acme", taskName: "Design"))
        vm.start()                                             // entry A at t=1000
        XCTAssertEqual(vm.startedAt, Date(timeIntervalSince1970: 1_000))

        // Worked 1000→1200 (200s), idle 1200→1500 (300s). Coordinator trims A at 1200, opens a
        // fresh entry at the return instant (1500), then reports the 300s idle gap.
        now = Date(timeIntervalSince1970: 1_500)
        tracker.stop(at: Date(timeIntervalSince1970: 1_200))
        tracker.start(projectId: "p1", taskId: "k1", source: .manual)   // fresh entry, real start 1500
        vm.continueClockAfterDiscard(idleSeconds: 300)

        XCTAssertEqual(vm.phase, .tracking)
        // Anchor = old clock start (1000) + idle gap (300) = 1300 → elapsed at now(1500) = 200s,
        // exactly the pre-idle worked time; it keeps climbing from there.
        XCTAssertEqual(vm.startedAt, Date(timeIntervalSince1970: 1_300),
                       "clock continues from worked time, not the fresh entry's 0")
        XCTAssertEqual(iconStart, Date(timeIntervalSince1970: 1_300),
                       "the status icon gets the same worked-time anchor")
        XCTAssertEqual(vm.selectedChoice?.id, "k1", "the selected project/task carries over")
    }

    // A subsequent explicit user action clears the Discard anchor so a new span reads its real
    // elapsed again.
    func testExplicitStopClearsDiscardClockAnchor() {
        var now = Date(timeIntervalSince1970: 1_000)
        let tracker = TimeTracker(buffer: BufferSpy(), clock: { now }, idGen: { _ in UUID().uuidString })
        let vm = MenuViewModel(tracker: tracker,
                               dashboardURL: URL(string: "http://localhost:3000")!,
                               openURL: { _ in }, onSignIn: {}, onSignOut: {}, onQuit: {})
        vm.markReady()
        vm.start()
        now = Date(timeIntervalSince1970: 1_500)
        tracker.stop(at: Date(timeIntervalSince1970: 1_200))
        tracker.start(projectId: nil, taskId: nil, source: .manual)
        vm.continueClockAfterDiscard(idleSeconds: 300)
        XCTAssertEqual(vm.startedAt, Date(timeIntervalSince1970: 1_300), "precondition: anchor applied")

        vm.stop()
        now = Date(timeIntervalSince1970: 2_000)
        vm.start()                                             // fresh user session at t=2000
        XCTAssertEqual(vm.startedAt, Date(timeIntervalSince1970: 2_000),
                       "the anchor is gone; the new span reads its real start")
    }

    func testOpenMyDataOpensSelfView() {
        let tracker = TimeTracker(buffer: BufferSpy(),
                                  clock: { Date(timeIntervalSince1970: 0) },
                                  idGen: { _ in "id-1" })
        var opened: URL?
        let vm = MenuViewModel(tracker: tracker,
                               dashboardURL: URL(string: "http://localhost:3000")!,
                               openURL: { opened = $0 }, onSignIn: {}, onSignOut: {}, onQuit: {})
        vm.openMyData()
        XCTAssertEqual(opened?.absoluteString, "http://localhost:3000/me",
                       "My Data must open the /me self-view, not the dashboard root")
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
}
