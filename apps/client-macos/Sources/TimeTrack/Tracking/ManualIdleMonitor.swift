import Foundation

/// The manual-session counterpart of `IdleMonitor`. Same state shape as auto tracking's own
/// away/awaiting cycle, but manual semantics: going away does NOT stop the timer by itself (a
/// manual entry is the user's own action — CLAUDE.md §1), and resolving does NOT auto-open a new
/// span — the `ManualIdleCoordinator` performs the keep/discard effects. `clock` is injected for
/// deterministic tests. UI/network/capture-free.
///
/// A manual entry running straight through an away window used to be adjudicated on return with
/// no bound: nobody comes back from a Mac left awake over a weekend, and an unresolved window was
/// KEPT, so one span reached 47 hours. `awayLimitSeconds` is the backstop under that: an away
/// window that is never resolved — no return before the limit, including one that spans a sleep —
/// stops the entry AT `awayStart` (none of the away time counts) instead of leaving it open
/// indefinitely for someone to adjudicate whenever they happen to notice. A short absence still
/// gets the ordinary keep/discard prompt; only a long, unattended one is closed by policy.
protocol ManualIdleMonitorDelegate: AnyObject {
    /// Idle threshold crossed (or sleep/lock). The timer keeps running; the coordinator snapshots
    /// which entry the away window belongs to.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBeginAwayAt awayStart: Date)
    /// Input resumed after being away, within the away limit — present the keep/discard prompt.
    /// The delegate must eventually call `resolve(_:)`.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBecomeAwayForSeconds seconds: Int)
    /// The away window `[awayStart, resume]` was resolved. `keeping` → count it; else discard.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool)
    /// Torn down while still away/awaiting — record UNRESOLVED, no trim.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date)
    /// The away window ran past `awayLimitSeconds` with no return to adjudicate it (including one
    /// that spans a sleep, discovered only on the next tick or on wake). Stop the entry AT
    /// `awayStart` and record `[awayStart, limitInstant]` as DISCARDED — no prompt.
    /// `limitInstant` is always `awayStart + awayLimitSeconds`, derived rather than read from the
    /// clock, so it doesn't drift with whichever tick happened to notice.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didExceedAwayLimitFrom awayStart: Date, at limitInstant: Date)
    /// The open prompt is being answered by policy (the person went away again without answering
    /// it). Close it. Its own answer on close arrives after the monitor has moved on and is ignored.
    func manualIdleMonitorDidWithdrawPrompt(_ m: ManualIdleMonitor)
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
    /// Fixed constant (60 minutes), injectable for tests. Not a team/server policy value.
    private let awayLimitSeconds: Int
    private let clock: () -> Date
    /// When this session was armed. The OS idle counter keeps running across a Stop/Start, so a
    /// reading taken just after arming describes inactivity that happened BEFORE the session and
    /// is not the session's to answer for.
    private var armedAt: Date?

    init(thresholdSeconds: Int, awayLimitSeconds: Int = 60 * 60, clock: @escaping () -> Date = Date.init) {
        self.thresholdSeconds = thresholdSeconds
        self.awayLimitSeconds = awayLimitSeconds
        self.clock = clock
    }

    /// Arm the monitor. Unlike `IdleMonitor.activate`, there is no start-tracking side effect —
    /// the manual timer is started by the user, not by this monitor.
    func activate() {
        state = .active
        armedAt = clock()
    }

    /// Tear down; if still away/awaiting, record UNRESOLVED (no trim, no limit check — a
    /// sign-out is not a return).
    func deactivate() {
        switch state {
        case .away(let since):
            delegate?.manualIdleMonitor(self, didAbandonAwayFrom: since, to: clock())
        case .awaiting(let since, let until):
            delegate?.manualIdleMonitor(self, didAbandonAwayFrom: since, to: until)
        case .inactive, .active:
            break
        }
        disarm()
    }

