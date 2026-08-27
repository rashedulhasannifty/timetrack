import XCTest
@testable import TimeTrack

/// Manual tracking used to run THROUGH an away window and let the employee adjudicate it on
/// return. These tests pin the replacement: inactivity times the session out, and the entry ends
/// at a point derived from the threshold rather than from whenever the poller noticed.
final class ManualIdleMonitorTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func make(threshold: Int = 300)
        -> (ManualIdleMonitor, FakeManualIdleMonitorDelegate, MutableClock) {
        let clock = MutableClock(t0)
        let monitor = ManualIdleMonitor(thresholdSeconds: threshold, clock: clock.read)
        let delegate = FakeManualIdleMonitorDelegate()
        monitor.delegate = delegate
        return (monitor, delegate, clock)
    }

    func testActivateArmsWithoutTouchingTheTimer() {
        let (monitor, delegate, _) = make()
        monitor.activate()
        XCTAssertEqual(monitor.state, .active)
        XCTAssertTrue(delegate.calls.isEmpty, "arming is not a tracking decision")
    }

    func testSubThresholdTickDoesNothing() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(299); monitor.tick(idleSeconds: 299)
        XCTAssertEqual(monitor.state, .active)
        XCTAssertTrue(delegate.calls.isEmpty)
    }

    func testCrossingTheThresholdTimesOutAndKeepsTheIdleMinutes() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        // Input stopped at t0; the entry ends 300s later — those idle minutes stay on the
        // timesheet (the admin's chosen threshold is what the team is willing to credit).
        XCTAssertEqual(delegate.calls, [.timedOut(from: t0, stoppingAt: t0.addingTimeInterval(300))])
    }

    // The poller runs on its own cadence, so a reading can overshoot the threshold. The entry's
    // end must not drift with it: two Macs on the same policy end the same span at the same place.
    func testTheStopInstantComesFromTheThresholdNotTheTickThatNoticed() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(475); monitor.tick(idleSeconds: 475)   // noticed 175s late
        XCTAssertEqual(delegate.calls, [.timedOut(from: t0, stoppingAt: t0.addingTimeInterval(300))])
    }

    // A closed lid is not a long read: the moment input stopped is known exactly, so no idle
    // minutes are credited that provably did not happen.
    func testSleepOrLockStopsWhereTheInputDid() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(60); monitor.markAway()
        let at = t0.addingTimeInterval(60)
        XCTAssertEqual(delegate.calls, [.timedOut(from: at, stoppingAt: at)])
    }

    // Disarming as it fires is what stops a still-idle Mac from re-closing an entry that the
    // timeout already closed — and what lets the coordinator re-arm on the next manual session.
    func testTimingOutDisarmsTheMonitor() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        XCTAssertEqual(monitor.state, .inactive)

        clock.advance(300); monitor.tick(idleSeconds: 600)
        monitor.markAway()
        XCTAssertEqual(delegate.calls.count, 1, "a disarmed monitor decides nothing")
    }

    // The OS idle counter does not reset when someone presses Stop and starts something else.
    // Without clamping to the arming instant, that inherited reading closes the new span the
    // moment it opens — a policy stop for inactivity that belongs to the previous session.
    func testIdlenessInheritedFromBeforeTheSessionDoesNotCount() {
        let (monitor, delegate, clock) = make(threshold: 300)
        clock.advance(900)                                   // 15 min idle before this session
        monitor.activate()                                   // armed at t0+900
        monitor.tick(idleSeconds: 900)
        XCTAssertTrue(delegate.calls.isEmpty, "the new session has been idle for 0s, not 900s")
        XCTAssertEqual(monitor.state, .active)

        // It times out on its OWN inactivity, measured from arming.
        clock.advance(300); monitor.tick(idleSeconds: 1200)
        XCTAssertEqual(delegate.calls,
                       [.timedOut(from: t0.addingTimeInterval(900),
                                  stoppingAt: t0.addingTimeInterval(1200))])
    }

    func testDeactivateReportsNothing() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(120)
        monitor.deactivate()
        XCTAssertEqual(monitor.state, .inactive)
        XCTAssertTrue(delegate.calls.isEmpty, "nothing is ever left pending to abandon")
    }
}
