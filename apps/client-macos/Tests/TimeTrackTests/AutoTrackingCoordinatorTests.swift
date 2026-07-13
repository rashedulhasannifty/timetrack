import XCTest
@testable import TimeTrack

final class AutoTrackingCoordinatorTests: XCTestCase {
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

    /// Builds a coordinator whose prompt presenter is captured so the test can answer it.
    private func make(threshold: Int = 300, selection: TimeTracker.Selection = .init(projectId: "p1", taskId: "k1"))
        -> (AutoTrackingCoordinator, TimeTracker, BufferSpy, MutableClock, () -> ((AwayResolution) -> Void)?) {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())
        var pendingResolve: ((AwayResolution) -> Void)?
        let coordinator = AutoTrackingCoordinator(
            tracker: tracker,
            buffer: spy,
            thresholdSeconds: threshold,
            currentSelection: { selection },
            presentAwayPrompt: { _, resolve in pendingResolve = resolve },
            clock: clock.read,
            idGen: sequentialIdGen()
        )
        return (coordinator, tracker, spy, clock, { pendingResolve })
    }

    func testActivateStartsAnAutoEntry() {
        let (coordinator, _, spy, clock, _) = make()
        coordinator.activate()
        clock.advance(60)
        coordinator.markAway()                       // stop to flush the entry to the buffer
        XCTAssertEqual(spy.entries.count, 1)
        XCTAssertEqual(spy.object(at: 0)["source"] as? String, "AUTO")
        XCTAssertEqual(spy.object(at: 0)["projectId"] as? String, "p1")
    }

    func testKeepBridgesTheAwayWindowAndEmitsKeptIdleEvent() {
        let (coordinator, _, spy, clock, resolver) = make(threshold: 300)
        coordinator.activate()                        // AUTO entry #1 opens at t0
        clock.advance(300); coordinator.tick(idleSeconds: 300)   // stop entry #1 at t0 (away)
        clock.advance(120); coordinator.tick(idleSeconds: 5)     // resume at t0+420 → prompt
        resolver()?(.keep)                            // Keep

        // Enqueued: entry#1 (t0..t0, stopped at away-start), bridge (t0..t0+420), then entry#3 opens.
        let idleEvents = spy.entries.compactMap { try? JSONSerialization.jsonObject(with: $0.payload) as? [String: Any] }
            .filter { $0["resolvedAction"] != nil }
        XCTAssertEqual(idleEvents.count, 1)
        XCTAssertEqual(idleEvents[0]["resolvedAction"] as? String, "KEPT")
        XCTAssertEqual(idleEvents[0]["startTime"] as? String, "2023-11-14T22:13:20Z")            // t0
        XCTAssertEqual(idleEvents[0]["endTime"] as? String, "2023-11-14T22:20:20Z")              // t0+420

        let bridges = spy.entries.compactMap { try? JSONSerialization.jsonObject(with: $0.payload) as? [String: Any] }
            .filter { ($0["source"] as? String) == "AUTO" && ($0["endTime"] as? String) == "2023-11-14T22:20:20Z" }
        XCTAssertEqual(bridges.count, 1, "Keep records a contiguous bridge span over the away window")
    }

    func testDiscardEmitsDiscardedIdleEventAndNoBridge() {
        let (coordinator, _, spy, clock, resolver) = make(threshold: 300)
        coordinator.activate()
        clock.advance(300); coordinator.tick(idleSeconds: 300)
        clock.advance(60); coordinator.tick(idleSeconds: 1)      // resume at t0+360
        resolver()?(.discard)

        let idleEvents = spy.entries.compactMap { try? JSONSerialization.jsonObject(with: $0.payload) as? [String: Any] }
            .filter { $0["resolvedAction"] != nil }
        XCTAssertEqual(idleEvents.count, 1)
        XCTAssertEqual(idleEvents[0]["resolvedAction"] as? String, "DISCARDED")

        let bridges = spy.entries.compactMap { try? JSONSerialization.jsonObject(with: $0.payload) as? [String: Any] }
            .filter { ($0["source"] as? String) == "AUTO" && ($0["endTime"] as? String) == "2023-11-14T22:19:20Z" }
        XCTAssertTrue(bridges.isEmpty, "Discard leaves the away window as an uncounted gap")
    }

    func testDeactivateWhileAwayEmitsUnresolved() {
        let (coordinator, _, spy, clock, _) = make(threshold: 300)
        coordinator.activate()
        clock.advance(300); coordinator.tick(idleSeconds: 300)   // away
        clock.advance(90)
        coordinator.deactivate()

        let idleEvents = spy.entries.compactMap { try? JSONSerialization.jsonObject(with: $0.payload) as? [String: Any] }
            .filter { $0["resolvedAction"] != nil }
        XCTAssertEqual(idleEvents.last?["resolvedAction"] as? String, "UNRESOLVED")
    }

    func testManualSessionIsNeverAutoStopped() {
        let (coordinator, tracker, spy, clock, _) = make(threshold: 300)
        // Employee is in a MANUAL session; auto-tracking is also active.
        tracker.start(projectId: "m", taskId: nil, source: .manual)
        coordinator.activate()                                   // start(auto) is a no-op (already tracking)
        clock.advance(600)
        coordinator.tick(idleSeconds: 600)                        // gated: manual live → forwarder no-ops

        XCTAssertTrue(tracker.isRunning, "the manual entry stays open")
        XCTAssertTrue(spy.entries.isEmpty, "no auto-stop, no bridge, no IdleEvent during a manual span")
    }

    func testPausedManualSessionStandsDownAutoLayer() {
        let (coordinator, tracker, spy, clock, resolver) = make(threshold: 300)
        coordinator.activate()                                   // AUTO entry opens (monitor .active)
        clock.advance(10)
        tracker.pause()                                          // user pauses → closes entry → .paused
        let countAfterPause = spy.entries.count                 // the paused span was enqueued
        // An idle→resume cycle while paused must be ignored — else `resolve` would restart
        // tracking and open an AUTO entry over the paused session (TimeTracker.start only
        // self-guards against a second `.tracking` start, not `.paused`).
        clock.advance(300); coordinator.tick(idleSeconds: 300)   // gated: .paused → no-op
        clock.advance(60); coordinator.tick(idleSeconds: 1)      // gated: no resume prompt

        XCTAssertNil(resolver(), "no away prompt is presented while a manual session is paused")
        XCTAssertTrue(tracker.isPaused, "the paused session is not clobbered by an auto entry")
        XCTAssertEqual(spy.entries.count, countAfterPause,
                       "no auto-stop, bridge, or IdleEvent while paused")
    }
}
