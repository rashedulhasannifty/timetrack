import XCTest
@testable import TimeTrack

final class ManualNudgeMonitorTests: XCTestCase {
    private func date(_ t: TimeInterval) -> Date { Date(timeIntervalSince1970: t) }

    private func make(spy: SpyNotifier,
                      tracking: @escaping () -> Bool = { false },
                      paused: @escaping () -> Bool = { false }) -> ManualNudgeMonitor {
        ManualNudgeMonitor(notifier: spy, idleThresholdSeconds: 300, forgotToStartSeconds: 600,
                           isTracking: tracking, isPaused: paused)
    }

    // Forgot-to-start: present + not tracking for >= 600s → one nudge, then one-shot.
    func testForgotToStartFiresOnceAfterContinuousPresence() {
        let spy = SpyNotifier()
        let m = make(spy: spy)                       // not tracking, not paused
        m.tick(idleSeconds: 5, now: date(0))         // active stretch begins
        m.tick(idleSeconds: 5, now: date(300))       // still present, < 600s → nothing
        m.tick(idleSeconds: 5, now: date(600))       // 600s present → fire
        m.tick(idleSeconds: 5, now: date(900))       // one-shot → no second nudge

        XCTAssertEqual(spy.posted.map(\.id), ["forgot-to-start"])
        XCTAssertEqual(spy.posted.first?.body, "You've been active 10 min without tracking — start?")
    }

    // Going idle resets the stretch AND the one-shot, so a later presence can nudge again.
    func testForgotToStartResetsWhenUserGoesIdle() {
        let spy = SpyNotifier()
        let m = make(spy: spy)
        m.tick(idleSeconds: 5, now: date(0))
        m.tick(idleSeconds: 5, now: date(600))       // fire #1
        m.tick(idleSeconds: 400, now: date(650))     // away (>=300) → reset
        m.tick(idleSeconds: 5, now: date(700))       // new stretch
        m.tick(idleSeconds: 5, now: date(1300))      // 600s later → fire #2

        XCTAssertEqual(spy.posted.map(\.id), ["forgot-to-start", "forgot-to-start"])
    }

    // Not fired while a manual clock is running.
    func testForgotToStartNeverFiresWhileTracking() {
        let spy = SpyNotifier()
        let m = make(spy: spy, tracking: { true })
        m.tick(idleSeconds: 5, now: date(0))
        m.tick(idleSeconds: 5, now: date(1000))
        XCTAssertTrue(spy.posted.filter { $0.id == "forgot-to-start" }.isEmpty)
    }

    // Manual idle: tracking + idle >= threshold → one "still tracking?" nudge, one-shot.
    func testManualIdleFiresOnceWhileTracking() {
        let spy = SpyNotifier()
        let m = make(spy: spy, tracking: { true })
        m.tick(idleSeconds: 60, now: date(0))        // active → nothing
        m.tick(idleSeconds: 300, now: date(300))     // idle at threshold → fire
        m.tick(idleSeconds: 600, now: date(600))     // one-shot → no second nudge

        XCTAssertEqual(spy.posted.map(\.id), ["manual-idle"])
        XCTAssertEqual(spy.posted.first?.body, "Idle for 5 min — still tracking?")
    }

    // Becoming active again re-arms the manual-idle one-shot.
    func testManualIdleResetsWhenActiveAgain() {
        let spy = SpyNotifier()
        let m = make(spy: spy, tracking: { true })
        m.tick(idleSeconds: 300, now: date(0))       // fire #1
        m.tick(idleSeconds: 10, now: date(60))       // active → re-arm
        m.tick(idleSeconds: 300, now: date(360))     // fire #2
        XCTAssertEqual(spy.posted.map(\.id), ["manual-idle", "manual-idle"])
    }

    // Paused manual session: no nudges of either kind.
    func testPausedFiresNothing() {
        let spy = SpyNotifier()
        let m = make(spy: spy, tracking: { false }, paused: { true })
        m.tick(idleSeconds: 5, now: date(0))
        m.tick(idleSeconds: 5, now: date(1000))
        m.tick(idleSeconds: 400, now: date(1400))
        XCTAssertTrue(spy.posted.isEmpty)
    }
}
