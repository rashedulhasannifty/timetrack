import XCTest
@testable import TimeTrack

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
        -> (ManualIdleCoordinator, TimeTracker, BufferSpy, MutableClock, () -> ((AwayResolution) -> Void)?, () -> Int) {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())
        var pendingResolve: ((AwayResolution) -> Void)?
        var dismissals = 0
        let coordinator = ManualIdleCoordinator(
            tracker: tracker,
            buffer: spy,
            thresholdSeconds: threshold,
            presentAwayPrompt: { _, resolve in pendingResolve = resolve },
            clock: clock.read,
            idGen: sequentialIdGen(),
            dismissPrompt: { dismissals += 1 }
        )
        return (coordinator, tracker, spy, clock, { pendingResolve }, { dismissals })
    }

    // Helper: decoded idle-events only (kind == .idleEvent).
    private func idleEvents(_ spy: BufferSpy) -> [[String: Any]] {
        spy.entries.enumerated()
            .filter { spy.entries[$0.offset].kind == .idleEvent }
            .map { spy.object(at: $0.offset) }
    }

    func testKeepLeavesEntryRunningAndEmitsKeptIdleEvent() {
        let (c, tracker, spy, clock, resolver, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // manual entry opens at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0 (timer NOT stopped)
        XCTAssertTrue(tracker.isRunning, "manual timer keeps running while away")
        clock.advance(120); c.tick(idleSeconds: 5)            // resume at t0+420 → prompt
        resolver()?(.keep)

        XCTAssertTrue(tracker.isRunning, "keep leaves the entry running, untouched")
        let events = idleEvents(spy)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0]["resolvedAction"] as? String, "KEPT")
        // No time-entry was enqueued (nothing closed).
        XCTAssertFalse(spy.entries.contains { $0.kind == .timeEntry })
    }

    func testDiscardTrimsAtAwayStartAndStartsNewManualEntry() {
        let (c, tracker, spy, clock, resolver, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A opens at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        clock.advance(120); c.tick(idleSeconds: 5)            // resume at t0+420 → prompt
        resolver()?(.discard)

        // Entry A closed at away-start (t0..t0), a new manual entry is now running.
        let timeEntries = spy.entries.enumerated().filter { $0.element.kind == .timeEntry }.map { spy.object(at: $0.offset) }
        XCTAssertEqual(timeEntries.count, 1, "the trimmed entry A is flushed")
        XCTAssertEqual(timeEntries[0]["source"] as? String, "MANUAL")
        XCTAssertEqual(timeEntries[0]["endTime"] as? String, timeEntries[0]["startTime"] as? String,
                       "entry A trimmed to away-start (start == end == t0)")
        XCTAssertEqual(timeEntries[0]["projectId"] as? String, "p1")
        XCTAssertTrue(tracker.isRunning, "a fresh manual entry continues from the return instant")

        let events = idleEvents(spy)
        XCTAssertEqual(events.last?["resolvedAction"] as? String, "DISCARDED")
    }

    func testSignalsAreNoOpWhenNotInManualSession() {
        let (c, tracker, spy, clock, _, _) = make(threshold: 300)
        // tracker is idle (no manual session)
        clock.advance(300); c.tick(idleSeconds: 300)
        clock.advance(120); c.tick(idleSeconds: 5)
        XCTAssertFalse(tracker.isRunning)
        XCTAssertTrue(spy.entries.isEmpty, "no prompt, no events without a manual session")
    }

    func testAutoSessionIsIgnored() {
        let (c, tracker, spy, clock, resolver, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1", source: .auto)  // AUTO, not manual
        clock.advance(300); c.tick(idleSeconds: 300)
        clock.advance(120); c.tick(idleSeconds: 5)
        XCTAssertNil(resolver(), "manual coordinator does not act on an AUTO session")
        XCTAssertTrue(idleEvents(spy).isEmpty)
    }

    func testSessionEndsWhileAwayAbandonsAndLaterResumeDoesNotTrim() {
        let (c, tracker, spy, clock, resolver, dismissals) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        tracker.stop()                                        // user stops the manual timer mid-away
        clock.advance(60); c.tick(idleSeconds: 360)           // next signal reconciles

        let events = idleEvents(spy)
        XCTAssertEqual(events.last?["resolvedAction"] as? String, "UNRESOLVED")
        XCTAssertEqual(dismissals(), 1, "a showing prompt would be dismissed on abandon")
        XCTAssertNil(resolver(), "no keep/discard prompt is presented for the abandoned window")
    }

    func testDiscardAfterEntryChangedRecordsUnresolvedNoTrim() {
        let (c, tracker, spy, clock, resolver, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0 (entry A)
        clock.advance(120); c.tick(idleSeconds: 5)            // resume → prompt (entry A still live)
        // Before resolving, the user stops A and starts a different entry B.
        tracker.stop()
        tracker.start(projectId: "p2", taskId: nil)           // entry B
        let bEntriesBefore = spy.entries.filter { $0.kind == .timeEntry }.count
        resolver()?(.discard)

        // B must not be trimmed; the away window is UNRESOLVED.
        XCTAssertTrue(tracker.isRunning, "entry B keeps running, untrimmed")
        XCTAssertEqual(spy.entries.filter { $0.kind == .timeEntry }.count, bEntriesBefore,
                       "no extra trim/close of entry B")
        XCTAssertEqual(idleEvents(spy).last?["resolvedAction"] as? String, "UNRESOLVED")
    }
}
