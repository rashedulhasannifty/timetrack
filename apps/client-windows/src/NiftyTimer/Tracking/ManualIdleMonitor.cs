namespace NiftyTimer.Tracking;

/// <summary>
/// The manual-session counterpart of <see cref="IdleMonitor"/>. Same state shape, but manual
/// semantics: going away does NOT stop the timer (a manual entry is the user's own action —
/// CLAUDE.md §1), and resolving does NOT auto-open a new span — the
/// <see cref="App.ManualIdleCoordinator"/> performs the keep/discard effects.
///
/// One exception to "going away never stops the timer": <see cref="AwayLimit"/>. Nobody comes
/// back from a PC left awake over a weekend, and an away window is otherwise open-ended — kept or
/// discarded only once the person answers a prompt that may never come. Past the limit there is
/// nobody left to ask, so the entry stops itself at <c>awayStart</c> (none of the away time
/// counts) and the person restarts the clock themselves.
/// </summary>
public interface IManualIdleMonitorDelegate
{
    /// <summary>
    /// Idle threshold crossed (or sleep/lock). The timer keeps running; the coordinator snapshots
    /// which entry the away window belongs to.
    /// </summary>
    void DidBeginAway(DateTimeOffset awayStart);

    /// <summary>
    /// Input resumed after being away, within <see cref="AwayLimit"/> — present the keep/discard
    /// prompt. The delegate must eventually call <see cref="ManualIdleMonitor.Resolve"/>.
    /// </summary>
    void DidBecomeAway(int seconds);

    /// <summary>The away window was resolved. <paramref name="keeping"/> → count it; else discard.</summary>
    void DidResolveAway(DateTimeOffset awayStart, DateTimeOffset resume, bool keeping);

    /// <summary>Torn down while still away/awaiting — record UNRESOLVED, no trim.</summary>
    void DidAbandonAway(DateTimeOffset awayStart, DateTimeOffset lastKnown);

    /// <summary>
    /// Away ran past <see cref="AwayLimit"/> without ever resolving — nobody came back to answer a
    /// prompt. Stop the manual entry at <paramref name="awayStart"/> (none of the away time
    /// counts), record the window DISCARDED up to <paramref name="detectedAt"/> (the instant the
    /// limit was noticed — a tick, or the wake that follows a sleep long enough to blow through it
    /// on its own), and tell the person their timer stopped.
    /// </summary>
    void DidExceedAwayLimit(DateTimeOffset awayStart, DateTimeOffset detectedAt);

    /// <summary>
    /// The open prompt is being answered by policy: the person went away again without answering
    /// it. Close it. Its own answer on close arrives after the monitor has moved on and is ignored.
    /// </summary>
    void DidWithdrawPrompt();
}

/// <summary>The manual-session decision machine. See <see cref="IManualIdleMonitorDelegate"/>.</summary>
public sealed class ManualIdleMonitor
{
    /// <summary>
    /// How long an away window may sit unanswered before the entry stops itself. Fixed rather than
    /// policy-driven — unlike the idle threshold, this is a client-side backstop, not a team
    /// setting. Injectable so tests do not wait an hour.
    /// </summary>
    public static readonly TimeSpan AwayLimit = TimeSpan.FromMinutes(60);

    private readonly int _thresholdSeconds;
    private readonly TimeSpan _awayLimit;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>
    /// When this session was armed. The OS idle counter keeps running across a Stop/Start, so a
    /// reading taken just after arming can describe inactivity that happened BEFORE the session —
    /// clamping to this instant keeps a fresh entry from being flagged away for someone else's
    /// idle time. See <see cref="App.ManualIdleCoordinator"/>'s per-entry re-arming, which is what
    /// keeps this instant fresh across a Stop/Start.
    /// </summary>
    private DateTimeOffset? _armedAt;

    public ManualIdleMonitor(int thresholdSeconds, Func<DateTimeOffset>? clock = null, TimeSpan? awayLimit = null)
    {
        _thresholdSeconds = thresholdSeconds;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _awayLimit = awayLimit ?? AwayLimit;
    }

    public IManualIdleMonitorDelegate? Delegate { get; set; }

    public IdleState State { get; private set; } = IdleState.Inactive;

