import Foundation

/// The three admin-owned knobs behind the distraction nudge, read from the team policy
/// (`TeamSettings.distractionAlertsEnabled` / `…ThresholdMinutes` / `…RepeatMinutes`). Values are
/// clamped here so a malformed policy can never turn the nudge into a per-sample alarm.
struct DistractionSettings: Equatable {
    /// The team's master switch. Off ⇒ the client never nudges, whatever the app/site lists say.
    let enabled: Bool
    /// Consecutive unproductive samples before the FIRST nudge of a streak.
    let thresholdMinutes: Int
    /// Samples between re-nudges while the streak continues; `0` = fire once per streak.
    let repeatMinutes: Int

    init(enabled: Bool, thresholdMinutes: Int, repeatMinutes: Int) {
        self.enabled = enabled
        self.thresholdMinutes = max(1, thresholdMinutes)
        self.repeatMinutes = max(0, repeatMinutes)
    }

    /// Straight from the team policy — the only construction the app itself uses.
    init(_ settings: EffectivePolicy.Settings) {
        self.init(enabled: settings.distractionAlertsEnabled,
                  thresholdMinutes: settings.distractionThresholdMinutes,
                  repeatMinutes: settings.distractionRepeatMinutes)
    }

    /// No policy in hand (offline start, sign-out) — the server default is opt-in, so: silent.
    static let off = DistractionSettings(enabled: false, thresholdMinutes: 10, repeatMinutes: 5)
}

/// Slice 3.4 — the local distraction nudge (PRD §6.4: trust, not surveillance). A pure,
/// timer-free decision unit fed one `Category` per activity sample (~60s) from `ActivitySampler`
/// via its `onCategorized` hook. It counts CONSECUTIVE `UNPRODUCTIVE` samples and, when the streak
/// reaches the threshold, posts a local notification. Any non-unproductive sample (PRODUCTIVE or
/// NEUTRAL) breaks the streak and re-arms. NOTIFY-ONLY: no network, no disk, no logging; it sees
/// only a `Category` enum value, never an app name/host/title/key content (CLAUDE.md §1).
///
/// `repeatMinutes` controls whether an unbroken streak keeps reminding: `0` fires exactly once per
/// streak; `N > 0` re-nudges every N further samples while the streak continues (e.g. threshold 10,
/// repeat 5 → nudges at 10, 15, 20 …). The repeat is deliberately a gentle recurring reminder,
/// never a modal block — the fallback window is non-modal and dismissible (CLAUDE.md §1:
/// transparency, not coercion).
///
/// Settings are read through a closure on EVERY tick rather than captured at construction, so an
/// admin's edit reaches a running client on its next sample (the gate re-fetches the policy each
/// capture cycle) instead of waiting for a relaunch. Turning alerts off mid-streak also drops the
/// streak, so re-enabling starts fresh rather than firing immediately.
///
/// The threshold/repeat are counts of consecutive unproductive samples; with the sampler's 60s
/// window they are counts of minutes (the 60s-cadence coupling is documented at the `AppDelegate`
/// construction site). `now` is currently unused (the streak is count-based) but kept in the
/// signature to match `ManualNudgeMonitor.tick(...:now:)`.
final class DistractionMonitor {
    private let notifier: LocalNotifying
    private let settings: () -> DistractionSettings
    private var unproductiveStreak = 0
    /// The streak count at which the last nudge fired; `nil` until the first fire of the streak.
    private var lastFiredAt: Int?

    init(notifier: LocalNotifying, settings: @escaping () -> DistractionSettings) {
        self.notifier = notifier
        self.settings = settings
    }

    /// Fixed-settings convenience — the offline path (no policy fetched) and the unit tests.
    convenience init(notifier: LocalNotifying, threshold: Int, repeatEvery: Int = 0, enabled: Bool = true) {
        let fixed = DistractionSettings(enabled: enabled, thresholdMinutes: threshold, repeatMinutes: repeatEvery)
        self.init(notifier: notifier, settings: { fixed })
    }

    func tick(category: Category, now: Date) {
        let policy = settings()
        // Alerts off: no nudge, and no streak kept — re-enabling must not fire on the next sample
        // off the back of minutes counted while the team had the feature switched off.
        guard policy.enabled else { stop(); return }
        guard category == .unproductive else {
            unproductiveStreak = 0
            lastFiredAt = nil
            return
        }
        unproductiveStreak += 1
        let shouldFire: Bool
        if let last = lastFiredAt {
            // Already nudged this streak — re-nudge only if repeats are on and enough samples passed.
            shouldFire = policy.repeatMinutes > 0 && (unproductiveStreak - last) >= policy.repeatMinutes
        } else {
            shouldFire = unproductiveStreak >= policy.thresholdMinutes
        }
        if shouldFire {
            // The streak length, not the threshold — a repeat nudge at 15 minutes must not claim 10.
            notifier.notify(id: "distraction", title: "Time tracking",
                            body: "~\(unproductiveStreak) min on distracting apps or sites — refocus?")
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
