using NiftyTimer.Storage;
using NiftyTimer.Tracking;

namespace NiftyTimer.App;

/// <summary>
/// The manual-session sibling of <see cref="AutoTrackingCoordinator"/>. Fed the same
/// <see cref="SessionObserver"/> signals — via <see cref="FanOutSignalReceiver"/> in auto mode, or
/// alone in manual mode — it drives a <see cref="ManualIdleMonitor"/> and applies the keep/discard
/// effects, but ONLY while a MANUAL session is live.
///
/// It never stops a running manual timer on its own (CLAUDE.md §1 — a manual entry is the user's
/// own action). The only stop it performs is the trim the user explicitly chose by pressing
/// Discard. All callbacks arrive on the UI thread.
/// </summary>
public sealed class ManualIdleCoordinator : IManualIdleMonitorDelegate, ISignalReceiver
{
    private readonly TimeTracker _tracker;
    private readonly ITimeEntryBuffer _buffer;
    private readonly ManualIdleMonitor _monitor;
    private readonly Action<int, Action<AwayResolution>> _presentAwayPrompt;
    private readonly Func<DateTimeOffset, string> _idGen;
    private readonly Action _dismissPrompt;

    /// <summary>
    /// Fired after Discard has replaced the live entry, carrying the instant the display clock
    /// should count from. Only Discard fires it; Keep and unresolved leave the live entry alone.
    /// </summary>
    private readonly Action<DateTimeOffset> _onEntryReplaced;

    /// <summary>
    /// The entry the current away window belongs to. Guards Discard and reconciliation against a
    /// session that ended or was replaced while the person was away.
    /// </summary>
    private string? _awayEntryId;

    public ManualIdleCoordinator(
        TimeTracker tracker,
        ITimeEntryBuffer buffer,
        int thresholdSeconds,
        Action<int, Action<AwayResolution>> presentAwayPrompt,
        Func<DateTimeOffset>? clock = null,
        Func<DateTimeOffset, string>? idGen = null,
        Action<DateTimeOffset>? onEntryReplaced = null,
        Action? dismissPrompt = null)
    {
        _tracker = tracker;
        _buffer = buffer;
        _monitor = new ManualIdleMonitor(thresholdSeconds, clock);
        _presentAwayPrompt = presentAwayPrompt;
        _idGen = idGen ?? (now => UuidV7.Generate(now));
        _onEntryReplaced = onEntryReplaced ?? (_ => { });
        _dismissPrompt = dismissPrompt ?? (() => { });
        _monitor.Delegate = this;
    }

    public IdleState MonitorState => _monitor.State;

    /// <summary>
    /// Sign-out / teardown: record any pending away as UNRESOLVED (no trim). The caller dismisses
    /// the prompt AFTER this, so its resolve is a no-op on the now-inactive monitor.
    /// </summary>
    public void Deactivate() => _monitor.Deactivate();

    public void Tick(int idleSeconds) => ReconcileThenRoute(() => _monitor.Tick(idleSeconds));

    public void MarkAway() => ReconcileThenRoute(_monitor.MarkAway);

    public void Resume() => ReconcileThenRoute(_monitor.Resume);

    public void DidBeginAway(DateTimeOffset awayStart)
    {
        if (_tracker.State is TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual } tracking)
        {
            _awayEntryId = tracking.EntryId;
        }
    }

    public void DidBecomeAway(int seconds) =>
        _presentAwayPrompt(AwayMinutes.Of(seconds), action => _monitor.Resolve(action));

    public void DidResolveAway(DateTimeOffset awayStart, DateTimeOffset resume, bool keeping)
    {
        try
        {
            if (keeping)
            {
                // Keep needs no write: the manual entry ran straight through the away window and
                // already covers it. Only the record of what was decided is enqueued.
                Enqueue(awayStart, resume, ResolvedAction.Kept);
                return;
            }

            // Discard: trim ONLY if the same manual entry is still running.
            if (_tracker.State is TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual } tracking &&
                tracking.EntryId == _awayEntryId)
            {
                _tracker.Stop(awayStart);
                _tracker.Start(
                    tracking.Selection.ProjectId,
                    tracking.Selection.TaskId,
                    tracking.Selection.Note,
                    TimeTracker.EntrySource.Manual);
                Enqueue(awayStart, resume, ResolvedAction.Discarded);

                // Tell the display clock to keep reading accumulated WORKED time. The fresh entry's
                // real start would read zero, and a timer that jumps back to 0:00 the moment you
                // answer a prompt looks exactly like the app having thrown your morning away.
                //
                // Computed here, from both spans, rather than handing the owner a gap to apply to
                // whatever it thinks the start is: the macOS original works only because its view
                // model happens to still hold the PRE-swap start when the callback lands, which is
                // a property of publish timing and not of anything anyone wrote down.
                if (_tracker.State is TrackerState.Tracking fresh)
                {
                    var workedBeforeAway = awayStart - tracking.StartedAt;
                    _onEntryReplaced(fresh.StartedAt - workedBeforeAway);
                }
            }
            else
            {
                Enqueue(awayStart, resume, ResolvedAction.Unresolved);
            }
        }
        finally
        {
            _awayEntryId = null;
        }
    }

    public void DidAbandonAway(DateTimeOffset awayStart, DateTimeOffset lastKnown)
    {
        Enqueue(awayStart, lastKnown, ResolvedAction.Unresolved);
        _awayEntryId = null;
    }

    private bool IsManualSessionLive =>
        _tracker.State is TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual };

    private bool IsSameManualEntryLive =>
        _awayEntryId is not null &&
        _tracker.State is TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual } tracking &&
        tracking.EntryId == _awayEntryId;

    /// <summary>
    /// Guard and reconcile, then forward to the monitor only while a manual session is live and
    /// armed. Arms the monitor lazily on the first manual signal.
    /// </summary>
    private void ReconcileThenRoute(Action forward)
    {
        ReconcileSessionEnd();
        if (!IsManualSessionLive)
        {
            return;
        }

        if (_monitor.State is IdleState.InactiveState)
        {
            _monitor.Activate();
        }

        forward();
    }

    /// <summary>
    /// If the monitor is mid-cycle but the away entry is no longer the live manual entry — the
    /// person hit Stop or Pause while away, or stopped and started something different — abandon
    /// the window: record UNRESOLVED and dismiss any prompt still on screen.
    ///
    /// This is the integrity guard. Without it, answering a stale prompt would trim an entry the
    /// away window never belonged to.
    /// </summary>
    private void ReconcileSessionEnd()
    {
        if (_monitor.State is (IdleState.Away or IdleState.Awaiting) && !IsSameManualEntryLive)
        {
            _monitor.Deactivate(); // → DidAbandonAway → UNRESOLVED
            _dismissPrompt();
        }
    }

    private void Enqueue(DateTimeOffset from, DateTimeOffset to, ResolvedAction action) =>
        IdleEventEnqueuer.Enqueue(_buffer, _idGen(from), from, to, action);
}
