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

    private var activeSince: Date?
    private var firedForgot = false
    private var firedManualIdle = false
    private var timer: Timer?

    init(notifier: LocalNotifying, idleThresholdSeconds: Int, forgotToStartSeconds: Int,
         isTracking: @escaping () -> Bool, isPaused: @escaping () -> Bool,
         pollInterval: TimeInterval = 15) {
        self.notifier = notifier
        self.idleThresholdSeconds = idleThresholdSeconds
        self.forgotToStartSeconds = forgotToStartSeconds
        self.isTracking = isTracking
        self.isPaused = isPaused
        self.pollInterval = pollInterval
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
                if !firedManualIdle {
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

        if isPaused() {
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
            notifier.notify(id: "forgot-to-start", title: "Time tracking",
                            body: "You've been active \(forgotToStartSeconds / 60) min without tracking — start?")
            firedForgot = true
        }
    }
}
