import Foundation

enum AwayResolution { case keep, discard }

/// PRD §6.1/§6.4 — the pure automatic-tracking state machine. It never touches UI, network,
/// or capture hardware; a thin `WorkspaceObserver` feeds it idle seconds + sleep/lock signals,
/// and an `AutoTrackingCoordinator` (its delegate) turns decisions into TimeEntry/IdleEvent
/// writes. `clock` is injected for deterministic tests.
///
/// Reconciliation is client-authoritative: on idle the current AUTO entry is stopped at the
/// away-start (idle excluded); on resume the user keeps or discards the away window. This unit
/// only *decides*; the delegate performs the writes.
protocol IdleMonitorDelegate: AnyObject {
    /// Begin a fresh AUTO tracking span now (on activation and after each resume resolution).
    func idleMonitorShouldStartTracking(_ monitor: IdleMonitor)
    /// Close the current AUTO span at `awayStart` (idle threshold crossed, or sleep/lock).
    func idleMonitor(_ monitor: IdleMonitor, shouldStopTrackingAt awayStart: Date)
    /// The user returned after being away; present the keep/discard prompt. The delegate must
    /// eventually call `resolve(_:)`.
    func idleMonitor(_ monitor: IdleMonitor, didBecomeAwayForSeconds seconds: Int)
    /// The away window `[awayStart, resume]` was resolved. `keeping` → KEPT (bridge it) else DISCARDED.
    func idleMonitor(_ monitor: IdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool)
    /// Torn down while still away/awaiting — record the window as UNRESOLVED, no bridge.
    func idleMonitor(_ monitor: IdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date)
}

final class IdleMonitor {
    enum State: Equatable {
        case inactive
        case active
        case away(since: Date)
        case awaiting(since: Date, until: Date)
    }

    weak var delegate: IdleMonitorDelegate?
    private(set) var state: State = .inactive
    private let thresholdSeconds: Int
    private let clock: () -> Date

    init(thresholdSeconds: Int, clock: @escaping () -> Date = Date.init) {
        self.thresholdSeconds = thresholdSeconds
        self.clock = clock
    }

    /// Start (or restart) the auto session.
    func activate() {
        state = .active
        delegate?.idleMonitorShouldStartTracking(self)
    }

    /// Tear down; if still away/awaiting, the window is recorded UNRESOLVED.
    func deactivate() {
        switch state {
        case .away(let since):
            delegate?.idleMonitor(self, didAbandonAwayFrom: since, to: clock())
        case .awaiting(let since, let until):
            delegate?.idleMonitor(self, didAbandonAwayFrom: since, to: until)
        case .inactive, .active:
            break
        }
        state = .inactive
    }

    /// Periodic idle sample (seconds since last input). Drives active→away at threshold and
    /// away→awaiting when input resumes (a reading back below threshold).
    func tick(idleSeconds: Int) {
        switch state {
        case .active where idleSeconds >= thresholdSeconds:
            let awayStart = clock().addingTimeInterval(-Double(idleSeconds))
            state = .away(since: awayStart)
            delegate?.idleMonitor(self, shouldStopTrackingAt: awayStart)
        case .away(let since) where idleSeconds < thresholdSeconds:
            transitionToAwaiting(since: since)
        default:
            break
        }
    }

    /// System sleep or screen lock: input demonstrably stopped now (don't wait for threshold).
    func markAway() {
        guard case .active = state else { return }
        let awayStart = clock()
        state = .away(since: awayStart)
        delegate?.idleMonitor(self, shouldStopTrackingAt: awayStart)
    }

    /// Explicit resume signal (used when a non-idle-tick source detects return; the tick path
    /// also transitions away→awaiting on its own).
    func resume() {
        guard case .away(let since) = state else { return }
        transitionToAwaiting(since: since)
    }

    /// Shared away→awaiting transition (tick's below-threshold branch and explicit `resume()`).
    private func transitionToAwaiting(since: Date) {
        let resumeAt = clock()
        state = .awaiting(since: since, until: resumeAt)
        delegate?.idleMonitor(self, didBecomeAwayForSeconds: Int(resumeAt.timeIntervalSince(since)))
    }

    /// The user's keep/discard choice for the pending away window; restarts tracking.
    func resolve(_ action: AwayResolution) {
        guard case let .awaiting(since, until) = state else { return }
        delegate?.idleMonitor(self, didResolveAwayFrom: since, to: until, keeping: action == .keep)
        state = .active
        delegate?.idleMonitorShouldStartTracking(self)
    }
}
