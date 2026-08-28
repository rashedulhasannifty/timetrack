import Foundation
import CoreGraphics

/// Slice 2.4 — the manual-mode (`autoStartOnLogin=false`) nudge poller. One 15s timer reads the
/// SAME content-free idle scalar as `WorkspaceObserver` (`CGEventSource.secondsSinceLastEventType`
/// — no key/pointer content) and, purely locally, decides between two mutually-exclusive-by-tracker
/// -state notifications, both NOTIFY-ONLY:
///   • forgot-to-start — present + not tracking for `forgotToStartSeconds` → "start?"
///   • manual idle     — a manual clock live + idle >= threshold → "still tracking?"
/// The manual-idle nudge NEVER stops the clock (a manual entry is the user's own action —
/// CLAUDE.md/design invariant): this type does not touch `TimeTracker` or `IdleMonitor`, so it
/// produces no stop and no spurious IdleEvent. No network, no logging. Installed only behind
/// `AckGate` on the online `!ackRequired` path (see AppDelegate).
final class ManualNudgeMonitor {
    private let notifier: LocalNotifying
    private let idleThresholdSeconds: Int
    private let forgotToStartSeconds: Int
    private let isTracking: () -> Bool
    private let isPaused: () -> Bool
    private let pollInterval: TimeInterval
    /// Auto mode: present the forgot-to-start reminder as a VISIBLE window instead of posting a
    /// notification. Auto-tracking failing to start is a fault, not a gentle hint, and the
    /// notifier silently drops everything on a build macOS never authorized (see `LocalNotifier`).
    /// `nil` (the default) keeps the manual-mode behaviour: a plain notification.
    private let presentForgotToStart: ((_ title: String, _ body: String) -> Void)?
    /// Auto mode passes `false`: `IdleMonitor` already owns the idle nudge there (`idle-nudge`),
    /// and a second "still tracking?" for the same idle stretch would just compete with it.
    private let emitsManualIdleNudge: Bool
    /// True while an away keep/discard prompt is on screen awaiting the user. They are not
    /// tracking and they are present, which is exactly the forgot-to-start shape — but the
    /// prompt IS the thing asking them to act, so a second window on top of it is noise.
    private let isAwaitingResolution: () -> Bool

    private var activeSince: Date?
    private var firedForgot = false
    private var firedManualIdle = false
    private var timer: Timer?

    init(notifier: LocalNotifying, idleThresholdSeconds: Int, forgotToStartSeconds: Int,
         isTracking: @escaping () -> Bool, isPaused: @escaping () -> Bool,
         pollInterval: TimeInterval = 15,
         presentForgotToStart: ((_ title: String, _ body: String) -> Void)? = nil,
         emitsManualIdleNudge: Bool = true,
         isAwaitingResolution: @escaping () -> Bool = { false }) {
        self.notifier = notifier
        self.idleThresholdSeconds = idleThresholdSeconds
        self.forgotToStartSeconds = forgotToStartSeconds
        self.isTracking = isTracking
        self.isPaused = isPaused
        self.pollInterval = pollInterval
        self.presentForgotToStart = presentForgotToStart
        self.emitsManualIdleNudge = emitsManualIdleNudge
        self.isAwaitingResolution = isAwaitingResolution
    }

    func start() {
        timer?.invalidate()
        let t = Timer(timeInterval: pollInterval, repeats: true) { [weak self] _ in self?.sample() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        activeSince = nil
        firedForgot = false
        firedManualIdle = false
    }

    private func sample() {
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState,
                                                           eventType: .init(rawValue: ~0)!)
        tick(idleSeconds: Int(idle), now: Date())
    }

    /// Pure decision logic (timer-free) — the tested surface.
    func tick(idleSeconds: Int, now: Date) {
        if isTracking() {
            // Manual clock live → manual-idle nudge only. Forgot-to-start is meaningless here.
            activeSince = nil
            firedForgot = false
            if idleSeconds >= idleThresholdSeconds {
                if !firedManualIdle, emitsManualIdleNudge {
                    let minutes = max(1, Int((Double(idleSeconds) / 60.0).rounded()))
                    notifier.notify(id: "manual-idle", title: "Time tracking",
                                    body: "Idle for \(minutes) min — still tracking?")
                    firedManualIdle = true
                }
            } else {
                firedManualIdle = false   // active again → re-arm
            }
            return
        }

        if isPaused() || isAwaitingResolution() {
            // Mid-pause manual session — no nudges.
            activeSince = nil
            firedForgot = false
            firedManualIdle = false
            return
        }

        // Not tracking, not paused → forgot-to-start.
        firedManualIdle = false
        if idleSeconds >= idleThresholdSeconds {
            activeSince = nil          // user is away → break the stretch
            firedForgot = false        // re-arm for the next presence
            return
        }
        if activeSince == nil { activeSince = now }
        if let since = activeSince, !firedForgot,
           now.timeIntervalSince(since) >= Double(forgotToStartSeconds) {
            let title = "Time tracking"
            let body = "You've been active \(forgotToStartSeconds / 60) min without tracking — start?"
            if let presentForgotToStart {
                presentForgotToStart(title, body)
            } else {
                notifier.notify(id: "forgot-to-start", title: title, body: body)
            }
            firedForgot = true
        }
    }
}
