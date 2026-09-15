namespace NiftyTimer.App;

/// <summary>What <see cref="TrayRegistration"/> tells the tray to do after an attempt.</summary>
public enum TrayRegistrationOutcome
{
    /// <summary>The icon is on the taskbar.</summary>
    Shown,

    /// <summary>The shell refused. Try again after <see cref="TrayRegistration.RetryInterval"/>.</summary>
    RetryLater,

    /// <summary>The retry budget is spent: the shell has refused for too long to keep waiting.</summary>
    GiveUp,
}

/// <summary>
/// Whether the tray icon is registered with the shell, and what to do when it is not.
///
/// <c>Shell_NotifyIcon(NIM_ADD)</c> refusing is routine rather than exceptional. At login the Run
/// key can start this app before Explorer has created the notification area. After Explorer
/// broadcasts <c>TaskbarCreated</c> the icon may have been dropped — or may still be registered,
/// in which case adding it again fails even though it is showing. This client used to throw on
/// the first refusal, from the constructor at launch and from inside the window procedure on a
/// re-broadcast; with no handler above either, the process ended silently and the person had to
/// find the exe and start it again.
///
/// So a refused add falls back to a modify (the icon is still there), then to a retry on a fixed
/// interval. It never throws. The budget is what keeps "the indicator is not optional"
/// (PRD §4.2) honest: the app does not carry on indefinitely without the icon; it gives up, and
/// the owner exits.
///
/// Pure and deterministic — no timers, no shell. <see cref="TrayIconController"/> owns the timer
/// and asks this what to do next, as <see cref="Sync.SyncEngine"/> does with its backoff.
/// </summary>
public sealed class TrayRegistration
{
    /// <summary>How long to wait between refused attempts.</summary>
    public static readonly TimeSpan RetryInterval = TimeSpan.FromSeconds(2);

    /// <summary>Three minutes at <see cref="RetryInterval"/> — longer than a slow login takes to
    /// bring the taskbar up, short enough that an icon-less app does not linger.</summary>
    public const int DefaultMaxAttempts = 90;

    private readonly Func<bool> _add;
    private readonly Func<bool> _modify;
    private readonly int _maxAttempts;
    private int _failures;

    /// <param name="add">Registers the icon (<c>NIM_ADD</c>); true on success.</param>
    /// <param name="modify">Updates an icon the shell still holds (<c>NIM_MODIFY</c>); true on success.</param>
    /// <param name="maxAttempts">Consecutive refusals before <see cref="TrayRegistrationOutcome.GiveUp"/>.</param>
    public TrayRegistration(Func<bool> add, Func<bool> modify, int maxAttempts = DefaultMaxAttempts)
    {
        _add = add;
        _modify = modify;
        _maxAttempts = Math.Max(1, maxAttempts);
    }

    /// <summary>The shell accepted the icon on the most recent attempt.</summary>
    public bool IsShown { get; private set; }

    /// <summary>Try to put the icon on the taskbar. Never throws on a refusal.</summary>
    public TrayRegistrationOutcome Register()
    {
        // Modify second: if the shell still holds the icon, an add is refused and a modify is
        // how to tell that apart from a shell that is not there at all.
        if (_add() || _modify())
        {
            IsShown = true;
            _failures = 0;
            return TrayRegistrationOutcome.Shown;
        }

        IsShown = false;
        _failures++;
        return _failures >= _maxAttempts ? TrayRegistrationOutcome.GiveUp : TrayRegistrationOutcome.RetryLater;
    }

    /// <summary>
    /// Explorer broadcast <c>TaskbarCreated</c>: every entry may have been dropped, or none. Register
    /// again against a fresh budget — a new taskbar is new evidence that the shell is back.
    /// </summary>
    public TrayRegistrationOutcome OnTaskbarCreated()
    {
        _failures = 0;
        return Register();
    }
}
