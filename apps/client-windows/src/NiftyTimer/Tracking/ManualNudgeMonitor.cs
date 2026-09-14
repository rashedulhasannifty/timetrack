using System.Globalization;
using NiftyTimer.Notifications;

namespace NiftyTimer.Tracking;

/// <summary>
/// The manual-mode (<c>autoStartOnLogin = false</c>) nudge decider. It reads the SAME content-free
/// idle scalar as <see cref="SessionObserver"/> and, purely locally, chooses between two
/// mutually-exclusive-by-tracker-state notifications, both NOTIFY-ONLY:
///
/// <list type="bullet">
///   <item><b>forgot-to-start</b> — present and not tracking for <c>forgotToStartSeconds</c> → "start?"</item>
///   <item><b>manual idle</b> — a manual clock is live and idle ≥ threshold → "still tracking?"</item>
/// </list>
///
/// The manual-idle nudge NEVER stops the clock (CLAUDE.md §1 — a manual entry is the user's own
/// action). This type holds no reference to <see cref="TimeTracker"/> or any monitor, only two
/// predicates, so it structurally cannot produce a stop or a spurious IdleEvent.
///
/// Auto mode installs a second instance as its own forgot-to-start reminder, as the macOS client
/// does: <c>presentForgotToStart</c> raises a window instead of a balloon (a stopped clock in auto
/// mode is a fault, not a hint), <c>emitsManualIdleNudge</c> is off because the auto coordinator
/// already owns the idle nudge, and <c>isAwaitingResolution</c> stands it down while an away prompt
/// is already asking the person to act.
/// </summary>
public sealed class ManualNudgeMonitor
{
    private readonly ILocalNotifier _notifier;
    private readonly int _idleThresholdSeconds;
    private readonly int _forgotToStartSeconds;
    private readonly Func<bool> _isTracking;
    private readonly Func<bool> _isPaused;
    private readonly Action<string, string>? _presentForgotToStart;
    private readonly bool _emitsManualIdleNudge;
    private readonly Func<bool> _isAwaitingResolution;

    private DateTimeOffset? _activeSince;
    private bool _firedForgot;
    private bool _firedManualIdle;

    public ManualNudgeMonitor(
        ILocalNotifier notifier,
        int idleThresholdSeconds,
        int forgotToStartSeconds,
        Func<bool> isTracking,
        Func<bool> isPaused,
        Action<string, string>? presentForgotToStart = null,
        bool emitsManualIdleNudge = true,
        Func<bool>? isAwaitingResolution = null)
    {
        _notifier = notifier;
        _idleThresholdSeconds = idleThresholdSeconds;
        _forgotToStartSeconds = forgotToStartSeconds;
        _isTracking = isTracking;
        _isPaused = isPaused;
        _presentForgotToStart = presentForgotToStart;
        _emitsManualIdleNudge = emitsManualIdleNudge;
        _isAwaitingResolution = isAwaitingResolution ?? (static () => false);
    }

    public void Reset()
    {
        _activeSince = null;
        _firedForgot = false;
        _firedManualIdle = false;
    }

    /// <summary>The pure decision logic — timer-free, and the tested surface.</summary>
    public void Tick(int idleSeconds, DateTimeOffset now)
    {
        if (_isTracking())
        {
            // A manual clock is live → the manual-idle nudge only. Forgot-to-start is meaningless.
            _activeSince = null;
            _firedForgot = false;

            if (idleSeconds < _idleThresholdSeconds)
            {
                _firedManualIdle = false; // active again → re-arm
                return;
            }

            if (!_firedManualIdle && _emitsManualIdleNudge)
            {
                var minutes = AwayMinutes.Of(idleSeconds);
                _notifier.Notify(
                    "manual-idle",
                    "Time tracking",
                    string.Create(CultureInfo.InvariantCulture, $"Idle for {minutes} min — still tracking?"));
                _firedManualIdle = true;
            }

            return;
        }

        if (_isPaused() || _isAwaitingResolution())
        {
            // Mid-pause manual session, or an away prompt already asking them to act — no nudges
            // of either kind.
            Reset();
            return;
        }

        // Not tracking, not paused → forgot-to-start.
        _firedManualIdle = false;

        if (idleSeconds >= _idleThresholdSeconds)
        {
            _activeSince = null;  // the person is away → break the stretch
            _firedForgot = false; // re-arm for the next presence
            return;
        }

        _activeSince ??= now;

        if (!_firedForgot && now - _activeSince.Value >= TimeSpan.FromSeconds(_forgotToStartSeconds))
        {
            const string title = "Time tracking";
            var body = string.Create(
                CultureInfo.InvariantCulture,
                $"You've been active {_forgotToStartSeconds / 60} min without tracking — start?");

            if (_presentForgotToStart is { } present)
            {
                present(title, body);
            }
            else
            {
                _notifier.Notify("forgot-to-start", title, body);
            }

            _firedForgot = true;
        }
    }
}

/// <summary>
/// Adapts <see cref="ManualNudgeMonitor"/> to the signal edge, so it rides the same poller as
/// everything else rather than starting a second timer over the same idle scalar.
///
/// Sleep and lock are treated as an immediate long idle rather than being ignored. A machine that
/// has just woken has plainly not been "active without tracking", so the forgot-to-start stretch
/// has to break — otherwise closing the lid for an hour would be indistinguishable from working.
/// </summary>
public sealed class NudgeSignalAdapter : ISignalReceiver
{
    private readonly ManualNudgeMonitor _monitor;
    private readonly int _awaySeconds;
    private readonly Func<DateTimeOffset> _clock;

    public NudgeSignalAdapter(
        ManualNudgeMonitor monitor,
        int awaySeconds,
        Func<DateTimeOffset>? clock = null)
    {
        _monitor = monitor;
        _awaySeconds = awaySeconds;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public void Tick(int idleSeconds) => _monitor.Tick(idleSeconds, _clock());

    public void MarkAway() => _monitor.Tick(_awaySeconds, _clock());

    public void Resume() => _monitor.Reset();
}
