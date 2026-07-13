import Foundation

/// PRD §7.5 — exponential backoff for the sync retry loop. Pure and deterministic: no timers, no
/// clock. `nextDelay()` returns base·2^failures capped at `maxDelay`, transformed by an injected
/// `jitter` (identity by default; a real deployment adds bounded randomness), and advances the
/// failure count. `reset()` (called on a successful upload) returns to the base. SyncEngine owns
/// the timer and decides when to call these.
final class BackoffPolicy {
    private let base: TimeInterval
    private let maxDelay: TimeInterval
    private let jitter: (TimeInterval) -> TimeInterval
    private(set) var failureCount = 0

    init(base: TimeInterval = 5, maxDelay: TimeInterval = 300,
         jitter: @escaping (TimeInterval) -> TimeInterval = { $0 }) {
        self.base = base
        self.maxDelay = maxDelay
        self.jitter = jitter
    }

    /// The delay before the next attempt; advances the failure count.
    func nextDelay() -> TimeInterval {
        let raw = min(maxDelay, base * pow(2, Double(failureCount)))
        failureCount += 1
        return jitter(raw)
    }

    func reset() { failureCount = 0 }
}
