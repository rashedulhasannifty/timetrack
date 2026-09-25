import Foundation

/// The manual-session sibling of `AutoTrackingCoordinator`. Fed the same `WorkspaceObserver`
/// signals (via `FanOutSignalReceiver` in auto mode, or alone in manual mode), it drives a
/// `ManualIdleMonitor` and applies its one effect — the inactivity timeout — but ONLY while a
/// `.manual` session is live. All callbacks arrive on the main thread.
///
/// See `ManualIdleMonitor` for why a manual timer now stops on inactivity at all. In short: it
/// used to run through the away window and keep it unless the employee came back and said
/// otherwise, which is how a span reached 47 hours.
final class ManualIdleCoordinator: ManualIdleMonitorDelegate, AutoTrackingSignalReceiver {
    private let tracker: TimeTracker
    private let buffer: TimeEntryBuffering
    private let monitor: ManualIdleMonitor
    private let idGen: (Date) -> String
    /// Fired after the timeout has closed the live entry, so the owner can re-read `TimeTracker`.
    /// The menu bar indicator is driven by `MenuViewModel`, which cannot see a stop performed
    /// directly on the tracker — without this the icon would keep reporting a session that ended.
    /// Defaulted so the call sites and tests that don't care need no change.
    private let onTrackingStopped: () -> Void
    /// The manual entry the monitor is currently armed for. See `route`.
    private var armedEntryId: String?

    init(
        tracker: TimeTracker,
        buffer: TimeEntryBuffering,
        thresholdSeconds: Int,
        clock: @escaping () -> Date = Date.init,
        idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) },
        onTrackingStopped: @escaping () -> Void = {}
    ) {
        self.tracker = tracker
        self.buffer = buffer
        self.monitor = ManualIdleMonitor(thresholdSeconds: thresholdSeconds, clock: clock)
        self.idGen = idGen
        self.onTrackingStopped = onTrackingStopped
        self.monitor.delegate = self
    }

    /// Sign-out / teardown. Nothing can be pending — a timeout disarms the monitor as it fires —
    /// so there is no half-resolved window to leak into the next session.
    func deactivate() { monitor.deactivate() }

    // MARK: AutoTrackingSignalReceiver (from WorkspaceObserver)

    func tick(idleSeconds: Int) { route { self.monitor.tick(idleSeconds: idleSeconds) } }
    func markAway() { route { self.monitor.markAway() } }
    /// Waking or unlocking is not itself a signal to do anything: if the session timed out while
    /// the machine slept, the entry is already closed and the person restarts when they are ready.
    func resume() {}

    /// Forward to the monitor only while a `.manual` session is live, arming it lazily on the
    /// first manual signal. This is also what re-arms after a timeout: the timeout disarms the
    /// monitor and closes the entry, so nothing routes again until the person starts a new manual
    /// session.
    ///
    /// Arming is per ENTRY, not merely "whenever the monitor is idle". The monitor stays armed
    /// through a Stop, so a Stop-then-Start would otherwise leave the NEW span measuring idleness
    /// from where the OLD one armed — and someone who stepped away for four minutes, came back,
    /// stopped and started a different project would watch that fresh entry close itself on the
    /// very next tick. That is exactly what `armedAt` exists to prevent, one level up.
    private func route(_ forward: () -> Void) {
        guard case .tracking(let entryId, _, _, .manual) = tracker.state else { return }
        if monitor.state == .inactive || armedEntryId != entryId {
            monitor.activate()
            armedEntryId = entryId
        }
        forward()
    }

    // MARK: ManualIdleMonitorDelegate

    func manualIdleMonitor(_ m: ManualIdleMonitor, didTimeOutFrom awayStart: Date, stoppingAt stopInstant: Date) {
        // Re-checked rather than assumed: the signal that triggered this was routed while a manual
        // session was live, but `TimeTracker` is the authority on what is running right now, and a
        // stop aimed at a session that already ended would close somebody else's span.
        guard case .tracking(_, _, _, .manual) = tracker.state else { return }
        tracker.stop(at: stopInstant)
        // The kept idle window, for the Idle panel. `.kept` because that is what the timesheet
        // says: these minutes are ON the entry. The stretch after `stopInstant` is untracked and
        // needs no record — there is no time to account for.
        if stopInstant > awayStart {
            IdleEventEnqueuer.enqueue(into: buffer, id: idGen(awayStart),
                                      from: awayStart, to: stopInstant, action: .kept)
        }
        onTrackingStopped()
    }
}
