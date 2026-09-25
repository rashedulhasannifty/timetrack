import XCTest
@testable import TimeTrack

/// The hole this closes: `ManualIdleMonitor` reads the OS idle counter, so it is installed only
/// inside `AckGate` on the live-policy branch. A session where the policy fetch never succeeds
/// enables manual tracking (the stored ack marker allows it) and installs no idle detection at
/// all — and a forgotten timer is unbounded again, which is the 700-minute day.
final class ManualSessionCapTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)
    private let twelveHours = 12 * 3600

    private func sequentialIdGen() -> (Date) -> String {
        var n = 0; return { _ in n += 1; return "id-\(n)" }
    }

    private func make() -> (ManualSessionCap, TimeTracker, BufferSpy, MutableClock, () -> Int) {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())
        var stopNotifications = 0
        let cap = ManualSessionCap(
            tracker: tracker,
            maxSeconds: twelveHours,
            clock: clock.read,
            onTrackingStopped: { stopNotifications += 1 }
        )
        return (cap, tracker, spy, clock, { stopNotifications })
    }

    private func timeEntries(_ spy: BufferSpy) -> [[String: Any]] {
        spy.entries.enumerated()
            .filter { spy.entries[$0.offset].kind == .timeEntry }
            .map { spy.object(at: $0.offset) }
    }

    func testAnEntryUnderTheCapIsLeftAlone() {
        let (cap, tracker, spy, clock, stops) = make()
        tracker.start(projectId: "p1", taskId: nil)

        clock.advance(Double(twelveHours) - 1); cap.fire()

        XCTAssertTrue(tracker.isRunning, "a working day is not something to cut short")
        XCTAssertTrue(timeEntries(spy).isEmpty)
        XCTAssertEqual(stops(), 0)
    }

    func testAnEntryAtTheCapIsClosedAtTheDeadline() {
        let (cap, tracker, spy, clock, stops) = make()
        tracker.start(projectId: "p1", taskId: "k1")

        clock.advance(Double(twelveHours)); cap.fire()

        XCTAssertFalse(tracker.isRunning)
        let entries = timeEntries(spy)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["startTime"] as? String, "2023-11-14T22:13:20Z")   // t0
        XCTAssertEqual(entries[0]["endTime"] as? String, "2023-11-15T10:13:20Z")     // t0 + 12h
        XCTAssertEqual(stops(), 1, "the menu bar cannot see a stop performed on the tracker")
    }

    // The whole point of a deadline rather than "stop now": a Mac asleep from hour three to hour
    // twenty wakes to a single very late tick. Closing at `now` would hand the timesheet the
    // twenty-hour span this type exists to prevent.
    func testALateTickStillClosesAtTheDeadlineNotAtNow() {
        let (cap, tracker, spy, clock, _) = make()
        tracker.start(projectId: "p1", taskId: nil)

        clock.advance(20 * 3600); cap.fire()            // noticed eight hours late

        XCTAssertFalse(tracker.isRunning)
        XCTAssertEqual(timeEntries(spy)[0]["endTime"] as? String, "2023-11-15T10:13:20Z")  // t0 + 12h
    }

    // No idle window is written. `ManualIdleMonitor` can say when input stopped because it was
    // watching; this type was not, so it makes no claim about where the person was.
    func testNoIdleWindowIsInvented() {
        let (cap, tracker, spy, clock, _) = make()
        tracker.start(projectId: "p1", taskId: nil)

        clock.advance(Double(twelveHours)); cap.fire()

        XCTAssertTrue(spy.entries.allSatisfy { $0.kind == .timeEntry },
                      "the cap saw no input, so it has nothing to say about idleness")
    }

    // An AUTO span is the auto layer's to close, on its own terms — and it only exists when the
    // gate opened, which is the case where this type is redundant anyway.
    func testAnAutoSessionIsIgnored() {
        let (cap, tracker, _, clock, _) = make()
        tracker.start(projectId: "p1", taskId: nil, source: .auto)

        clock.advance(24 * 3600); cap.fire()

        XCTAssertTrue(tracker.isRunning, "an AUTO span is not this type's to close")
    }

    func testNothingRunningIsANoOp() {
        let (cap, tracker, spy, clock, stops) = make()

        clock.advance(24 * 3600); cap.fire()

        XCTAssertFalse(tracker.isRunning)
        XCTAssertTrue(spy.entries.isEmpty)
        XCTAssertEqual(stops(), 0)
    }

    // A paused session is a break the person already took; the tracker is not tracking, so there
    // is no open span to cap.
    func testAPausedSessionIsIgnored() {
        let (cap, tracker, spy, clock, _) = make()
        tracker.start(projectId: "p1", taskId: nil)
        tracker.pause()

        clock.advance(24 * 3600); cap.fire()

        XCTAssertEqual(timeEntries(spy).count, 1, "only the span the pause closed")
    }

    // The cap is a property of the entry, not of the day: whatever they start next gets its own
    // twelve hours rather than inheriting the first one's.
    func testTheNextEntryGetsItsOwnTwelveHours() {
        let (cap, tracker, spy, clock, _) = make()
        tracker.start(projectId: "p1", taskId: nil)
        clock.advance(Double(twelveHours)); cap.fire()
        XCTAssertFalse(tracker.isRunning)

        tracker.start(projectId: "p2", taskId: nil)     // they start again
        clock.advance(Double(twelveHours) - 1); cap.fire()
        XCTAssertTrue(tracker.isRunning, "the second entry measures its own age")

        clock.advance(1); cap.fire()
        XCTAssertFalse(tracker.isRunning)
        XCTAssertEqual(timeEntries(spy).count, 2)
    }
}
