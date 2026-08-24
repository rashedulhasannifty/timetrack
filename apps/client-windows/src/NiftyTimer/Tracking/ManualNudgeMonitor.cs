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
/// <b>Not yet wired.</b> Its notifier is the S4 toast implementation; <see cref="App.AppDelegate"/>
/// does not construct this until then, so nothing polls on its behalf today.
/// </summary>
public sealed class ManualNudgeMonitor
{
    private readonly ILocalNotifier _notifier;
    private readonly int _idleThresholdSeconds;
    private readonly int _forgotToStartSeconds;
    private readonly Func<bool> _isTracking;
    private readonly Func<bool> _isPaused;

    private DateTimeOffset? _activeSince;
    private bool _firedForgot;
    private bool _firedManualIdle;

    public ManualNudgeMonitor(
        ILocalNotifier notifier,
        int idleThresholdSeconds,
        int forgotToStartSeconds,
        Func<bool> isTracking,
        Func<bool> isPaused)
    {
        _notifier = notifier;
        _idleThresholdSeconds = idleThresholdSeconds;
        _forgotToStartSeconds = forgotToStartSeconds;
        _isTracking = isTracking;
        _isPaused = isPaused;
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

            if (!_firedManualIdle)
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

        if (_isPaused())
        {
            // Mid-pause manual session — no nudges of either kind.
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
            _notifier.Notify(
                "forgot-to-start",
                "Time tracking",
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"You've been active {_forgotToStartSeconds / 60} min without tracking — start?"));
            _firedForgot = true;
        }
    }
}
