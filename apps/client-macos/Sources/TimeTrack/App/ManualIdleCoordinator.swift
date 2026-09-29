import Foundation

/// The manual-session sibling of `AutoTrackingCoordinator`. Fed the same `WorkspaceObserver`
/// signals (via `FanOutSignalReceiver` in auto mode, or alone in manual mode), it drives a
/// `ManualIdleMonitor` and applies the keep/discard/limit effects — but ONLY while a `.manual`
/// session is live. All callbacks arrive on the main thread.
///
/// It never stops a running manual timer just because the person stepped away for a few minutes
/// (CLAUDE.md §1) — that is the prompt's call, and Discard is only ever the person's own choice
/// (or the prompt's own default on dismiss). The one stop it performs unasked is the away-limit
/// backstop: past `awayLimitSeconds` with no return, the entry is closed AT `awayStart` because
/// nobody comes back from a Mac left away for an hour-plus and says so.
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
    /// Fired after the away-limit has closed the live entry directly on `TimeTracker`, so the
    /// owner can re-read it (the menu bar can't see a stop performed straight on the tracker).
    private let onTrackingStopped: () -> Void
    /// The away-limit fired with nothing left running to adjudicate — a one-shot local notice
    /// (NOT a keep/discard prompt) so the person knows why the clock isn't running when they get
    /// back. Carries the instant the entry actually stopped at (`awayStart`).
    private let onAwayLimitExceeded: (_ stoppedAt: Date) -> Void

    /// The entry the current away window belongs to. Guards Discard/limit/reconciliation against
    /// a session that ended or was replaced while away.
    private var awayEntryId: String?
    /// The entry the monitor is currently armed for. Arming is per ENTRY: the monitor stays armed
    /// through a Stop, so a Stop-then-Start would otherwise leave the NEW span measuring idleness
    /// from where the OLD one armed — someone who stepped away for four minutes, came back,
    /// stopped and started a different project would watch that fresh entry close itself on the
    /// very next tick.
    private var armedEntryId: String?

    init(
        tracker: TimeTracker,
        buffer: TimeEntryBuffering,
        thresholdSeconds: Int,
        awayLimitSeconds: Int = 60 * 60,
        presentAwayPrompt: @escaping (_ minutes: Int, _ resolve: @escaping (AwayResolution) -> Void) -> Void = { _, _ in },
        clock: @escaping () -> Date = Date.init,
        idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) },
        onEntryReplaced: @escaping (_ idleSeconds: TimeInterval) -> Void = { _ in },
        onTrackingStopped: @escaping () -> Void = {},
        onAwayLimitExceeded: @escaping (_ stoppedAt: Date) -> Void = { _ in },
        dismissPrompt: @escaping () -> Void = { AwayResolutionWindowController.dismissIfShowing() }
    ) {
        self.tracker = tracker
        self.buffer = buffer
        self.monitor = ManualIdleMonitor(thresholdSeconds: thresholdSeconds, awayLimitSeconds: awayLimitSeconds, clock: clock)
        self.presentAwayPrompt = presentAwayPrompt
        self.idGen = idGen
        self.onEntryReplaced = onEntryReplaced
        self.onTrackingStopped = onTrackingStopped
        self.onAwayLimitExceeded = onAwayLimitExceeded
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

    /// Guard + reconcile, then forward to the monitor only while a `.manual` session is live,
    /// arming it lazily (and re-arming per entry) on the first manual signal.
    private func reconcileThenRoute(_ forward: () -> Void) {
        reconcileSessionEnd()
        guard case .tracking(let entryId, _, _, .manual) = tracker.state else { return }
        if monitor.state == .inactive || armedEntryId != entryId {
            monitor.activate()
            armedEntryId = entryId
        }
        forward()
    }

    /// If the monitor is mid-cycle (away/awaiting) but the away entry is no longer the live manual
    /// entry (user hit Stop/Pause, or stopped-then-started a different entry), abandon the window:
    /// records UNRESOLVED and dismisses any showing prompt. Same mis-attribution class as the
    /// sign-out prompt leak.
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
            // The replacement opens at the return, not at the answer: the person was working
            // from then, and a prompt answered by policy is answered after they have left again.
            tracker.start(projectId: selection.projectId, subprojectId: selection.subprojectId,
                          taskId: selection.taskId, note: selection.note,
                          source: .manual, at: resume)
            // Same session, so the monitor stays armed across the swap rather than re-arming on
            // the replacement and forgetting an away window it has already begun.
            if case let .tracking(replacement, _, _, _) = tracker.state { armedEntryId = replacement }
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

    func manualIdleMonitorDidWithdrawPrompt(_ m: ManualIdleMonitor) {
        dismissPrompt()
    }

    func manualIdleMonitor(_ m: ManualIdleMonitor, didExceedAwayLimitFrom awayStart: Date, at limitInstant: Date) {
        defer { awayEntryId = nil }
        // Re-checked rather than assumed: `reconcileSessionEnd` already abandons the window the
        // moment the live entry changes, so by construction this still points at the entry that
        // was away — but TimeTracker remains the authority on what is running right now.
        guard case let .tracking(id, _, _, .manual) = tracker.state, id == awayEntryId else { return }
        tracker.stop(at: awayStart)
        enqueueIdle(from: awayStart, to: limitInstant, action: .discarded)
        onAwayLimitExceeded(awayStart)
        onTrackingStopped()
    }

    private func enqueueIdle(from: Date, to: Date, action: ResolvedAction) {
        IdleEventEnqueuer.enqueue(into: buffer, id: idGen(from), from: from, to: to, action: action)
    }
}
