import Foundation

/// The manual-session sibling of `AutoTrackingCoordinator`. Fed the same `WorkspaceObserver`
/// signals (via `FanOutSignalReceiver` in auto mode, or alone in manual mode), it drives a
/// `ManualIdleMonitor` and applies the keep/discard effects — but ONLY while a `.manual` session
/// is live. It never stops a running manual timer on its own (CLAUDE.md §1); the only stop it
/// performs is the user-chosen Discard trim. All callbacks arrive on the main thread.
final class ManualIdleCoordinator: ManualIdleMonitorDelegate, AutoTrackingSignalReceiver {
    private let tracker: TimeTracker
    private let buffer: TimeEntryBuffering
    private let monitor: ManualIdleMonitor
    private let presentAwayPrompt: (_ minutes: Int, _ resolve: @escaping (AwayResolution) -> Void) -> Void
    private let idGen: (Date) -> String
    private let dismissPrompt: () -> Void
    /// Fired after Discard has replaced the live entry directly on `TimeTracker` (trim + fresh
    /// start), carrying the discarded idle gap in seconds. The owner shifts the display clock
    /// forward by this gap so it keeps reading accumulated *worked* time (the fresh entry's real
    /// start would read 0) — UI that only observes `TimeTracker` through `MenuViewModel` can't see
    /// the swap on its own. Only Discard fires this; Keep/unresolved leave the live entry untouched.
    private let onEntryReplaced: (_ idleSeconds: TimeInterval) -> Void

    /// The entry the current away window belongs to. Guards Discard/reconciliation against a
    /// session that ended or was replaced while away.
    private var awayEntryId: String?

    init(
        tracker: TimeTracker,
        buffer: TimeEntryBuffering,
        thresholdSeconds: Int,
        presentAwayPrompt: @escaping (_ minutes: Int, _ resolve: @escaping (AwayResolution) -> Void) -> Void,
        clock: @escaping () -> Date = Date.init,
        idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) },
        onEntryReplaced: @escaping (_ idleSeconds: TimeInterval) -> Void = { _ in },
        dismissPrompt: @escaping () -> Void = { AwayResolutionWindowController.dismissIfShowing() }
    ) {
        self.tracker = tracker
        self.buffer = buffer
        self.monitor = ManualIdleMonitor(thresholdSeconds: thresholdSeconds, clock: clock)
        self.presentAwayPrompt = presentAwayPrompt
        self.idGen = idGen
        self.onEntryReplaced = onEntryReplaced
        self.dismissPrompt = dismissPrompt
        self.monitor.delegate = self
    }

    /// Sign-out / teardown: record any pending away as UNRESOLVED (no trim). The caller dismisses
    /// the prompt AFTER this, so its resolve is a no-op on the now-inactive monitor.
    func deactivate() { monitor.deactivate() }

    // MARK: AutoTrackingSignalReceiver (from WorkspaceObserver)

    func tick(idleSeconds: Int) { reconcileThenRoute { self.monitor.tick(idleSeconds: idleSeconds) } }
    func markAway() { reconcileThenRoute { self.monitor.markAway() } }
    func resume() { reconcileThenRoute { self.monitor.resume() } }

    /// Guard + reconcile, then forward to the monitor only while a `.manual` session is live and
    /// armed. Arms the monitor lazily on the first manual signal.
    private func reconcileThenRoute(_ forward: () -> Void) {
        reconcileSessionEnd()
        guard isManualSessionLive else { return }
        if monitor.state == .inactive { monitor.activate() }
        forward()
    }

    /// If the monitor is mid-cycle (away/awaiting) but the away entry is no longer the live manual
    /// entry (user hit Stop/Pause, or stopped-then-started a different entry), abandon the window:
    /// records UNRESOLVED and dismisses any showing prompt. This is the crux integrity guard —
    /// same mis-attribution class as the sign-out prompt leak.
    private func reconcileSessionEnd() {
        switch monitor.state {
        case .away, .awaiting:
            if !isSameManualEntryLive {
                monitor.deactivate()          // → didAbandonAwayFrom → UNRESOLVED
                dismissPrompt()
            }
        case .inactive, .active:
            break
        }
    }

    private var isManualSessionLive: Bool {
        if case .tracking(_, _, _, .manual) = tracker.state { return true }
        return false
    }

    private var isSameManualEntryLive: Bool {
        guard let awayEntryId, case let .tracking(id, _, _, .manual) = tracker.state else { return false }
        return id == awayEntryId
    }

    // MARK: ManualIdleMonitorDelegate

    func manualIdleMonitor(_ m: ManualIdleMonitor, didBeginAwayAt awayStart: Date) {
        if case let .tracking(id, _, _, .manual) = tracker.state { awayEntryId = id }
    }

    func manualIdleMonitor(_ m: ManualIdleMonitor, didBecomeAwayForSeconds seconds: Int) {
        let minutes = max(1, Int((Double(seconds) / 60.0).rounded()))
        presentAwayPrompt(minutes) { [weak m] action in m?.resolve(action) }
    }

    func manualIdleMonitor(_ m: ManualIdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool) {
        defer { awayEntryId = nil }
        if keeping {
            enqueueIdle(from: awayStart, to: resume, action: .kept)
            return
        }
        // Discard: trim ONLY if the same manual entry is still running.
        if case let .tracking(id, _, selection, .manual) = tracker.state, id == awayEntryId {
            tracker.stop(at: awayStart)
            tracker.start(projectId: selection.projectId, taskId: selection.taskId, source: .manual)
            enqueueIdle(from: awayStart, to: resume, action: .discarded)
            // Shift the clock forward by the discarded idle gap so it keeps reading worked time.
            onEntryReplaced(resume.timeIntervalSince(awayStart))
        } else {
            enqueueIdle(from: awayStart, to: resume, action: .unresolved)
        }
    }

    func manualIdleMonitor(_ m: ManualIdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date) {
        enqueueIdle(from: awayStart, to: lastKnown, action: .unresolved)
        awayEntryId = nil
    }

    private func enqueueIdle(from: Date, to: Date, action: ResolvedAction) {
        IdleEventEnqueuer.enqueue(into: buffer, id: idGen(from), from: from, to: to, action: action)
    }
}
