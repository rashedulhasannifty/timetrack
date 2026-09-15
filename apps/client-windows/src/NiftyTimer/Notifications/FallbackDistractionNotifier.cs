namespace NiftyTimer.Notifications;

/// <summary>
/// Wraps the notifier for the DISTRACTION nudge only. Ported from the macOS client's
/// <c>FallbackDistractionNotifier</c>: a normal notification when Windows will show one, and a
/// dismissible in-app card when notifications are switched off, so the nudge is never silently
/// lost. The idle, forgot-to-start and end-of-day nudges keep the plain notifier and its
/// documented silent drop.
///
/// It is an <see cref="ILocalNotifier"/>, so <see cref="Tracking.DistractionMonitor"/> stays
/// unchanged and UI-free. It forwards only the generic, category-derived text the monitor produced
/// — never an app name, host or window title (CLAUDE.md §1).
/// </summary>
public sealed class FallbackDistractionNotifier : ILocalNotifier
{
    private readonly ILocalNotifier _primary;
    private readonly Func<bool> _notificationsEnabled;
    private readonly Action<string, string> _presentWindow;

    public FallbackDistractionNotifier(
        ILocalNotifier primary,
        Func<bool> notificationsEnabled,
        Action<string, string> presentWindow)
    {
        _primary = primary;
        _notificationsEnabled = notificationsEnabled;
        _presentWindow = presentWindow;
    }

    /// <summary>
    /// Asked on every nudge rather than once: switching notifications back on takes effect at the
    /// very next one.
    /// </summary>
    public void Notify(string id, string title, string body)
    {
        if (_notificationsEnabled())
        {
            _primary.Notify(id, title, body);
        }
        else
        {
            _presentWindow(title, body);
        }
    }
}
