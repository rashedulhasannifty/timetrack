import Foundation

/// The retry schedule for launch-time policy resolution.
///
/// `proceedToPolicy()` used to run exactly once per launch. A menu bar app registered as a login
/// item starts while the network is still coming up, so the very first `effectivePolicy()` fetch
/// is the one most likely to fail — and its `catch` granted MANUAL tracking and stopped there.
/// In auto mode that left a client that looked completely normal (signed in, ready, indicator
/// idle) and never started tracking for the rest of the session. This type is the schedule that
/// makes that state recoverable.
///
/// Pure and deterministic: no timers, no clock, no network. `AppDelegate` owns the timer and asks
/// this what to do next, exactly as `SyncEngine` does with `BackoffPolicy` (which this reuses
/// rather than growing a second backoff).
///
/// NOT a capture path — it decides when to re-ask for the policy, and touches no hardware API.
final class PolicyResolutionRetry {
    enum Outcome: Equatable {
        /// Capture is installed (or was torn down); the loop is over.
        case stop
        /// Try again after `after` seconds. `warnUser` is true on exactly ONE outcome per
        /// schedule — the point where silence has gone on long enough to be worth surfacing.
        case retry(after: TimeInterval, warnUser: Bool)
    }

    private let backoff: BackoffPolicy
    private let warnAfterFailures: Int
    private var failures = 0
    private var hasWarned = false
    private(set) var isResolved = false

    init(backoff: BackoffPolicy = BackoffPolicy(base: 30, maxDelay: 300),
         warnAfterFailures: Int = 3) {
        self.backoff = backoff
        self.warnAfterFailures = warnAfterFailures
    }

    /// One failed resolution attempt. Returns what the caller should do next.
    func recordFailure() -> Outcome {
        guard !isResolved else { return .stop }
        failures += 1
        let warn = !hasWarned && failures >= warnAfterFailures
        if warn { hasWarned = true }
        return .retry(after: backoff.nextDelay(), warnUser: warn)
    }

    /// Capture installed — stop retrying. Idempotent; called from both install paths.
    func markResolved() { isResolved = true }

    /// Sign-out teardown. The next user on this Mac gets their own schedule and their own single
    /// warning rather than inheriting an exhausted one-shot (the cross-user teardown class that
    /// has already bitten the away and recovery prompts).
    func reset() {
        isResolved = false
        failures = 0
        hasWarned = false
        backoff.reset()
    }
}
