import XCTest
@testable import TimeTrack

/// Manual tracking's away/awaiting cycle, restored: the timer keeps running through an away
/// window and the employee adjudicates it with keep/discard on return — UNLESS the away window
/// runs past `awayLimitSeconds` (60 min) with no return, in which case it is closed by policy
/// at `awayStart` instead of being left open indefinitely. See `ManualIdleMonitor`.
final class ManualIdleMonitorTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func make(threshold: Int = 300, awayLimit: Int = 3600)
        -> (ManualIdleMonitor, FakeManualIdleMonitorDelegate, MutableClock) {
        let clock = MutableClock(t0)
        let monitor = ManualIdleMonitor(thresholdSeconds: threshold, awayLimitSeconds: awayLimit, clock: clock.read)
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

    func testResumeWithinTheLimitPromptsWithAwaySeconds() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)   // away since t0
        clock.advance(120); monitor.tick(idleSeconds: 5)     // resume at t0+420 (well under 60 min)
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

    // MARK: - The 60-minute away limit

    // Away the whole time, no return: the tick that notices the limit reached closes the door
    // itself rather than waiting for someone to come back and be asked.
    func testStillAwayPastTheLimitExceedsWithoutAReturn() {
        let (monitor, delegate, clock) = make(threshold: 300, awayLimit: 3600)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)    // away since t0
        clock.advance(3300); monitor.tick(idleSeconds: 3600)  // still idle, now t0+3600 (== limit)
        XCTAssertEqual(monitor.state, .inactive, "the limit disarms the monitor, like a timeout")
        XCTAssertEqual(delegate.calls.last, .exceededLimit(from: t0, at: t0.addingTimeInterval(3600)))
    }

    // Return at 59 minutes: still within the limit, so the ordinary prompt — not the limit path.
    func testReturnAt59MinutesPrompts() {
        let (monitor, delegate, clock) = make(threshold: 300, awayLimit: 3600)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)    // away since t0
        clock.advance(3240); monitor.tick(idleSeconds: 5)     // resume at t0 + 59min
        XCTAssertEqual(monitor.state, .awaiting(since: t0, until: t0.addingTimeInterval(3540)))
        XCTAssertEqual(delegate.calls.last, .becameAway(seconds: 3540))
    }

    // Return at 61 minutes: past the limit — the limit path, not the prompt.
    func testReturnAt61MinutesExceedsTheLimitInstead() {
        let (monitor, delegate, clock) = make(threshold: 300, awayLimit: 3600)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)    // away since t0
        clock.advance(3360); monitor.tick(idleSeconds: 5)     // resume at t0 + 61min
        XCTAssertEqual(monitor.state, .inactive)
        XCTAssertEqual(delegate.calls.last, .exceededLimit(from: t0, at: t0.addingTimeInterval(3600)),
                       "limitInstant is awayStart + the limit, not the return instant")
    }

    // The limit outlasts a sleep entirely: no tick fires while asleep, so `resume()` (wake) is
    // where "exceeded while asleep" is discovered — it must resolve via the limit, not the prompt.
    func testLimitExceededDuringSleepResolvesOnWakeViaTheLimitPath() {
        let (monitor, delegate, clock) = make(threshold: 300, awayLimit: 3600)
        monitor.activate()
        monitor.markAway()                                    // away since t0 (sleep/lock)
        clock.advance(7200)                                    // asleep for 2 hours; no ticks fire
        monitor.resume()                                       // wake
        XCTAssertEqual(monitor.state, .inactive)
        XCTAssertEqual(delegate.calls.last, .exceededLimit(from: t0, at: t0.addingTimeInterval(3600)))
    }

    // A return comfortably inside the limit, after a sleep, still gets the ordinary prompt.
    func testShortSleepThenWakeWithinTheLimitPrompts() {
        let (monitor, delegate, clock) = make(threshold: 300, awayLimit: 3600)
        monitor.activate()
        monitor.markAway()                                    // away since t0
        clock.advance(600)                                     // asleep for 10 minutes
        monitor.resume()
        XCTAssertEqual(monitor.state, .awaiting(since: t0, until: t0.addingTimeInterval(600)))
        XCTAssertEqual(delegate.calls.last, .becameAway(seconds: 600))
    }

    // MARK: Going away again while the prompt is still open

    /// Someone comes back, ignores the prompt, and leaves for the night. The open prompt must not
    /// switch idle detection off: going idle again resolves it as Discard (its default) and the
    /// second absence starts its own away window from the moment input stopped.
    func testGoingIdleAgainWhileThePromptIsOpenDiscardsItAndBeginsASecondAway() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)     // away since t0
        clock.advance(120); monitor.tick(idleSeconds: 5)       // back at t0+420 → prompt
        clock.advance(400); monitor.tick(idleSeconds: 305)     // left again at t0+515

        let secondStart = t0.addingTimeInterval(515)
        XCTAssertEqual(monitor.state, .away(since: secondStart))
        XCTAssertEqual(Array(delegate.calls.suffix(3)), [
            .withdrewPrompt,
            .resolved(from: t0, to: t0.addingTimeInterval(420), keeping: false),
            .beganAway(at: secondStart),
        ], "the prompt's own default on close is ignored — one discard, not a keep")
    }

    func testTheSecondAbsenceIsBoundedByTheLimitLikeAnyOther() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        clock.advance(120); monitor.tick(idleSeconds: 5)       // prompt
        clock.advance(400); monitor.tick(idleSeconds: 305)     // second away since t0+515
        clock.advance(3600); monitor.tick(idleSeconds: 3905)   // overnight

        let secondStart = t0.addingTimeInterval(515)
        XCTAssertEqual(delegate.calls.last, .exceededLimit(from: secondStart, at: secondStart.addingTimeInterval(3600)))
        XCTAssertEqual(monitor.state, .inactive)
    }

    func testLockingWhileThePromptIsOpenDiscardsItAndBeginsAwayNow() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        clock.advance(120); monitor.tick(idleSeconds: 5)       // prompt at t0+420
        clock.advance(60); monitor.markAway()                  // lock at t0+480

        let lockedAt = t0.addingTimeInterval(480)
        XCTAssertEqual(monitor.state, .away(since: lockedAt))
        XCTAssertEqual(Array(delegate.calls.suffix(3)), [
            .withdrewPrompt,
            .resolved(from: t0, to: t0.addingTimeInterval(420), keeping: false),
            .beganAway(at: lockedAt),
        ])
    }

    /// The second absence never reaches back before the return that opened the prompt.
    func testTheSecondAwayStartIsClampedToTheReturn() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        clock.advance(120); monitor.tick(idleSeconds: 5)       // back at t0+420
        clock.advance(300); monitor.tick(idleSeconds: 900)     // a reading older than the return

        XCTAssertEqual(delegate.calls.last, .beganAway(at: t0.addingTimeInterval(420)))
    }

    func testAnOpenPromptIsLeftAloneWhileThePersonIsActive() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        clock.advance(120); monitor.tick(idleSeconds: 5)       // prompt
        let before = delegate.calls
        clock.advance(600); monitor.tick(idleSeconds: 30)      // working, not answering

        XCTAssertEqual(delegate.calls, before)
        XCTAssertEqual(monitor.state, .awaiting(since: t0, until: t0.addingTimeInterval(420)))
    }
}
