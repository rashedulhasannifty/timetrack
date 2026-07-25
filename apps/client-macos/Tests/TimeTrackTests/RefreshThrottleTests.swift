import XCTest
@testable import TimeTrack

final class RefreshThrottleTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    func testFirstCallAlwaysAllows() {
        let throttle = RefreshThrottle(minInterval: 60, clock: { self.t0 })
        XCTAssertTrue(throttle.shouldRefresh())
    }

    func testSuppressesWithinInterval() {
        let clock = MutableClock(t0)
        let throttle = RefreshThrottle(minInterval: 60, clock: clock.read)
        XCTAssertTrue(throttle.shouldRefresh())
        clock.advance(59)
        XCTAssertFalse(throttle.shouldRefresh(), "second call inside the window is suppressed")
    }

    func testAllowsAgainAfterInterval() {
        let clock = MutableClock(t0)
        let throttle = RefreshThrottle(minInterval: 60, clock: clock.read)
        XCTAssertTrue(throttle.shouldRefresh())
        clock.advance(60)
        XCTAssertTrue(throttle.shouldRefresh(), "at/after the interval it allows again")
        clock.advance(10)
        XCTAssertFalse(throttle.shouldRefresh(), "and re-arms from the last allowed moment")
    }
}
