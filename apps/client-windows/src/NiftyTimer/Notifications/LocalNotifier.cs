using NiftyTimer.App;

namespace NiftyTimer.Notifications;

/// <summary>
/// The Windows implementation of <see cref="ILocalNotifier"/>: a tray balloon, rendered by
/// Windows 10 and 11 through the Action Center like any other toast.
///
/// See <see cref="TrayIconController.ShowBalloon"/> for why this is not the WinRT toast API. The
/// short version: real toasts would cost a target-framework bump plus an AUMID registered by a
/// Start Menu shortcut the unsigned pilot cannot create, in exchange for action buttons that none
/// of the four nudges needs.
///
/// **Notifications are advisory and nothing here may change what is tracked.** That is not just a
/// convention — this type holds no reference to the tracker, the buffer or the gate, so it has
/// nothing to change even if a future caller asked it to.
///
/// De-duplication is by <c>id</c>: a monitor that re-fires the same nudge before the person has
/// done anything about it must not stack balloons. The monitors already arm and re-arm their own
/// state, so this is a backstop for the case where two monitors reach the same conclusion at once.
/// </summary>
public sealed class LocalNotifier : ILocalNotifier
{
    /// <summary>
    /// How long the same id stays suppressed. Long enough that a re-fire from a re-armed monitor
    /// is swallowed, short enough that a genuinely new occurrence half an hour later still shows.
    /// </summary>
    private static readonly TimeSpan RepeatWindow = TimeSpan.FromMinutes(5);

    private readonly Action<string, string> _show;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Dictionary<string, DateTimeOffset> _lastShown = [];
    private readonly Lock _gate = new();

    public LocalNotifier(TrayIconController tray, Func<DateTimeOffset>? clock = null)
        : this(tray.ShowBalloon, clock)
    {
    }

    /// <summary>Testing seam: the shell call is the only untestable part, so it is injectable.</summary>
    public LocalNotifier(Action<string, string> show, Func<DateTimeOffset>? clock = null)
    {
        _show = show;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public void Notify(string id, string title, string body)
    {
        lock (_gate)
        {
            var now = _clock();
            if (_lastShown.TryGetValue(id, out var last) && now - last < RepeatWindow)
            {
                return;
            }

            _lastShown[id] = now;
        }

        _show(title, body);
    }

    /// <summary>
    /// Forget every suppression. Called on sign-out: the next person on this machine must get
    /// their own nudges rather than having one silently swallowed because the previous user saw
    /// the same one four minutes ago.
    /// </summary>
    public void Reset()
    {
        lock (_gate)
        {
            _lastShown.Clear();
        }
    }
}