    /// Periodic idle sample. active→away at threshold (NO stop). While away: input still below
    /// threshold and the limit already reached → the limit path (no prompt); input resumed →
    /// the ordinary return path.
    func tick(idleSeconds: Int) {
        let now = clock()
        switch state {
        case .active where idleSeconds >= thresholdSeconds:
            guard let armedAt else { return }
            // Clamped to `armedAt`: idleness inherited from before this session doesn't count.
            let awayStart = max(now.addingTimeInterval(-Double(idleSeconds)), armedAt)
            beginAway(at: awayStart)
        case .away(let since):
            if idleSeconds < thresholdSeconds {
                resolveAwayOnReturn(since: since, now: now)
            } else if now.timeIntervalSince(since) >= Double(awayLimitSeconds) {
                // Still away, no return yet, and the limit is already reached — don't wait for
                // someone to come back before closing the door.
                exceedLimit(from: since)
            }
        case .awaiting(_, let until) where idleSeconds >= thresholdSeconds:
            // Back, prompt unanswered, and gone again — the end of the day with the prompt still
            // up. Left waiting, the timer would run until the 12h cap: the very overnight entry
            // the limit exists to stop. The second absence starts where input stopped, never
            // before the return that opened the prompt.
            withdrawPrompt()
            beginAway(at: max(now.addingTimeInterval(-Double(idleSeconds)), until))
        default:
            break
        }
    }

    /// System sleep / screen lock: away now (don't wait for threshold). Still no stop.
    func markAway() {
        switch state {
        case .active:
            beginAway(at: clock())
        case .awaiting:
            withdrawPrompt()
            beginAway(at: clock())
        case .inactive, .away:
            break
        }
    }

    /// Explicit resume (wake/unlock). A sleep can outlast the away limit entirely — no tick fires
    /// while asleep — so this is exactly where "exceeded while asleep" is discovered.
    func resume() {
        guard case .away(let since) = state else { return }
        resolveAwayOnReturn(since: since, now: clock())
    }

    /// The user's keep/discard choice. Returns to `.active` (re-armed) WITHOUT opening a span —
    /// the coordinator applies the effect.
    func resolve(_ action: AwayResolution) {
        guard case let .awaiting(since, until) = state else { return }
        delegate?.manualIdleMonitor(self, didResolveAwayFrom: since, to: until, keeping: action == .keep)
        state = .active
    }

    /// Answer the open prompt with its default, Discard, and close it. The state leaves `.awaiting`
    /// BEFORE the prompt is closed, so the prompt's own answer on close is a no-op.
    private func withdrawPrompt() {
        guard case let .awaiting(since, until) = state else { return }
        state = .active
        delegate?.manualIdleMonitorDidWithdrawPrompt(self)
        delegate?.manualIdleMonitor(self, didResolveAwayFrom: since, to: until, keeping: false)
    }

    private func beginAway(at awayStart: Date) {
        state = .away(since: awayStart)
        delegate?.manualIdleMonitor(self, didBeginAwayAt: awayStart)
    }

    /// Shared "input resumed / wake / unlock" handling: within the limit → prompt; past it →
    /// the limit path. `now` is the return instant, not necessarily `clock()` at call time (tests
    /// pin both to the same clock, but the split keeps the decision pure).
    private func resolveAwayOnReturn(since: Date, now: Date) {
        if now.timeIntervalSince(since) > Double(awayLimitSeconds) {
            exceedLimit(from: since)
        } else {
            state = .awaiting(since: since, until: now)
            delegate?.manualIdleMonitor(self, didBecomeAwayForSeconds: Int(now.timeIntervalSince(since)))
        }
    }

    private func exceedLimit(from awayStart: Date) {
        disarm()
        let limitInstant = awayStart.addingTimeInterval(Double(awayLimitSeconds))
        delegate?.manualIdleMonitor(self, didExceedAwayLimitFrom: awayStart, at: limitInstant)
    }

    private func disarm() {
        state = .inactive
        armedAt = nil
    }
}
