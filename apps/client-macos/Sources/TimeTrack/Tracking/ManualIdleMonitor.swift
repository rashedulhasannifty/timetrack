import Foundation

/// The manual-session counterpart of `IdleMonitor`: it decides when inactivity has gone on long
/// enough that the manual timer must stop. UI/network/capture-free; `clock` is injected for
/// deterministic tests.
///
/// Manual tracking used to run straight THROUGH an away window — the timer kept counting, and the
/// employee adjudicated the gap with a keep/discard prompt when they came back. Nobody comes back
/// from a Mac left awake over a weekend, and an unresolved window was kept: one span ran 47 hours
/// and made its start day report 50h tracked out of a possible 24. Inactivity now STOPS the timer
/// at the team's idle threshold, the way Time Doctor's "Timeout After" setting does, so unattended
/// time is bounded by policy rather than by someone remembering to press Stop.
///
/// The minutes between input stopping and the timeout are KEPT on the entry and recorded as an
/// idle window: they are as likely to be a call or a long read as an empty chair, and the Idle
/// panel is where that shows. Everything after the timeout is simply untracked — there is nothing
/// left to adjudicate, so there is no prompt on return and the person restarts the timer
/// themselves. Starting is theirs to do (CLAUDE.md §1); running unattended for two days is not.
protocol ManualIdleMonitorDelegate: AnyObject {
    /// Inactivity reached the timeout. Close the manual entry at `stopInstant` and record
    /// `[awayStart, stopInstant]` as an idle window.
    ///
    /// For the inactivity path `stopInstant` is `awayStart + thresholdSeconds`. For sleep/lock it
    /// is `awayStart` itself: the moment input stopped is known exactly there, so there are no
    /// unknown idle minutes to keep and none are invented.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didTimeOutFrom awayStart: Date, stoppingAt stopInstant: Date)
}

final class ManualIdleMonitor {
    /// Two states, not four. The away/awaiting pair existed to hold a window open until the user
    /// resolved it; the timeout resolves it by policy, so the monitor simply disarms. Disarming to
    /// `.inactive` (rather than a terminal state of its own) is what lets the coordinator re-arm it
    /// on the next manual session without a special case.
    enum State: Equatable {
        case inactive
        case active
    }

    weak var delegate: ManualIdleMonitorDelegate?
    private(set) var state: State = .inactive
    private let thresholdSeconds: Int
    private let clock: () -> Date
    /// When this session was armed. The OS idle counter keeps running across a Stop/Start, so a
    /// reading taken just after arming describes inactivity that happened BEFORE the session and
    /// is not the session's to answer for — without this, a span could be closed by policy the
    /// instant someone opened it.
    private var armedAt: Date?

    init(thresholdSeconds: Int, clock: @escaping () -> Date = Date.init) {
        self.thresholdSeconds = thresholdSeconds
        self.clock = clock
    }

    /// Arm the monitor. Unlike `IdleMonitor.activate`, there is no start-tracking side effect —
    /// the manual timer is started by the user, not by this monitor.
    func activate() {
        state = .active
        armedAt = clock()
    }

    /// Tear down. Nothing is pending by construction — a timeout disarms on its own — so this
    /// reports nothing and simply disarms.
    func deactivate() { disarm() }

    /// Periodic idle sample. Inactivity reaching the threshold times the session out.
    ///
    /// The stop lands at `awayStart + thresholdSeconds`, NOT at the tick that noticed. The poller
    /// runs on its own cadence and a reading can overshoot, so deriving the instant from the
    /// threshold keeps the entry's end independent of when the timer happened to fire — two Macs
    /// on the same policy close the same span in the same place.
    func tick(idleSeconds: Int) {
        guard case .active = state, let armedAt else { return }
        let now = clock()
        // Clamped to `armedAt`: idleness inherited from before this session doesn't count.
        let awayStart = max(now.addingTimeInterval(-Double(idleSeconds)), armedAt)
        guard now.timeIntervalSince(awayStart) >= Double(thresholdSeconds) else { return }
        timeOut(from: awayStart, stoppingAt: awayStart.addingTimeInterval(Double(thresholdSeconds)))
    }

    /// System sleep or screen lock: input demonstrably stopped NOW. Don't wait for the threshold,
    /// and don't credit threshold-worth of idle that provably did not happen — a closed lid is not
    /// a long read. The entry ends where the input did.
    func markAway() {
        guard case .active = state else { return }
        let now = clock()
        timeOut(from: now, stoppingAt: now)
    }

    private func timeOut(from awayStart: Date, stoppingAt stopInstant: Date) {
        disarm()
        delegate?.manualIdleMonitor(self, didTimeOutFrom: awayStart, stoppingAt: stopInstant)
    }

    private func disarm() {
        state = .inactive
        armedAt = nil
    }
}
