namespace NiftyTimer.Tracking;

/// <summary>
/// The manual-session counterpart of <see cref="IdleMonitor"/>. Same state shape, but manual
/// semantics: going away does NOT stop the timer (a manual entry is the user's own action —
/// CLAUDE.md §1), and resolving does NOT auto-open a new span — the
/// <see cref="App.ManualIdleCoordinator"/> performs the keep/discard effects.
/// </summary>
public interface IManualIdleMonitorDelegate
{
    /// <summary>
    /// Idle threshold crossed (or sleep/lock). The timer keeps running; the coordinator snapshots
    /// which entry the away window belongs to.
    /// </summary>
    void DidBeginAway(DateTimeOffset awayStart);

    /// <summary>
    /// Input resumed after being away — present the keep/discard prompt. The delegate must
    /// eventually call <see cref="ManualIdleMonitor.Resolve"/>.
    /// </summary>
    void DidBecomeAway(int seconds);

    /// <summary>The away window was resolved. <paramref name="keeping"/> → count it; else discard.</summary>
    void DidResolveAway(DateTimeOffset awayStart, DateTimeOffset resume, bool keeping);

    /// <summary>Torn down while still away/awaiting — record UNRESOLVED, no trim.</summary>
    void DidAbandonAway(DateTimeOffset awayStart, DateTimeOffset lastKnown);
}

/// <summary>The manual-session decision machine. See <see cref="IManualIdleMonitorDelegate"/>.</summary>
public sealed class ManualIdleMonitor
{
    private readonly int _thresholdSeconds;
    private readonly Func<DateTimeOffset> _clock;

    public ManualIdleMonitor(int thresholdSeconds, Func<DateTimeOffset>? clock = null)
    {
        _thresholdSeconds = thresholdSeconds;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public IManualIdleMonitorDelegate? Delegate { get; set; }

    public IdleState State { get; private set; } = IdleState.Inactive;

    /// <summary>
    /// Arm the monitor. Unlike <see cref="IdleMonitor.Activate"/> there is no start-tracking side
    /// effect — the manual timer is started by the user, not by this monitor.
    /// </summary>
    public void Activate() => State = IdleState.Active;

    /// <summary>Tear down; if still away/awaiting, record UNRESOLVED.</summary>
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

    /// <summary>Periodic idle sample. active→away at the threshold (NO stop); away→awaiting on resume.</summary>
    public void Tick(int idleSeconds)
    {
        switch (State)
        {
            case IdleState.ActiveState when idleSeconds >= _thresholdSeconds:
                var awayStart = _clock().AddSeconds(-idleSeconds);
                State = new IdleState.Away(awayStart);
                Delegate?.DidBeginAway(awayStart);
                break;

            case IdleState.Away away when idleSeconds < _thresholdSeconds:
                TransitionToAwaiting(away.Since);
                break;

            default:
                break;
        }
    }

    /// <summary>System sleep / screen lock: away now (don't wait for the threshold). Still no stop.</summary>
    public void MarkAway()
    {
        if (State is not IdleState.ActiveState)
        {
            return;
        }

        var awayStart = _clock();
        State = new IdleState.Away(awayStart);
        Delegate?.DidBeginAway(awayStart);
    }

    /// <summary>Explicit resume (wake/unlock); the tick path also transitions away→awaiting on its own.</summary>
    public void Resume()
    {
        if (State is IdleState.Away away)
        {
            TransitionToAwaiting(away.Since);
        }
    }

    /// <summary>
    /// The user's keep/discard choice. Returns to Active (re-armed) WITHOUT opening a span — the
    /// coordinator applies the effect.
    /// </summary>
    public void Resolve(AwayResolution action)
    {
        if (State is not IdleState.Awaiting awaiting)
        {
            return;
        }

        Delegate?.DidResolveAway(awaiting.Since, awaiting.Until, action == AwayResolution.Keep);
        State = IdleState.Active;
    }

    private void TransitionToAwaiting(DateTimeOffset since)
    {
        var resumeAt = _clock();
        State = new IdleState.Awaiting(since, resumeAt);
        Delegate?.DidBecomeAway((int)(resumeAt - since).TotalSeconds);
    }
}
