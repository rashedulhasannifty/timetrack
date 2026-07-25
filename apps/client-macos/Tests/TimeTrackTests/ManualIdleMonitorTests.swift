// ManualIdleMonitorTests.swift
import XCTest
@testable import TimeTrack

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

    func testActivateDoesNotStartTracking() {
        let (monitor, delegate, _) = make()
        monitor.activate()
        XCTAssertEqual(monitor.state, .active)
        XCTAssertTrue(delegate.calls.isEmpty, "manual activate has no start-tracking side effect")
    }

    func testThresholdCrossingBeginsAwayWithoutStopping() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(305); monitor.tick(idleSeconds: 305)   // awayStart = (t0+305) - 305 = t0
        XCTAssertEqual(monitor.state, .away(since: t0))
        XCTAssertEqual(delegate.calls, [.beganAway(at: t0)], "no stop decision, only beganAway")
    }

    func testSubThresholdTickStaysActive() {
        let (monitor, delegate, _) = make(threshold: 300)
        monitor.activate()
        monitor.tick(idleSeconds: 120)
        XCTAssertEqual(monitor.state, .active)
        XCTAssertTrue(delegate.calls.isEmpty)
    }

    func testResumePromptsWithAwaySeconds() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)   // away since t0
        clock.advance(120); monitor.tick(idleSeconds: 5)     // resume at t0+420
        XCTAssertEqual(monitor.state, .awaiting(since: t0, until: t0.addingTimeInterval(420)))
        XCTAssertEqual(delegate.calls.last, .becameAway(seconds: 420))
    }

    func testResolveKeepReturnsActiveWithoutRestart() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        clock.advance(120); monitor.tick(idleSeconds: 5)
        monitor.resolve(.keep)
        XCTAssertEqual(monitor.state, .active)
        XCTAssertEqual(delegate.calls.last, .resolved(from: t0, to: t0.addingTimeInterval(420), keeping: true))
    }

    func testResolveDiscardCarriesKeepingFalse() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        clock.advance(120); monitor.tick(idleSeconds: 5)
        monitor.resolve(.discard)
        XCTAssertEqual(monitor.state, .active)
        XCTAssertEqual(delegate.calls.last, .resolved(from: t0, to: t0.addingTimeInterval(420), keeping: false))
    }

    func testMarkAwayMirrorsThresholdPath() {
        let (monitor, delegate, _) = make()
        monitor.activate()
        monitor.markAway()                                    // awayStart = now = t0
        XCTAssertEqual(monitor.state, .away(since: t0))
        XCTAssertEqual(delegate.calls, [.beganAway(at: t0)])
    }

    func testDeactivateWhileAwayAbandons() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)    // away since t0
        clock.advance(60)                                     // now t0+360
        monitor.deactivate()
        XCTAssertEqual(monitor.state, .inactive)
        XCTAssertEqual(delegate.calls.last, .abandoned(from: t0, to: t0.addingTimeInterval(360)))
    }

    func testDeactivateWhileAwaitingAbandonsToResumeInstant() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)    // away since t0
        clock.advance(120); monitor.tick(idleSeconds: 5)      // awaiting, resume at t0+420
        monitor.deactivate()
        XCTAssertEqual(monitor.state, .inactive)
        XCTAssertEqual(delegate.calls.last, .abandoned(from: t0, to: t0.addingTimeInterval(420)))
    }
}
