import Foundation

/// Slice 3.4 — the local distraction nudge (PRD §6.4: trust, not surveillance). A pure,
/// timer-free decision unit fed one `Category` per activity sample (~60s) from `ActivitySampler`
/// via its `onCategorized` hook. It counts CONSECUTIVE `UNPRODUCTIVE` samples and, when the streak
/// reaches `threshold`, posts a local notification. Any non-unproductive sample (PRODUCTIVE or
/// NEUTRAL) breaks the streak and re-arms. NOTIFY-ONLY: no network, no disk, no logging; it sees
/// only a `Category` enum value, never an app name/host/title/key content (CLAUDE.md §1).
///
/// `repeatEvery` controls whether an unbroken streak keeps reminding: `0` fires exactly once per
/// streak (the original behaviour); `N > 0` re-nudges every N further samples while the streak
/// continues (e.g. threshold 10, repeat 5 → nudges at 10, 15, 20 …). The repeat is deliberately a
/// gentle recurring reminder, never a modal block — the fallback window is non-modal and
/// dismissible (CLAUDE.md §1: transparency, not coercion).
///
/// `threshold`/`repeatEvery` are counts of consecutive unproductive samples; with the sampler's
/// 60s window they are counts of minutes (the 60s-cadence coupling is documented at the
/// `AppDelegate` construction site). `now` is currently unused (the streak is count-based) but kept
/// in the signature to match `ManualNudgeMonitor.tick(...:now:)`.
final class DistractionMonitor {
    private let notifier: LocalNotifying
    private let threshold: Int
    private let repeatEvery: Int
    private var unproductiveStreak = 0
    /// The streak count at which the last nudge fired; `nil` until the first fire of the streak.
    private var lastFiredAt: Int?

    init(notifier: LocalNotifying, threshold: Int, repeatEvery: Int = 0) {
        self.notifier = notifier
        self.threshold = max(1, threshold)
        self.repeatEvery = max(0, repeatEvery)
    }

    func tick(category: Category, now: Date) {
        guard category == .unproductive else {
            unproductiveStreak = 0
            lastFiredAt = nil
            return
        }
        unproductiveStreak += 1
        let shouldFire: Bool
        if let last = lastFiredAt {
            // Already nudged this streak — re-nudge only if repeats are on and enough samples passed.
            shouldFire = repeatEvery > 0 && (unproductiveStreak - last) >= repeatEvery
        } else {
            shouldFire = unproductiveStreak >= threshold
        }
        if shouldFire {
            notifier.notify(id: "distraction", title: "Time tracking",
                            body: "~\(threshold) min on distracting apps — refocus?")
            lastFiredAt = unproductiveStreak
        }
    }

    /// Sign-out teardown — clear streak + fire history so a prior user's state never bleeds into
    /// the next sign-in (same cross-user integrity class as the 2.4 nudge teardown).
    func stop() {
        unproductiveStreak = 0
        lastFiredAt = nil
    }
}
