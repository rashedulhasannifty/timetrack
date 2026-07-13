import XCTest
@testable import TimeTrack

final class IdleMonitorTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ start: Date) { now = start }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func make(threshold: Int = 300)
        -> (IdleMonitor, FakeIdleMonitorDelegate, MutableClock) {
        let clock = MutableClock(t0)
        let monitor = IdleMonitor(thresholdSeconds: threshold, clock: clock.read)
        let delegate = FakeIdleMonitorDelegate()
        monitor.delegate = delegate
        return (monitor, delegate, clock)
    }

    func testActivateStartsTracking() {
        let (monitor, delegate, _) = make()
        monitor.activate()
        XCTAssertEqual(delegate.calls, [.start])
        XCTAssertEqual(monitor.state, .active)
    }

    func testIdleThresholdStopsAtAwayStart() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(305)                        // 305s of no input
        monitor.tick(idleSeconds: 305)
        // awayStart = now(t0+305) - 305 = t0
        XCTAssertEqual(delegate.calls, [.start, .stop(at: t0)])
        XCTAssertEqual(monitor.state, .away(since: t0))
    }

    func testSubThresholdTickDoesNotStop() {
        let (monitor, delegate, _) = make(threshold: 300)
        monitor.activate()
        monitor.tick(idleSeconds: 120)
        XCTAssertEqual(delegate.calls, [.start], "no stop below threshold")
        XCTAssertEqual(monitor.state, .active)
    }

    func testResumeAfterIdlePromptsThenKeepBridgesAndRestarts() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)   // away since t0
        clock.advance(120); monitor.tick(idleSeconds: 5)      // input again → resume at t0+420
        XCTAssertEqual(monitor.state, .awaiting(since: t0, until: t0.addingTimeInterval(420)))
        XCTAssertEqual(delegate.calls.last, .becameAway(seconds: 420))

        monitor.resolve(.keep)
        XCTAssertEqual(delegate.calls.suffix(2), [
            .resolved(from: t0, to: t0.addingTimeInterval(420), keeping: true),
            .start,
        ])
        XCTAssertEqual(monitor.state, .active)
    }

    func testResumeThenDiscardDoesNotBridgeAndRestarts() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        clock.advance(60); monitor.tick(idleSeconds: 1)
        monitor.resolve(.discard)
        XCTAssertEqual(delegate.calls.suffix(2), [
            .resolved(from: t0, to: t0.addingTimeInterval(360), keeping: false),
            .start,
        ])
    }

    func testSleepStopsImmediatelyAtNow() {
        let (monitor, delegate, clock) = make()
        monitor.activate()
        clock.advance(30)
        monitor.markAway()                        // sleep/lock: away starts now, not after threshold
        XCTAssertEqual(delegate.calls, [.start, .stop(at: t0.addingTimeInterval(30))])
        XCTAssertEqual(monitor.state, .away(since: t0.addingTimeInterval(30)))
    }

    func testDeactivateWhileAwayEmitsUnresolved() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)     // away since t0
        clock.advance(90)
        monitor.deactivate()                                    // e.g. sign-out mid-away
        XCTAssertEqual(delegate.calls.last, .abandoned(from: t0, to: t0.addingTimeInterval(390)))
        XCTAssertEqual(monitor.state, .inactive)
    }
}
