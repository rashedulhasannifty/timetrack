import XCTest
@testable import TimeTrack

/// The auto-mode use of `ManualNudgeMonitor`: same presence decision, but the reminder is a
/// visible window (auto-tracking failing to start is a fault, not a gentle hint) and the
/// manual-idle branch is off — auto mode has `IdleMonitor` for that.
final class ForgotToStartPresenterTests: XCTestCase {
    private func date(_ t: TimeInterval) -> Date { Date(timeIntervalSince1970: t) }

    private final class PresenterSpy {
        private(set) var shown: [(title: String, body: String)] = []
        func present(title: String, body: String) { shown.append((title, body)) }
    }

    // With a presenter set, the reminder must go to the WINDOW and not silently through the
    // notifier — the whole point on a build macOS never authorized for notifications.
    func testForgotToStartGoesToThePresenterInsteadOfTheNotifier() {
        let spy = SpyNotifier()
        let presenter = PresenterSpy()
        let m = ManualNudgeMonitor(
            notifier: spy, idleThresholdSeconds: 300, forgotToStartSeconds: 600,
            isTracking: { false }, isPaused: { false },
            presentForgotToStart: { presenter.present(title: $0, body: $1) })

        m.tick(idleSeconds: 5, now: date(0))
        m.tick(idleSeconds: 5, now: date(600))

        XCTAssertEqual(presenter.shown.count, 1)
        XCTAssertTrue(spy.posted.isEmpty, "the window replaces the notification, never both")
    }

    // Auto mode already nudges on idle from IdleMonitor (`idle-nudge`). This poller must not
    // post a second, competing "still tracking?" for the same idle stretch.
    func testManualIdleNudgeIsSuppressedInAutoMode() {
        let spy = SpyNotifier()
        let m = ManualNudgeMonitor(
            notifier: spy, idleThresholdSeconds: 300, forgotToStartSeconds: 600,
            isTracking: { true }, isPaused: { false },
            emitsManualIdleNudge: false)

        m.tick(idleSeconds: 900, now: date(0))

        XCTAssertTrue(spy.posted.isEmpty)
    }

    // A user who returns from away sees the keep/discard prompt while NOT tracking. Leaving it
    // unanswered must not stack a second "start tracking?" window on top of it.
    func testNoReminderWhileAnAwayPromptIsPending() {
        let spy = SpyNotifier()
        let presenter = PresenterSpy()
        let m = ManualNudgeMonitor(
            notifier: spy, idleThresholdSeconds: 300, forgotToStartSeconds: 600,
            isTracking: { false }, isPaused: { false },
            presentForgotToStart: { presenter.present(title: $0, body: $1) },
            isAwaitingResolution: { true })

        m.tick(idleSeconds: 5, now: date(0))
        m.tick(idleSeconds: 5, now: date(600))

        XCTAssertTrue(presenter.shown.isEmpty)
        XCTAssertTrue(spy.posted.isEmpty)
    }

    // The default construction (manual mode) is untouched: still a notification, still fires.
    func testManualModeStillPostsANotification() {
        let spy = SpyNotifier()
        let m = ManualNudgeMonitor(
            notifier: spy, idleThresholdSeconds: 300, forgotToStartSeconds: 600,
            isTracking: { false }, isPaused: { false })

        m.tick(idleSeconds: 5, now: date(0))
        m.tick(idleSeconds: 5, now: date(600))

        XCTAssertEqual(spy.posted.map(\.id), ["forgot-to-start"])
    }
}
