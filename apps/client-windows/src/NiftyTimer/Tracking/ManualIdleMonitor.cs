namespace NiftyTimer.Tracking;

/// <summary>
/// Whether a manual session is currently being watched for inactivity.
///
/// Two cases, not the four in <see cref="IdleState"/>. The away/awaiting pair existed to hold a
/// window open until the user answered a keep/discard prompt; the timeout answers it by policy, so
/// the monitor simply disarms. Disarming to <c>Inactive</c> rather than to a terminal state of its
/// own is what lets <see cref="App.ManualIdleCoordinator"/> re-arm on the next manual session
/// without a special case.
/// </summary>
public enum ManualIdleState
{
    Inactive,
    Active,
}

/// <summary>
/// The manual-session counterpart of <see cref="IdleMonitor"/>: it decides when inactivity has
/// gone on long enough that the manual timer must stop. UI/network/capture-free; the clock is
/// injected for deterministic tests.
///
/// Manual tracking used to run straight THROUGH an away window — the timer kept counting, and the
/// employee adjudicated the gap with a keep/discard prompt when they came back. Nobody comes back
/// from a PC left awake over a weekend, and an unanswered window was kept: a span could run for
/// days and make its start day report more tracked time than the day contains. Inactivity now
/// STOPS the timer at the team's idle threshold, the way Time Doctor's "Timeout After" setting
/// does, so unattended time is bounded by policy rather than by someone remembering to press Stop.
///
/// The minutes between input stopping and the timeout are KEPT on the entry and recorded as an
/// idle window: they are as likely to be a call or a long read as an empty chair, and the Idle
/// panel is where that shows. Everything after the timeout is simply untracked — there is nothing
/// left to adjudicate, so there is no prompt on return and the person restarts the timer
/// themselves. Starting is theirs to do (CLAUDE.md §1); running unattended for two days is not.
///
/// This mirrors the macOS client's <c>ManualIdleMonitor</c> exactly, so the same policy closes the
/// same span in the same place whichever client an employee is on.
/// </summary>
public interface IManualIdleMonitorDelegate
{
    /// <summary>
    /// Inactivity reached the timeout. Close the manual entry at <paramref name="stopInstant"/>
    /// and record <c>[awayStart, stopInstant]</c> as an idle window.
    ///
    /// For the inactivity path <paramref name="stopInstant"/> is
    /// <paramref name="awayStart"/> + threshold. For sleep/lock it is
    /// <paramref name="awayStart"/> itself: the moment input stopped is known exactly there, so
    /// there are no unknown idle minutes to keep and none are invented.
    /// </summary>
    void DidTimeOut(DateTimeOffset awayStart, DateTimeOffset stopInstant);
}

/// <summary>The manual-session decision machine. See <see cref="IManualIdleMonitorDelegate"/>.</summary>
public sealed class ManualIdleMonitor
{
    private readonly int _thresholdSeconds;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>
    /// When this session was armed. The OS idle counter keeps running across a Stop/Start, so a
    /// reading taken just after arming describes inactivity that happened BEFORE the session and
    /// is not the session's to answer for — without this, a span could be closed by policy the
    /// instant someone opened it.
    /// </summary>
    private DateTimeOffset? _armedAt;

    public ManualIdleMonitor(int thresholdSeconds, Func<DateTimeOffset>? clock = null)
    {
        _thresholdSeconds = thresholdSeconds;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public IManualIdleMonitorDelegate? Delegate { get; set; }

    public ManualIdleState State { get; private set; } = ManualIdleState.Inactive;

    /// <summary>
    /// Arm the monitor. Unlike <see cref="IdleMonitor.Activate"/> there is no start-tracking side
    /// effect — the manual timer is started by the user, not by this monitor.
    /// </summary>
    public void Activate()
    {
        State = ManualIdleState.Active;
        _armedAt = _clock();
    }

    /// <summary>
    /// Tear down. Nothing can be pending by construction — a timeout disarms as it fires — so this
    /// reports nothing and simply disarms.
    /// </summary>
    public void Deactivate() => Disarm();

    /// <summary>
    /// Periodic idle sample. Inactivity reaching the threshold times the session out.
    ///
    /// The stop lands at <c>awayStart + threshold</c>, NOT at the tick that noticed. The poller
    /// runs on its own cadence and a reading can overshoot, so deriving the instant from the
    /// threshold keeps the entry's end independent of when the timer happened to fire — two PCs on
    /// the same policy close the same span in the same place.
    /// </summary>
    public void Tick(int idleSeconds)
    {
        if (State is not ManualIdleState.Active || _armedAt is not { } armedAt)
        {
            return;
        }

        var now = _clock();

        // Clamped to the arming instant: idleness inherited from before this session doesn't count.
        var sinceInput = now.AddSeconds(-idleSeconds);
        var awayStart = sinceInput > armedAt ? sinceInput : armedAt;

        if (now - awayStart < TimeSpan.FromSeconds(_thresholdSeconds))
        {
            return;
        }

        TimeOut(awayStart, awayStart.AddSeconds(_thresholdSeconds));
    }

    /// <summary>
    /// System sleep or screen lock: input demonstrably stopped NOW. Don't wait for the threshold,
    /// and don't credit threshold-worth of idle that provably did not happen — a locked screen is
    /// not a long read. The entry ends where the input did.
    /// </summary>
    public void MarkAway()
    {
        if (State is not ManualIdleState.Active)
        {
            return;
        }

        var now = _clock();
        TimeOut(now, now);
    }

    private void TimeOut(DateTimeOffset awayStart, DateTimeOffset stopInstant)
    {
        Disarm();
        Delegate?.DidTimeOut(awayStart, stopInstant);
    }

    private void Disarm()
    {
        State = ManualIdleState.Inactive;
        _armedAt = null;
    }
}
