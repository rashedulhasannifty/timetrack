using System.Windows.Threading;

namespace NiftyTimer.Tracking;

/// <summary>
/// The backstop under a forgotten manual timer: an entry that has been open for
/// <c>maxSeconds</c> is closed at that deadline, whatever else is or is not running.
///
/// <see cref="ManualIdleMonitor"/> is the real answer, and a much better one — it closes a manual
/// entry minutes after input stops, not hours. But it reads <c>GetLastInputInfo</c>, which makes
/// it a capture path (CLAUDE.md §1), so it is installed only inside <see cref="Policy.AckGate"/>
/// on the live-policy branch. A launch where the policy fetch never succeeds — offline for the
/// whole session, with a stored ack marker re-enabling manual tracking — installs no idle
/// detection at all, and the timer is unbounded again. This closes that door.
///
/// It reads NOTHING about the person. Two inputs: what <see cref="TimeTracker"/> is running, and
/// what time it is. No idle counter, no raw input, no window titles — which is exactly why it is
/// allowed to run on the offline branch, where an acknowledgement has never been confirmed and
/// observation must not start. It is deliberately not one of the installers
/// <c>OfflineCaptureUnreachableTests</c> forbids there, and must never become one: a future change
/// that wants it to consult input belongs behind the gate instead.
///
/// It runs on EVERY launch, not only the ungated one. With idle detection working a manual entry
/// cannot reach twelve hours, so the cap simply never fires; if idle detection dies mid-session,
/// or was never installed, it is still there. The cost of that generality is one real behaviour
/// change: someone genuinely working twelve unbroken hours on a single entry has it closed and
/// must start a new one.
///
/// Nothing is recorded as an idle window. <see cref="ManualIdleMonitor"/> can say when input
/// stopped because it was watching; this type was not, so it makes no claim about where the person
/// was. The entry simply ends at the deadline.
///
/// UI-thread only, like <see cref="TimeTracker"/> itself.
/// </summary>
public sealed class ManualSessionCap
{
    private readonly TimeTracker _tracker;
    private readonly int _maxSeconds;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>
    /// The stop happens directly on <see cref="TimeTracker"/>, which <see cref="App.MenuViewModel"/>
    /// cannot see — without this the tray would keep reporting a session the cap already ended.
    /// </summary>
    private readonly Action _onTrackingStopped;

    private DispatcherTimer? _timer;

    public ManualSessionCap(
        TimeTracker tracker,
        int maxSeconds,
        Func<DateTimeOffset>? clock = null,
        Action? onTrackingStopped = null)
    {
        _tracker = tracker;
        _maxSeconds = maxSeconds;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _onTrackingStopped = onTrackingStopped ?? (() => { });
    }

    /// <summary>
    /// Begin polling. Idempotent, because the ready path it is installed from can be reached more
    /// than once.
    ///
    /// The <see cref="Dispatcher"/> is passed in rather than taken from
    /// <see cref="Dispatcher.CurrentDispatcher"/>: a <see cref="DispatcherTimer"/> attaches to the
    /// dispatcher of whatever thread built it, and one built on a thread-pool thread never ticks
    /// and never says so — the same silent failure the idle poller's install guards against.
    /// </summary>
    public void Start(Dispatcher dispatcher, TimeSpan? pollInterval = null)
    {
        if (_timer is not null)
        {
            return;
        }

        var timer = new DispatcherTimer(DispatcherPriority.Background, dispatcher)
        {
            Interval = pollInterval ?? TimeSpan.FromSeconds(60),
        };
        timer.Tick += (_, _) => Fire();
        timer.Start();
        _timer = timer;
    }

    public void Stop()
    {
        _timer?.Stop();
        _timer = null;
    }

    /// <summary>
    /// One check. Internal so tests can drive it without a dispatcher loop.
    ///
    /// The entry ends at <c>StartedAt + maxSeconds</c>, NOT at the tick that noticed. A PC asleep
    /// from hour three to hour twenty wakes to a single very late tick, and closing at <c>now</c>
    /// would hand the timesheet the twenty-hour span this type exists to prevent.
    /// </summary>
    internal void Fire()
    {
        if (_tracker.State is not TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual } tracking)
        {
            return;
        }

        var deadline = tracking.StartedAt.AddSeconds(_maxSeconds);
        if (_clock() < deadline)
        {
            return;
        }

        _tracker.Stop(deadline);
        _onTrackingStopped();
    }
}
