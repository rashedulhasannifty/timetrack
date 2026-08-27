import Foundation

/// PRD §6.1 — bridges `IdleMonitor` decisions to `TimeTracker` writes and `IdleEvent` records.
/// It owns no capture hardware and no policy check: activation is gated upstream by AppDelegate
/// behind `AckGate` (auto-tracking is a capture path — CLAUDE.md §1). The `WorkspaceObserver`
/// (the system edge) calls `tick`/`markAway`/`resume`; this type forwards them to the monitor.
///
/// All callbacks arrive on the main thread (the observer's timer + NSWorkspace notifications),
/// so `TimeTracker` is only ever touched from the main thread.
final class AutoTrackingCoordinator: IdleMonitorDelegate {
    private let tracker: TimeTracker
    private let buffer: TimeEntryBuffering
    private let monitor: IdleMonitor
    private let currentSelection: () -> TimeTracker.Selection
    private let presentAwayPrompt: (_ minutes: Int, _ resolve: @escaping (AwayResolution) -> Void) -> Void
    private let clock: () -> Date
    private let idGen: (Date) -> String
    private let onIdleThresholdCrossed: (Int) -> Void
    /// Fired after EVERY auto open/close so the UI can re-read `TimeTracker`. Defaulted: this
    /// type is built at two call sites and in a dozen tests, and a required parameter on a shared
    /// client type breaks all of them in the same task.
    private let onTrackingStateChanged: () -> Void

    init(
        tracker: TimeTracker,
        buffer: TimeEntryBuffering,
        thresholdSeconds: Int,
        currentSelection: @escaping () -> TimeTracker.Selection,
        presentAwayPrompt: @escaping (_ minutes: Int, _ resolve: @escaping (AwayResolution) -> Void) -> Void,
        clock: @escaping () -> Date = Date.init,
        idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) },
        onIdleThresholdCrossed: @escaping (Int) -> Void = { _ in },
        onTrackingStateChanged: @escaping () -> Void = {}
    ) {
        self.tracker = tracker
        self.buffer = buffer
        self.monitor = IdleMonitor(thresholdSeconds: thresholdSeconds, clock: clock)
        self.currentSelection = currentSelection
        self.presentAwayPrompt = presentAwayPrompt
        self.clock = clock
        self.idGen = idGen
        self.onIdleThresholdCrossed = onIdleThresholdCrossed
        self.onTrackingStateChanged = onTrackingStateChanged
        self.monitor.delegate = self
    }

    var monitorState: IdleMonitor.State { monitor.state }

    /// The auto layer stands down entirely while the employee is in a MANUAL session (design
    /// §4): a manually-started entry is the user's own action and must never be auto-stopped or
    /// bridged. Gating the system-edge forwarders (below) is the single mechanism — the monitor
    /// receives no idle/sleep/resume signals during a manual span, so no away cycle, no
    /// spurious IdleEvent, no stop.
    /// `.paused` is included: pause/resume is a manual-only affordance (resume reopens as
    /// `.manual`), so a paused span is a manual session the auto layer must not clobber —
    /// without this, an away→resume cycle could `resolve` and open an AUTO entry over the
    /// paused state (`TimeTracker.start` only self-guards against a second `.tracking` start).
    private var isManualSessionLive: Bool {
        switch tracker.state {
        case .tracking(_, _, _, .manual), .paused: return true
        default: return false
        }
    }

    // Lifecycle (called by AppDelegate, already behind AckGate).
    func activate() { monitor.activate() }
    func deactivate() { monitor.deactivate() }

    // System-edge forwarders (called by WorkspaceObserver). No-ops during a manual session.
    func tick(idleSeconds: Int) { guard !isManualSessionLive else { return }; monitor.tick(idleSeconds: idleSeconds) }
    func markAway() { guard !isManualSessionLive else { return }; monitor.markAway() }
    func resume() { guard !isManualSessionLive else { return }; monitor.resume() }

    // MARK: IdleMonitorDelegate

    func idleMonitorShouldStartTracking(_ monitor: IdleMonitor) {
        let s = currentSelection()
        tracker.start(projectId: s.projectId, taskId: s.taskId, source: .auto)
        onTrackingStateChanged()
    }

    func idleMonitor(_ monitor: IdleMonitor, shouldStopTrackingAt awayStart: Date) {
        tracker.stop(at: awayStart)
        onTrackingStateChanged()
    }

    func idleMonitor(_ monitor: IdleMonitor, didBecomeAwayForSeconds seconds: Int) {
        let minutes = max(1, Int((Double(seconds) / 60.0).rounded()))
        presentAwayPrompt(minutes) { [weak monitor] action in monitor?.resolve(action) }
    }

    func idleMonitor(_ monitor: IdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool) {
        if keeping {
            let s = currentSelection()
            tracker.recordSpan(start: awayStart, end: resume,
                               projectId: s.projectId, taskId: s.taskId, source: .auto)
        }
        enqueueIdleEvent(from: awayStart, to: resume, action: keeping ? .kept : .discarded)
    }

    func idleMonitor(_ monitor: IdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date) {
        enqueueIdleEvent(from: awayStart, to: lastKnown, action: .unresolved)
    }

    func idleMonitorDidCrossIdleThreshold(_ monitor: IdleMonitor, afterSeconds seconds: Int) {
        onIdleThresholdCrossed(seconds)
    }

    private func enqueueIdleEvent(from: Date, to: Date, action: ResolvedAction) {
        IdleEventEnqueuer.enqueue(into: buffer, id: idGen(from), from: from, to: to, action: action)
    }
}
