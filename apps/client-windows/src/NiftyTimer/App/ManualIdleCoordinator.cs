using NiftyTimer.Storage;
using NiftyTimer.Tracking;

namespace NiftyTimer.App;

/// <summary>
/// The manual-session sibling of <see cref="AutoTrackingCoordinator"/>. Fed the same
/// <see cref="SessionObserver"/> signals — via <see cref="FanOutSignalReceiver"/> in auto mode, or
/// alone in manual mode — it drives a <see cref="ManualIdleMonitor"/> and applies its one effect,
/// the inactivity timeout, but ONLY while a MANUAL session is live. All callbacks arrive on the
/// UI thread.
///
/// See <see cref="ManualIdleMonitor"/> for why a manual timer now stops on inactivity at all. In
/// short: it used to run through the away window and keep it unless the employee came back and
/// said otherwise, which is how a span reached days long.
///
/// Note what this type no longer has: no away prompt, and no discard trim. Once the timeout has
/// closed the entry there is nothing left for the employee to adjudicate on return, so the prompt
/// — and with it the stale-prompt reconciliation, the entry-id snapshot and the display-clock
/// anchor that Discard needed — are gone by construction rather than by guard.
/// </summary>
public sealed class ManualIdleCoordinator : IManualIdleMonitorDelegate, ISignalReceiver
{
    private readonly TimeTracker _tracker;
    private readonly ITimeEntryBuffer _buffer;
    private readonly ManualIdleMonitor _monitor;
    private readonly Func<DateTimeOffset, string> _idGen;

    /// <summary>
    /// Fired after the timeout has closed the live entry, so the owner can re-read
    /// <see cref="TimeTracker"/>. The tray indicator is driven by <see cref="MenuViewModel"/>,
    /// which cannot see a stop performed directly on the tracker — without this the icon would
    /// keep reporting a session that policy already ended.
    /// </summary>
    private readonly Action _onTrackingStopped;

    public ManualIdleCoordinator(
        TimeTracker tracker,
        ITimeEntryBuffer buffer,
        int thresholdSeconds,
        Func<DateTimeOffset>? clock = null,
        Func<DateTimeOffset, string>? idGen = null,
        Action? onTrackingStopped = null)
    {
        _tracker = tracker;
        _buffer = buffer;
        _monitor = new ManualIdleMonitor(thresholdSeconds, clock);
        _idGen = idGen ?? (now => UuidV7.Generate(now));
        _onTrackingStopped = onTrackingStopped ?? (() => { });
        _monitor.Delegate = this;
    }

    public ManualIdleState MonitorState => _monitor.State;

    /// <summary>
    /// Sign-out / teardown. Nothing can be pending — a timeout disarms the monitor as it fires —
    /// so there is no half-resolved window to leak into the next session.
    /// </summary>
    public void Deactivate() => _monitor.Deactivate();

    public void Tick(int idleSeconds) => Route(() => _monitor.Tick(idleSeconds));

    public void MarkAway() => Route(_monitor.MarkAway);

    /// <summary>
    /// Waking or unlocking is not itself a signal to do anything: if the session timed out while
    /// the machine slept, the entry is already closed and the person restarts when they are ready.
    /// </summary>
    public void Resume()
    {
    }

    public void DidTimeOut(DateTimeOffset awayStart, DateTimeOffset stopInstant)
    {
        // Re-checked rather than assumed: the signal that triggered this was routed while a manual
        // session was live, but TimeTracker is the authority on what is running right now, and a
        // stop aimed at a session that already ended would close somebody else's span.
        if (_tracker.State is not TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual })
        {
            return;
        }

        _tracker.Stop(stopInstant);

        // The kept idle window, for the Idle panel. KEPT because that is what the timesheet says:
        // these minutes are ON the entry. The stretch after stopInstant is untracked and needs no
        // record — there is no time to account for.
        if (stopInstant > awayStart)
        {
            IdleEventEnqueuer.Enqueue(_buffer, _idGen(awayStart), awayStart, stopInstant, ResolvedAction.Kept);
        }

        _onTrackingStopped();
    }

    private bool IsManualSessionLive =>
        _tracker.State is TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual };

    /// <summary>
    /// Forward to the monitor only while a manual session is live, arming it lazily on the first
    /// manual signal. The guard is also what re-arms after a timeout: the timeout disarms the
    /// monitor and closes the entry, so nothing routes again until the person starts a new manual
    /// session.
    /// </summary>
    private void Route(Action forward)
    {
        if (!IsManualSessionLive)
        {
            return;
        }

        if (_monitor.State is ManualIdleState.Inactive)
        {
            _monitor.Activate();
        }

        forward();
    }
}
