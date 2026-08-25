namespace NiftyTimer.Tracking;

/// <summary>
/// PRD §6.1/§6.4 — the pure automatic-tracking state machine. It never touches UI, network, or
/// capture hardware; a thin <see cref="SessionObserver"/> feeds it idle seconds plus sleep/lock
/// signals, and an <see cref="App.AutoTrackingCoordinator"/> (its delegate) turns decisions into
/// TimeEntry/IdleEvent writes. <c>clock</c> is injected for deterministic tests.
///
/// Reconciliation is client-authoritative: on idle the current AUTO entry is stopped at the
/// away-start (idle excluded); on resume the user keeps or discards the away window. This unit
/// only <i>decides</i>; the delegate performs the writes.
/// </summary>
public interface IIdleMonitorDelegate
{
    /// <summary>Begin a fresh AUTO tracking span now (on activation and after each resolution).</summary>
    void ShouldStartTracking();

    /// <summary>Close the current AUTO span at <paramref name="awayStart"/> (threshold, or sleep/lock).</summary>
    void ShouldStopTracking(DateTimeOffset awayStart);

    /// <summary>
    /// The user returned after being away; present the keep/discard prompt. The delegate must
    /// eventually call <see cref="IdleMonitor.Resolve"/>.
    /// </summary>
    void DidBecomeAway(int seconds);

    /// <summary>
    /// The away window [awayStart, resume] was resolved. <paramref name="keeping"/> → KEPT
    /// (bridge it), else DISCARDED.
    /// </summary>
    void DidResolveAway(DateTimeOffset awayStart, DateTimeOffset resume, bool keeping);

    /// <summary>Torn down while still away/awaiting — record UNRESOLVED, no bridge.</summary>
    void DidAbandonAway(DateTimeOffset awayStart, DateTimeOffset lastKnown);

    /// <summary>
    /// Idle crossed the threshold via inactivity (the <see cref="IdleMonitor.Tick"/> path only —
    /// NOT sleep/lock). Drives the local idle nudge; defaulted so conformers need no change.
    /// </summary>
    void DidCrossIdleThreshold(int seconds)
    {
    }
}

/// <summary>The automatic-tracking decision machine. See <see cref="IIdleMonitorDelegate"/>.</summary>
public sealed class IdleMonitor
{
    private readonly int _thresholdSeconds;
    private readonly Func<DateTimeOffset> _clock;

    public IdleMonitor(int thresholdSeconds, Func<DateTimeOffset>? clock = null)
    {
        _thresholdSeconds = thresholdSeconds;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public IIdleMonitorDelegate? Delegate { get; set; }

    public IdleState State { get; private set; } = IdleState.Inactive;

    /// <summary>Start (or restart) the auto session.</summary>
    public void Activate()
    {
        State = IdleState.Active;
        Delegate?.ShouldStartTracking();
    }

    /// <summary>Tear down; if still away/awaiting, the window is recorded UNRESOLVED.</summary>
    public void Deactivate()
    {
        switch (State)
        {
            case IdleState.Away away:
                Delegate?.DidAbandonAway(away.Since, _clock());
                break;
            case IdleState.Awaiting awaiting:
                Delegate?.DidAbandonAway(awaiting.Since, awaiting.Until);
                break;
            default:
                break;
        }

        State = IdleState.Inactive;
    }

    /// <summary>
    /// Periodic idle sample (seconds since last input). Drives active→away at the threshold and
    /// away→awaiting when input resumes (a reading back below the threshold).
    /// </summary>
    public void Tick(int idleSeconds)
    {
        switch (State)
        {
            case IdleState.ActiveState when idleSeconds >= _thresholdSeconds:
                var awayStart = _clock().AddSeconds(-idleSeconds);
                State = new IdleState.Away(awayStart);
                Delegate?.ShouldStopTracking(awayStart);
                Delegate?.DidCrossIdleThreshold(idleSeconds);
                break;

            case IdleState.Away away when idleSeconds < _thresholdSeconds:
                TransitionToAwaiting(away.Since);
                break;

            default:
                break;
        }
    }

    /// <summary>System sleep or screen lock: input demonstrably stopped now (don't wait for the threshold).</summary>
    public void MarkAway()
    {
        if (State is not IdleState.ActiveState)
        {
            return;
        }

        var awayStart = _clock();
        State = new IdleState.Away(awayStart);
        Delegate?.ShouldStopTracking(awayStart);
    }

    /// <summary>
    /// Explicit resume signal (wake/unlock). The tick path also transitions away→awaiting on its
    /// own once a below-threshold reading arrives.
    /// </summary>
    public void Resume()
    {
        if (State is IdleState.Away away)
        {
            TransitionToAwaiting(away.Since);
        }
    }

    /// <summary>The user's keep/discard choice for the pending away window; restarts tracking.</summary>
    public void Resolve(AwayResolution action)
    {
        if (State is not IdleState.Awaiting awaiting)
        {
            return;
        }

        Delegate?.DidResolveAway(awaiting.Since, awaiting.Until, action == AwayResolution.Keep);
        State = IdleState.Active;
        Delegate?.ShouldStartTracking();
    }

    private void TransitionToAwaiting(DateTimeOffset since)
    {
        var resumeAt = _clock();
        State = new IdleState.Awaiting(since, resumeAt);
        Delegate?.DidBecomeAway((int)(resumeAt - since).TotalSeconds);
    }
}
