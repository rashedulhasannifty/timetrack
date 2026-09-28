using NiftyTimer.Storage;
using NiftyTimer.Tracking;

namespace NiftyTimer.App;

/// <summary>
/// The manual-session sibling of <see cref="AutoTrackingCoordinator"/>. Fed the same
/// <see cref="SessionObserver"/> signals — via <see cref="FanOutSignalReceiver"/> in auto mode, or
/// alone in manual mode — it drives a <see cref="ManualIdleMonitor"/> and applies the keep/discard
/// effects, but ONLY while a MANUAL session is live.
///
/// It never stops a running manual timer on its own for an ordinary away window (CLAUDE.md §1 — a
/// manual entry is the user's own action). The only stop it performs for an ANSWERED window is the
/// trim the user explicitly chose by pressing Discard. Past <see cref="ManualIdleMonitor.AwayLimit"/>
/// there is nobody left to answer, so the one stop it performs unasked is that limit — and unlike
/// Discard it does not reopen a fresh entry, because nobody has said they are back. All callbacks
/// arrive on the UI thread.
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
    /// Fired after the away limit has closed the live entry outright (no replacement), so the
    /// owner can re-read <see cref="TimeTracker"/>. The tray indicator is driven by
    /// <see cref="MenuViewModel"/>, which cannot see a stop performed directly on the tracker.
    /// </summary>
    private readonly Action _onTrackingStopped;

    /// <summary>Fired once the away limit has closed the entry, so the owner can tell the person.</summary>
    private readonly Action<DateTimeOffset> _onAwayLimitExceeded;

    /// <summary>
    /// The entry the current away window belongs to. Guards Discard/limit and reconciliation
    /// against a session that ended or was replaced while the person was away.
    /// </summary>
    private string? _awayEntryId;

    /// <summary>
    /// The manual entry the monitor is currently armed for. See <see cref="ReconcileThenRoute"/> —
    /// without it a Stop/Start carries the previous session's arming instant into the new span,
    /// and with <see cref="ManualIdleMonitor.AwayLimit"/> clamping idleness to that instant, a
    /// stale arm could flag the FRESH entry as away for time that belongs to the old one.
    /// </summary>
    private string? _armedEntryId;

    public ManualIdleCoordinator(
        TimeTracker tracker,
        ITimeEntryBuffer buffer,
        int thresholdSeconds,
        Action<int, Action<AwayResolution>> presentAwayPrompt,
        Func<DateTimeOffset>? clock = null,
        Func<DateTimeOffset, string>? idGen = null,
        Action<DateTimeOffset>? onEntryReplaced = null,
        Action? dismissPrompt = null,
        Action? onTrackingStopped = null,
        Action<DateTimeOffset>? onAwayLimitExceeded = null,
        TimeSpan? awayLimit = null)
    {
        _tracker = tracker;
        _buffer = buffer;
        _monitor = new ManualIdleMonitor(thresholdSeconds, clock, awayLimit);
        _presentAwayPrompt = presentAwayPrompt;
        _idGen = idGen ?? (now => UuidV7.Generate(now));
        _onEntryReplaced = onEntryReplaced ?? (_ => { });
        _dismissPrompt = dismissPrompt ?? (() => { });
        _onTrackingStopped = onTrackingStopped ?? (() => { });
        _onAwayLimitExceeded = onAwayLimitExceeded ?? (_ => { });
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

                // The replacement opens at the return, not at the answer: the person was working
                // from then, and a prompt answered by policy is answered after they have left again.
                _tracker.Start(
                    tracking.Selection.ProjectId,
                    tracking.Selection.TaskId,
                    tracking.Selection.Note,
                    TimeTracker.EntrySource.Manual,
                    startTime: resume);
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

                    // Same session, so the monitor stays armed across the swap rather than
                    // re-arming on the replacement and forgetting an away window it has already begun.
                    _armedEntryId = fresh.EntryId;
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

    public void DidWithdrawPrompt() => _dismissPrompt();

    public void DidExceedAwayLimit(DateTimeOffset awayStart, DateTimeOffset detectedAt)
    {
        try
        {
            // Re-checked rather than assumed, exactly as Discard re-checks: the away window was
            // opened against this entry, but a stale one is UNRESOLVED, not DISCARDED — the same
            // rule Discard follows for the same reason.
            if (_tracker.State is TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual } tracking &&
                tracking.EntryId == _awayEntryId)
            {
                _tracker.Stop(awayStart);
                Enqueue(awayStart, detectedAt, ResolvedAction.Discarded);
                _onTrackingStopped();
                _onAwayLimitExceeded(awayStart);
            }
            else
            {
                Enqueue(awayStart, detectedAt, ResolvedAction.Unresolved);
            }
        }
        finally
        {
            _awayEntryId = null;
        }
    }

    private bool IsSameManualEntryLive =>
        _awayEntryId is not null &&
        _tracker.State is TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual } tracking &&
        tracking.EntryId == _awayEntryId;

    /// <summary>
    /// Guard and reconcile, then forward to the monitor only while a manual session is live.
    /// Arms the monitor lazily on the first manual signal.
    ///
    /// Arming is per ENTRY, not merely "whenever the monitor is inactive". The monitor stays armed
    /// through a Stop as long as no away cycle happened, so a Stop-then-Start would otherwise leave
    /// the NEW span measuring idleness from when the OLD one armed — and with the away limit
    /// clamping to that instant, a fresh entry could be flagged away for someone else's idle time
    /// on the very next tick. Re-arming on an entry-id change is the fix, and it costs nothing when
    /// the entry has not changed: <see cref="ManualIdleMonitor.Activate"/> only resets the arming
    /// instant.
    /// </summary>
    private void ReconcileThenRoute(Action forward)
    {
        ReconcileSessionEnd();
        if (_tracker.State is not TrackerState.Tracking { Source: TimeTracker.EntrySource.Manual } tracking)
        {
            return;
        }

        if (_monitor.State is IdleState.InactiveState || _armedEntryId != tracking.EntryId)
        {
            _monitor.Activate();
            _armedEntryId = tracking.EntryId;
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
