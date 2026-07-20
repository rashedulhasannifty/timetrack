import XCTest
@testable import TimeTrack

final class DistractionMonitorTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func run(_ monitor: DistractionMonitor, _ categories: [TimeTrack.Category]) {
        for c in categories { monitor.tick(category: c, now: t0) }
    }

    func testFiresExactlyOnceAtThreshold() {
        let spy = SpyNotifier()
        let monitor = DistractionMonitor(notifier: spy, threshold: 10)
        run(monitor, Array(repeating: .unproductive, count: 9))
        XCTAssertEqual(spy.posted.count, 0)            // 9 < threshold
        monitor.tick(category: .unproductive, now: t0) // 10th
        XCTAssertEqual(spy.posted.count, 1)
        XCTAssertEqual(spy.posted.first?.id, "distraction")
    }

    func testProductiveSampleResetsStreak() {
        let spy = SpyNotifier()
        let monitor = DistractionMonitor(notifier: spy, threshold: 10)
        run(monitor, Array(repeating: .unproductive, count: 9))
        monitor.tick(category: .productive, now: t0)   // breaks the streak
        run(monitor, Array(repeating: .unproductive, count: 9))
        XCTAssertEqual(spy.posted.count, 0)            // never reached 10 consecutive
    }

    func testNeutralSampleResetsStreak() {
        let spy = SpyNotifier()
        let monitor = DistractionMonitor(notifier: spy, threshold: 10)
        run(monitor, Array(repeating: .unproductive, count: 9))
        monitor.tick(category: .neutral, now: t0)      // neutral also breaks the streak
        run(monitor, Array(repeating: .unproductive, count: 9))
        XCTAssertEqual(spy.posted.count, 0)
    }

    func testFiresOncePerStreakNoRepeat() {
        let spy = SpyNotifier()
        let monitor = DistractionMonitor(notifier: spy, threshold: 10)
        run(monitor, Array(repeating: .unproductive, count: 15))
        XCTAssertEqual(spy.posted.count, 1)            // one nudge, not six
    }

    func testReArmsAfterStreakBreaks() {
        let spy = SpyNotifier()
        let monitor = DistractionMonitor(notifier: spy, threshold: 10)
        run(monitor, Array(repeating: .unproductive, count: 10)) // fire #1
        monitor.tick(category: .productive, now: t0)             // break + re-arm
        run(monitor, Array(repeating: .unproductive, count: 10)) // fire #2
        XCTAssertEqual(spy.posted.count, 2)
    }

    func testStopResetsState() {
        let spy = SpyNotifier()
        let monitor = DistractionMonitor(notifier: spy, threshold: 10)
        run(monitor, Array(repeating: .unproductive, count: 9))
        monitor.stop()                                           // clears streak + fired
        run(monitor, Array(repeating: .unproductive, count: 9))
        XCTAssertEqual(spy.posted.count, 0)                      // rebuilt from zero, still < 10
    }
}
