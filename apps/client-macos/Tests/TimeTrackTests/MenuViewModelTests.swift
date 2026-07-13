import XCTest
@testable import TimeTrack

final class MenuViewModelTests: XCTestCase {
    private func makeVM() -> MenuViewModel {
        let tracker = TimeTracker(buffer: BufferSpy(),
                                  clock: { Date(timeIntervalSince1970: 0) },
                                  idGen: { _ in "id-1" })
        return MenuViewModel(tracker: tracker,
                             dashboardURL: URL(string: "http://localhost:3000")!,
                             openURL: { _ in }, onSignOut: {}, onQuit: {})
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
                               openURL: { _ in }, onSignOut: { signedOut = true }, onQuit: {})

        vm.markReady()
        vm.select(Choice(id: "p1", projectId: "p1", taskId: nil, projectName: "Acme", taskName: nil))
        vm.query = "acme"
        vm.projects = [Project(id: "p1", teamId: "t1", name: "Acme", archived: false, tasks: nil)]
        vm.start()
        XCTAssertEqual(vm.phase, .tracking, "precondition: a span must be in progress")

        vm.signOut()

        XCTAssertEqual(vm.phase, .idle)
        XCTAssertFalse(vm.isReady)
        XCTAssertNil(vm.selectedChoice)
        XCTAssertEqual(vm.query, "")
        XCTAssertEqual(vm.projects, [])
        XCTAssertEqual(spy.entries.count, 1, "the in-progress span must be closed and enqueued")
        XCTAssertTrue(signedOut, "onSignOut must be invoked")
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
