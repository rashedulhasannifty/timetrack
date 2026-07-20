import Foundation

/// Slice 3.4 — the local distraction nudge (PRD §6.4: trust, not surveillance). A pure,
/// timer-free decision unit fed one `Category` per activity sample (~60s) from `ActivitySampler`
/// via its `onCategorized` hook. It counts CONSECUTIVE `UNPRODUCTIVE` samples and, when the streak
/// reaches `threshold`, posts ONE local notification. Any non-unproductive sample (PRODUCTIVE or
/// NEUTRAL) breaks the streak and re-arms. Fires exactly once per streak — no repeat until the
/// streak breaks and a fresh one rebuilds. NOTIFY-ONLY: no network, no disk, no logging; it sees
/// only a `Category` enum value, never an app name/host/title/key content (CLAUDE.md §1).
///
/// `threshold` is a count of consecutive unproductive samples; with the sampler's 60s window it is
/// a count of minutes (the 60s-cadence coupling is documented at the `AppDelegate` construction
/// site). `now` is currently unused (the streak is count-based) but kept in the signature to match
/// `ManualNudgeMonitor.tick(...:now:)` and leave room for a future time-based streak.
final class DistractionMonitor {
    private let notifier: LocalNotifying
    private let threshold: Int
    private var unproductiveStreak = 0
    private var firedThisStreak = false

    init(notifier: LocalNotifying, threshold: Int) {
        self.notifier = notifier
        self.threshold = max(1, threshold)
    }

    func tick(category: Category, now: Date) {
        guard category == .unproductive else {
            unproductiveStreak = 0
            firedThisStreak = false
            return
        }
        unproductiveStreak += 1
        if unproductiveStreak >= threshold, !firedThisStreak {
            notifier.notify(id: "distraction", title: "Time tracking",
                            body: "~\(threshold) min on distracting apps — refocus?")
            firedThisStreak = true
        }
    }

    /// Sign-out teardown — clear streak + fired so a prior user's state never bleeds into the next
    /// sign-in (same cross-user integrity class as the 2.4 nudge teardown).
    func stop() {
        unproductiveStreak = 0
        firedThisStreak = false
    }
}
