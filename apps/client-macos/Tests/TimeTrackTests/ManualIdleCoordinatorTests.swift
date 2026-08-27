import XCTest
@testable import TimeTrack

/// The bug these pin: a manual entry ran through an away window and KEPT it unless the employee
/// came back and discarded it. A Mac left awake produced a 47-hour span, and its start day
/// reported 50h tracked out of a possible 24. Inactivity now closes the entry by policy.
///
/// Note what this type no longer has: no `presentAwayPrompt`. Once the timeout has closed the
/// entry there is nothing left for the employee to adjudicate on return, so the prompt is gone by
/// construction rather than by assertion.
final class ManualIdleCoordinatorTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func sequentialIdGen() -> (Date) -> String {
        var n = 0; return { _ in n += 1; return "id-\(n)" }
    }

    private func make(threshold: Int = 300)
        -> (ManualIdleCoordinator, TimeTracker, BufferSpy, MutableClock, () -> Int) {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())
        var stopNotifications = 0
        let coordinator = ManualIdleCoordinator(
            tracker: tracker,
            buffer: spy,
            thresholdSeconds: threshold,
            clock: clock.read,
            idGen: sequentialIdGen(),
            onTrackingStopped: { stopNotifications += 1 }
        )
        return (coordinator, tracker, spy, clock, { stopNotifications })
    }

    private func idleEvents(_ spy: BufferSpy) -> [[String: Any]] {
        spy.entries.enumerated()
            .filter { spy.entries[$0.offset].kind == .idleEvent }
            .map { spy.object(at: $0.offset) }
    }

    private func timeEntries(_ spy: BufferSpy) -> [[String: Any]] {
        spy.entries.enumerated()
            .filter { spy.entries[$0.offset].kind == .timeEntry }
            .map { spy.object(at: $0.offset) }
    }

    // The headline. Before this, the entry was still running here and would have kept running for
    // as long as the Mac stayed awake.
    func testInactivityClosesTheManualEntryAtTheThreshold() {
        let (c, tracker, spy, clock, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")           // manual entry opens at t0
        clock.advance(60); c.tick(idleSeconds: 0)              // the poller arms; still working
        clock.advance(300); c.tick(idleSeconds: 300)           // idle since t0+60

        XCTAssertFalse(tracker.isRunning, "an unattended manual timer must not keep counting")
        let entries = timeEntries(spy)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["startTime"] as? String, "2023-11-14T22:13:20Z")   // t0
        XCTAssertEqual(entries[0]["endTime"] as? String, "2023-11-14T22:19:20Z")     // t0+60+300
    }

    // The other half of the policy: the minutes before the timeout stay ON the entry, and the
    // window is recorded so the Idle panel can show what they were.
    func testTheKeptIdleWindowIsRecorded() {
        let (c, tracker, spy, clock, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: nil)
        c.tick(idleSeconds: 0)                                 // the poller arms the session
        clock.advance(300); c.tick(idleSeconds: 300)

        let events = idleEvents(spy)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0]["resolvedAction"] as? String, "KEPT")
        XCTAssertEqual(events[0]["startTime"] as? String, "2023-11-14T22:13:20Z")    // t0
        XCTAssertEqual(events[0]["endTime"] as? String, "2023-11-14T22:18:20Z")      // t0+300
    }

    // Sleep/lock knows exactly when input stopped, so it credits nothing and records no window.
    func testSleepClosesTheEntryWithoutCreditingIdleTime() {
        let (c, tracker, spy, clock, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: nil)
        clock.advance(60); c.markAway()

        XCTAssertFalse(tracker.isRunning)
        XCTAssertEqual(timeEntries(spy)[0]["endTime"] as? String, "2023-11-14T22:14:20Z")  // t0+60
        XCTAssertTrue(idleEvents(spy).isEmpty, "no idle minutes were credited, so there is no window")
    }

    // The menu bar reads MenuViewModel and cannot see a stop performed on the tracker directly —
    // without this the indicator would keep reporting a session that policy already ended.
    func testTheOwnerIsToldSoTheIndicatorCanFollow() {
        let (c, tracker, _, clock, stops) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: nil)
        c.tick(idleSeconds: 0)
        XCTAssertEqual(stops(), 0)
        clock.advance(300); c.tick(idleSeconds: 300)
        XCTAssertEqual(stops(), 1)
    }

    func testSignalsAreNoOpWhenNothingIsTracking() {
        let (c, tracker, spy, clock, stops) = make(threshold: 300)
        clock.advance(600); c.tick(idleSeconds: 600)
        c.markAway()
        XCTAssertFalse(tracker.isRunning)
        XCTAssertTrue(spy.entries.isEmpty)
        XCTAssertEqual(stops(), 0)
    }

    // The auto layer owns its own idle handling and stops at the away-start; this coordinator must
    // never reach across and close an AUTO span on manual terms.
    func testAnAutoSessionIsIgnored() {
        let (c, tracker, _, clock, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: nil, source: .auto)
        clock.advance(300); c.tick(idleSeconds: 300)
        XCTAssertTrue(tracker.isRunning, "an AUTO span is not this coordinator's to close")
    }

    // Integrity re-check: the signal was routed while a manual session was live, but TimeTracker
    // is the authority on what is running NOW. Stopping on a stale decision would close a span
    // that belongs to a different session — the same mis-attribution class as the sign-out leak.
    func testATimeoutAimedAtAnEndedSessionCannotCloseTheNextOne() {
        let (c, tracker, spy, clock, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: nil)
        clock.advance(300)
        tracker.stop()                                  // the user pressed Stop themselves
        tracker.start(projectId: "p2", taskId: nil)     // and started something else
        let openedAt = clock.now

        c.tick(idleSeconds: 300)
        // The new span is untouched: the monitor was disarmed by the stop and re-arms on this
        // tick, so nothing decides anything until the NEW session goes idle on its own.
        XCTAssertTrue(tracker.isRunning)
        XCTAssertEqual(timeEntries(spy).count, 1, "only the span the user stopped is closed")

        clock.advance(300); c.tick(idleSeconds: 300)
        XCTAssertFalse(tracker.isRunning)
        XCTAssertEqual(timeEntries(spy).count, 2)
        XCTAssertEqual(timeEntries(spy)[1]["startTime"] as? String,
                       ISO8601DateFormatter().string(from: openedAt))
    }

    // After a timeout the person restarts when they are ready, and the next session is protected
    // exactly like the first — the monitor re-arms rather than staying spent.
    func testTheNextManualSessionIsProtectedToo() {
        let (c, tracker, spy, clock, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: nil)
        c.tick(idleSeconds: 0)
        clock.advance(300); c.tick(idleSeconds: 300)
        XCTAssertFalse(tracker.isRunning)

        clock.advance(60)
        tracker.start(projectId: "p1", taskId: nil)     // they come back and start again
        c.tick(idleSeconds: 0)
        clock.advance(300); c.tick(idleSeconds: 300)
        XCTAssertFalse(tracker.isRunning, "the second session times out like the first")
        XCTAssertEqual(timeEntries(spy).count, 2)
    }
}
