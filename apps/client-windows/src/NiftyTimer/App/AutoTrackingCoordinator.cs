using NiftyTimer.Storage;
using NiftyTimer.Tracking;

namespace NiftyTimer.App;

/// <summary>
/// PRD §6.1 — bridges <see cref="IdleMonitor"/> decisions to <see cref="TimeTracker"/> writes and
/// IdleEvent records. It owns no capture hardware and performs no policy check of its own:
/// activation is gated upstream in <see cref="AppDelegate"/> behind
/// <see cref="Policy.AckGate"/>, because auto-tracking watches the person continuously and is a
/// capture path under CLAUDE.md §1. The <see cref="SessionObserver"/> calls
/// <see cref="Tick"/>/<see cref="MarkAway"/>/<see cref="Resume"/>; this type forwards them.
///
/// All callbacks arrive on the UI thread (the observer's <c>DispatcherTimer</c> and its window
/// messages), so <see cref="TimeTracker"/> is only ever touched from the UI thread.
/// </summary>
public sealed class AutoTrackingCoordinator : IIdleMonitorDelegate, ISignalReceiver
{
    private readonly TimeTracker _tracker;
    private readonly ITimeEntryBuffer _buffer;
    private readonly IdleMonitor _monitor;
    private readonly Func<TimeTracker.Selection> _currentSelection;
    private readonly Action<int, Action<AwayResolution>> _presentAwayPrompt;
    private readonly Func<DateTimeOffset, string> _idGen;
    private readonly Action<int> _onIdleThresholdCrossed;
    private readonly Action _onTrackingStateChanged;

    public AutoTrackingCoordinator(
        TimeTracker tracker,
        ITimeEntryBuffer buffer,
        int thresholdSeconds,
        Func<TimeTracker.Selection> currentSelection,
        Action<int, Action<AwayResolution>> presentAwayPrompt,
        Func<DateTimeOffset>? clock = null,
        Func<DateTimeOffset, string>? idGen = null,
        Action<int>? onIdleThresholdCrossed = null,
        Action? onTrackingStateChanged = null)
    {
        _tracker = tracker;
        _buffer = buffer;
        _monitor = new IdleMonitor(thresholdSeconds, clock);
        _currentSelection = currentSelection;
        _presentAwayPrompt = presentAwayPrompt;
        _idGen = idGen ?? (now => UuidV7.Generate(now));
        _onIdleThresholdCrossed = onIdleThresholdCrossed ?? (_ => { });
        _onTrackingStateChanged = onTrackingStateChanged ?? (() => { });
        _monitor.Delegate = this;
    }

    public IdleState MonitorState => _monitor.State;

    /// <summary>
    /// The auto layer stands down entirely while the employee is in a MANUAL session: a manually
    /// started entry is the user's own action and must never be auto-stopped or bridged.
    ///
    /// Gating the system-edge forwarders is the single mechanism — the monitor receives no signals
    /// at all during a manual span, so there is no away cycle, no spurious IdleEvent, and no stop.
    ///
    /// Paused counts as manual: pause/resume is a manual-only affordance (resume reopens as
    /// MANUAL), so a paused span is a manual session the auto layer must not clobber. Without this,
    /// an away→resume cycle could resolve and open an AUTO entry over the paused state —
    /// <see cref="TimeTracker.Start"/> only guards against a second start while already tracking.
    /// </summary>
    private bool IsManualSessionLive => _tracker.State switch
    {
        TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual } => true,
        TrackerState.Paused => true,
        _ => false,
    };

    // Lifecycle — called by AppDelegate, already behind the AckGate.
    public void Activate() => _monitor.Activate();

    public void Deactivate() => _monitor.Deactivate();

    // System-edge forwarders. No-ops during a manual session.
    public void Tick(int idleSeconds)
    {
        if (!IsManualSessionLive)
        {
            _monitor.Tick(idleSeconds);
        }
    }

    public void MarkAway()
    {
        if (!IsManualSessionLive)
        {
            _monitor.MarkAway();
        }
    }

    public void Resume()
    {
        if (!IsManualSessionLive)
        {
            _monitor.Resume();
        }
    }

    // Both transitions notify. AUTO writes straight to the tracker, which nothing else observes,
    // so without this the always-visible indicator (PRD §4.2) reads "idle" for the whole
    // login-to-first-idle AUTO span and stays "tracking" after an auto-stop. Notifying on start
    // alone leaves the icon stuck the other way, which is why both are here and both are tested.
    public void ShouldStartTracking()
    {
        var selection = _currentSelection();
        _tracker.Start(selection.ProjectId, selection.TaskId, source: TimeTracker.EntrySource.Auto);
        _onTrackingStateChanged();
    }

    public void ShouldStopTracking(DateTimeOffset awayStart)
    {
        _tracker.Stop(awayStart);
        _onTrackingStateChanged();
    }

    public void DidBecomeAway(int seconds) =>
        _presentAwayPrompt(AwayMinutes.Of(seconds), action => _monitor.Resolve(action));

    public void DidResolveAway(DateTimeOffset awayStart, DateTimeOffset resume, bool keeping)
    {
        if (keeping)
        {
            var selection = _currentSelection();
            _tracker.RecordSpan(
                awayStart,
                resume,
                selection.ProjectId,
                selection.TaskId,
                TimeTracker.EntrySource.Auto);
        }

        Enqueue(awayStart, resume, keeping ? ResolvedAction.Kept : ResolvedAction.Discarded);
    }

    public void DidAbandonAway(DateTimeOffset awayStart, DateTimeOffset lastKnown) =>
        Enqueue(awayStart, lastKnown, ResolvedAction.Unresolved);

    public void DidCrossIdleThreshold(int seconds) => _onIdleThresholdCrossed(seconds);

    private void Enqueue(DateTimeOffset from, DateTimeOffset to, ResolvedAction action) =>
        IdleEventEnqueuer.Enqueue(_buffer, _idGen(from), from, to, action);
}
