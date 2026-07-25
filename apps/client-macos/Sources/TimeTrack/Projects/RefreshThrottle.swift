import Foundation

/// Rate-limits an on-demand refresh (e.g. re-fetching the project list when the menu opens) so
/// frequent triggers don't hammer the API. `shouldRefresh()` returns true at most once per
/// `minInterval`, recording the moment it allows. `clock` is injected for deterministic tests.
/// Main-thread only (the menu-open hook and the caller both run on the main thread).
final class RefreshThrottle {
    private let minInterval: TimeInterval
    private let clock: () -> Date
    private var last: Date?

    init(minInterval: TimeInterval, clock: @escaping () -> Date = Date.init) {
        self.minInterval = minInterval
        self.clock = clock
    }

    /// True if at least `minInterval` has elapsed since the last allowed refresh (records now and
    /// allows); false to skip. The first call always allows.
    func shouldRefresh() -> Bool {
        let now = clock()
        if let last, now.timeIntervalSince(last) < minInterval { return false }
        last = now
        return true
    }
}
