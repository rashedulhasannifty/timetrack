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

    init(
        tracker: TimeTracker,
        buffer: TimeEntryBuffering,
        thresholdSeconds: Int,
        currentSelection: @escaping () -> TimeTracker.Selection,
        presentAwayPrompt: @escaping (_ minutes: Int, _ resolve: @escaping (AwayResolution) -> Void) -> Void,
        clock: @escaping () -> Date = Date.init,
        idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) }
    ) {
        self.tracker = tracker
        self.buffer = buffer
        self.monitor = IdleMonitor(thresholdSeconds: thresholdSeconds, clock: clock)
        self.currentSelection = currentSelection
        self.presentAwayPrompt = presentAwayPrompt
        self.clock = clock
        self.idGen = idGen
        self.monitor.delegate = self
    }

    var monitorState: IdleMonitor.State { monitor.state }

    /// The auto layer stands down entirely while the employee is in a MANUAL session (design
    /// §4): a manually-started entry is the user's own action and must never be auto-stopped or
    /// bridged. Gating the system-edge forwarders (below) is the single mechanism — the monitor
    /// receives no idle/sleep/resume signals during a manual span, so no away cycle, no
    /// spurious IdleEvent, no stop.
    private var isManualSessionLive: Bool {
        if case .tracking(_, _, _, .manual) = tracker.state { return true }
        return false
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
    }

    func idleMonitor(_ monitor: IdleMonitor, shouldStopTrackingAt awayStart: Date) {
        tracker.stop(at: awayStart)
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

    private func enqueueIdleEvent(from: Date, to: Date, action: ResolvedAction) {
        let id = idGen(from)
        let event = IdleEventPayload(
            id: id,
            startTime: Self.iso.string(from: from),
            endTime: Self.iso.string(from: to),
            resolvedAction: action
        )
        if let data = try? JSONEncoder().encode(event) {
            buffer.enqueue(id: id, payload: data)
        }
    }

    /// Matches `TimeTracker`'s ISO config (`[.withInternetDateTime]`).
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
