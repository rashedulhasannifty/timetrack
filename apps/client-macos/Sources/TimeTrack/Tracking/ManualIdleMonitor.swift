import Foundation

/// The manual-session counterpart of `IdleMonitor`. Same state shape, but manual semantics:
/// going away does NOT stop the timer (a manual entry is the user's own action — CLAUDE.md §1),
/// and resolving does NOT auto-open a new span — the `ManualIdleCoordinator` performs the
/// keep/discard effects. `clock` is injected for deterministic tests. UI/network/capture-free.
protocol ManualIdleMonitorDelegate: AnyObject {
    /// Idle threshold crossed (or sleep/lock). The timer keeps running; the coordinator snapshots
    /// which entry the away window belongs to.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBeginAwayAt awayStart: Date)
    /// Input resumed after being away — present the keep/discard prompt. The delegate must
    /// eventually call `resolve(_:)`.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBecomeAwayForSeconds seconds: Int)
    /// The away window `[awayStart, resume]` was resolved. `keeping` → count it; else discard.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool)
    /// Torn down while still away/awaiting — record UNRESOLVED, no trim.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date)
}

final class ManualIdleMonitor {
    enum State: Equatable {
        case inactive
        case active
        case away(since: Date)
        case awaiting(since: Date, until: Date)
    }

    weak var delegate: ManualIdleMonitorDelegate?
    private(set) var state: State = .inactive
    private let thresholdSeconds: Int
    private let clock: () -> Date

    init(thresholdSeconds: Int, clock: @escaping () -> Date = Date.init) {
        self.thresholdSeconds = thresholdSeconds
        self.clock = clock
    }

    /// Arm the monitor. Unlike `IdleMonitor.activate`, there is no start-tracking side effect —
    /// the manual timer is started by the user, not by this monitor.
    func activate() { state = .active }

    /// Tear down; if still away/awaiting, record UNRESOLVED.
    func deactivate() {
        switch state {
        case .away(let since):
            delegate?.manualIdleMonitor(self, didAbandonAwayFrom: since, to: clock())
        case .awaiting(let since, let until):
            delegate?.manualIdleMonitor(self, didAbandonAwayFrom: since, to: until)
        case .inactive, .active:
            break
        }
        state = .inactive
    }

    /// Periodic idle sample. active→away at threshold (NO stop); away→awaiting when input resumes.
    func tick(idleSeconds: Int) {
        switch state {
        case .active where idleSeconds >= thresholdSeconds:
            let awayStart = clock().addingTimeInterval(-Double(idleSeconds))
            state = .away(since: awayStart)
            delegate?.manualIdleMonitor(self, didBeginAwayAt: awayStart)
        case .away(let since) where idleSeconds < thresholdSeconds:
            transitionToAwaiting(since: since)
        default:
            break
        }
    }

    /// System sleep / screen lock: away now (don't wait for threshold). Still no stop.
    func markAway() {
        guard case .active = state else { return }
        let awayStart = clock()
        state = .away(since: awayStart)
        delegate?.manualIdleMonitor(self, didBeginAwayAt: awayStart)
    }

    /// Explicit resume (wake/unlock); the tick path also transitions away→awaiting on its own.
    func resume() {
        guard case .away(let since) = state else { return }
        transitionToAwaiting(since: since)
    }

    private func transitionToAwaiting(since: Date) {
        let resumeAt = clock()
        state = .awaiting(since: since, until: resumeAt)
        delegate?.manualIdleMonitor(self, didBecomeAwayForSeconds: Int(resumeAt.timeIntervalSince(since)))
    }

    /// The user's keep/discard choice. Returns to `.active` (re-armed) WITHOUT opening a span —
    /// the coordinator applies the effect.
    func resolve(_ action: AwayResolution) {
        guard case let .awaiting(since, until) = state else { return }
        delegate?.manualIdleMonitor(self, didResolveAwayFrom: since, to: until, keeping: action == .keep)
        state = .active
    }
}
