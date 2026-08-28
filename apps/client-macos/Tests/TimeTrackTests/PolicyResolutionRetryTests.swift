import XCTest
@testable import TimeTrack

final class PolicyResolutionRetryTests: XCTestCase {
    private func make(warnAfter: Int = 3) -> PolicyResolutionRetry {
        PolicyResolutionRetry(backoff: BackoffPolicy(base: 30, maxDelay: 300),
                              warnAfterFailures: warnAfter)
    }

    // The launch case: the policy fetch failed once (network not up yet at login) → try again
    // soon, and say nothing to the employee about a blip that is about to resolve itself.
    func testFirstFailureSchedulesARetryWithoutWarning() {
        let retry = make()

        XCTAssertEqual(retry.recordFailure(), .retry(after: 30, warnUser: false))
    }

    // Backoff doubles and caps, so a Mac that stays offline all morning is not retrying every 30s.
    func testDelayDoublesAndCapsAtMax() {
        let retry = make(warnAfter: .max)   // warnings out of the way; this is about the schedule
        let delays = (0..<6).map { _ -> TimeInterval in
            guard case let .retry(after, _) = retry.recordFailure() else { return -1 }
            return after
        }

        XCTAssertEqual(delays, [30, 60, 120, 240, 300, 300])
    }

    // After `warnAfterFailures` consecutive failures the employee is told — ONCE. Without the
    // one-shot the reminder window would re-present on every retry, forever.
    func testWarnsExactlyOnceOnceTheFailureThresholdIsReached() {
        let retry = make(warnAfter: 3)
        let warnings = (0..<5).map { _ -> Bool in
            guard case let .retry(_, warnUser) = retry.recordFailure() else { return false }
            return warnUser
        }

        XCTAssertEqual(warnings, [false, false, true, false, false])
    }

    // Capture installed → the retry loop must stop dead, or it keeps hammering the policy
    // endpoint against the API's global throttler for the rest of the session.
    func testStopsRetryingOnceResolved() {
        let retry = make()
        _ = retry.recordFailure()
        retry.markResolved()

        XCTAssertEqual(retry.recordFailure(), .stop)
        XCTAssertTrue(retry.isResolved)
    }

    // Sign-out: the next user on this Mac gets their own fresh schedule and their own single
    // warning, never the outgoing user's exhausted one-shot (the cross-user teardown class).
    func testResetRearmsTheScheduleAndTheWarning() {
        let retry = make(warnAfter: 1)
        _ = retry.recordFailure()          // warns; delay advances
        retry.markResolved()

        retry.reset()

        XCTAssertFalse(retry.isResolved)
        XCTAssertEqual(retry.recordFailure(), .retry(after: 30, warnUser: true))
    }
}