    /// <summary>
    /// Arm the monitor. Unlike <see cref="IdleMonitor.Activate"/> there is no start-tracking side
    /// effect — the manual timer is started by the user, not by this monitor.
    /// </summary>
    public void Activate()
    {
        State = IdleState.Active;
        _armedAt = _clock();
    }

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

        Disarm();
    }

    /// <summary>
    /// Periodic idle sample. active→away at the threshold (NO stop, clamped to when this session
    /// armed); away→timed-out past <see cref="AwayLimit"/>; away→awaiting on a below-threshold
    /// reading within the limit.
    /// </summary>
    public void Tick(int idleSeconds)
    {
        var now = _clock();

        switch (State)
        {
            case IdleState.ActiveState when _armedAt is { } armedAt:
                // Clamped to the arming instant: idleness inherited from before this session was
                // armed is not this session's to answer for.
                var sinceInput = now.AddSeconds(-idleSeconds);
                var awayStart = sinceInput > armedAt ? sinceInput : armedAt;
                if (now - awayStart >= TimeSpan.FromSeconds(_thresholdSeconds))
                {
                    State = new IdleState.Away(awayStart);
                    Delegate?.DidBeginAway(awayStart);
                }

                break;

            case IdleState.Away away when now - away.Since >= _awayLimit:
                ExceedLimit(away.Since, now);
                break;

            case IdleState.Away away when idleSeconds < _thresholdSeconds:
                TransitionToAwaiting(away.Since, now);
                break;

            case IdleState.Awaiting awaiting when idleSeconds >= _thresholdSeconds:
                // Back, prompt unanswered, and gone again — the end of the day with the prompt
                // still up. Left waiting, the timer would run until the 12h cap: the very overnight
                // entry the limit exists to stop. The second absence starts where input stopped,
                // never before the return that opened the prompt.
                var inputStopped = now.AddSeconds(-idleSeconds);
                WithdrawPrompt(awaiting);
                BeginAway(inputStopped > awaiting.Until ? inputStopped : awaiting.Until);
                break;

            default:
                break;
        }
    }

    /// <summary>System sleep / screen lock: away now (don't wait for the threshold). Still no stop.</summary>
    public void MarkAway()
    {
        if (State is IdleState.Awaiting awaiting)
        {
            WithdrawPrompt(awaiting);
        }

        if (State is not IdleState.ActiveState)
        {
            return;
        }

        BeginAway(_clock());
    }

    /// <summary>
    /// Explicit resume (wake/unlock). The tick path also transitions away→awaiting (or times out)
    /// on its own, but sleep can outlast <see cref="AwayLimit"/> with no tick ever firing — the
    /// poller is paused for the duration — so wake is where a long sleep's limit is caught.
    /// </summary>
    public void Resume()
    {
        if (State is not IdleState.Away away)
        {
            return;
        }

        var now = _clock();
        if (now - away.Since >= _awayLimit)
        {
            ExceedLimit(away.Since, now);
        }
        else
        {
            TransitionToAwaiting(away.Since, now);
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

    /// <summary>
    /// Answer the open prompt with its default, Discard, and close it. The state leaves Awaiting
    /// BEFORE the prompt is closed, so the prompt's own answer on close is a no-op.
    /// </summary>
    private void WithdrawPrompt(IdleState.Awaiting awaiting)
    {
        State = IdleState.Active;
        Delegate?.DidWithdrawPrompt();
        Delegate?.DidResolveAway(awaiting.Since, awaiting.Until, keeping: false);
    }

    private void BeginAway(DateTimeOffset awayStart)
    {
        State = new IdleState.Away(awayStart);
        Delegate?.DidBeginAway(awayStart);
    }

    private void TransitionToAwaiting(DateTimeOffset since, DateTimeOffset resumeAt)
    {
        State = new IdleState.Awaiting(since, resumeAt);
        Delegate?.DidBecomeAway((int)(resumeAt - since).TotalSeconds);
    }

    private void ExceedLimit(DateTimeOffset since, DateTimeOffset detectedAt)
    {
        Disarm();
        Delegate?.DidExceedAwayLimit(since, detectedAt);
    }

    private void Disarm()
    {
        State = IdleState.Inactive;
        _armedAt = null;
    }
}
