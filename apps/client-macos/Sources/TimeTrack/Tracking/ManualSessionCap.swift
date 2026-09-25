import Foundation

/// The backstop under a forgotten manual timer: an entry that has been open for `maxSeconds` is
/// closed at that deadline, whatever else is or is not running.
///
/// `ManualIdleMonitor` is the real answer, and it is a much better one — it closes a manual entry
/// minutes after input stops, not hours. But it reads the OS idle counter, which makes it a
/// capture path (CLAUDE.md §1), so it is installed only inside `AckGate` on the live-policy
/// branch. A launch where the policy fetch never succeeds — offline for the whole session, with a
/// stored ack marker re-enabling manual tracking — installs no idle detection at all, and the
/// timer is unbounded again. This closes that door.
///
/// It reads NOTHING about the person. Two inputs: what `TimeTracker` is running, and what time it
/// is. No idle counter, no hardware, no window titles — which is exactly why it is allowed to run
/// on the offline branch, where an acknowledgement has never been confirmed and observation must
/// not start. It is not an "installer" in the sense `OfflineCaptureUnreachableTests` guards, and
/// must never become one: if a future change wants it to consult input, that change belongs
/// behind the gate instead.
///
/// It runs on EVERY launch, not only the ungated one. With idle detection working a manual entry
/// cannot reach twelve hours, so the cap simply never fires; if idle detection dies mid-session,
/// or was never installed, it is still there. The cost of that generality is one real behaviour
/// change: someone genuinely working twelve unbroken hours on a single entry has it closed and
/// must start a new one.
///
/// Nothing is recorded as an idle window. `ManualIdleMonitor` can say when input stopped because
/// it was watching; this type was not, so it makes no claim about where the person was. The entry
/// simply ends at the deadline.
///
/// Main-thread only, like `TimeTracker` itself.
final class ManualSessionCap {
    private let tracker: TimeTracker
    private let maxSeconds: Int
    private let pollSeconds: TimeInterval
    private let clock: () -> Date
    /// The stop happens directly on `TimeTracker`, which `MenuViewModel` cannot see — without this
    /// the menu bar would keep reporting a session the cap already ended.
    private let onTrackingStopped: () -> Void
    private var timer: Timer?

    init(tracker: TimeTracker,
         maxSeconds: Int,
         pollSeconds: TimeInterval = 60,
         clock: @escaping () -> Date = Date.init,
         onTrackingStopped: @escaping () -> Void = {}) {
        self.tracker = tracker
        self.maxSeconds = maxSeconds
        self.pollSeconds = pollSeconds
        self.clock = clock
        self.onTrackingStopped = onTrackingStopped
    }

    func start() {
        guard timer == nil else { return }   // idempotent: installed on both ready paths
        let t = Timer(timeInterval: pollSeconds, repeats: true) { [weak self] _ in self?.fire() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    /// One check. `internal` so tests can drive it without a run loop.
    ///
    /// The entry ends at `startedAt + maxSeconds`, NOT at the tick that noticed. A Mac asleep from
    /// hour three to hour twenty wakes to a single very late tick, and closing at `now` would hand
    /// the timesheet the twenty hours this type exists to prevent.
    func fire() {
        guard case .tracking(_, let startedAt, _, .manual) = tracker.state else { return }
        let deadline = startedAt.addingTimeInterval(Double(maxSeconds))
        guard clock() >= deadline else { return }
        tracker.stop(at: deadline)
        onTrackingStopped()
    }
}
