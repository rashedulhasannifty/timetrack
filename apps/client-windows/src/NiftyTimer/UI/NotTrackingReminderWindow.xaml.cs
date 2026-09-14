using System.Windows;

namespace NiftyTimer.UI;

/// <summary>
/// The "your time isn't being recorded" reminder. Ported from the macOS client's
/// <c>NotTrackingReminderView</c>. Two situations reach it, both of which used to be silent on
/// Windows or a mere balloon:
///
/// <list type="bullet">
///   <item>the launch-time policy resolve has failed several times running, so idle detection
///   never installed — the Run-key launch before the network is up;</item>
///   <item>auto mode is live but the clock has stayed stopped while the person has been present
///   for a while.</item>
/// </list>
///
/// A WINDOW rather than a balloon on purpose: a balloon is silently dropped when notifications are
/// off, and a reminder that the day is not being recorded is the one that must never be lost.
/// Always visible and dismissible; no quiet variant (CLAUDE.md §1). It carries no app name, title
/// or host — only the tracking state.
///
/// Closing it any way other than the Start button starts nothing.
/// </summary>
public partial class NotTrackingReminderWindow : Window
{
    private Action? _onStart;

    public NotTrackingReminderWindow(string title, string message, Action onStart)
    {
        InitializeComponent();

        _onStart = onStart;
        Title = title;
        TitleLabel.Text = title;
        MessageLabel.Text = message;
    }

    private void OnStart(object sender, RoutedEventArgs e)
    {
        var start = _onStart;
        _onStart = null;
        Close();
        start?.Invoke();
    }

    private void OnDismiss(object sender, RoutedEventArgs e)
    {
        _onStart = null;
        Close();
    }
}

/// <summary>
/// Presents one reminder at a time and can dismiss it — the same shape as <see cref="TimePrompt"/>.
///
/// Dismissal matters for the same reason: a reminder left on screen across a sign-out carries a
/// Start button that would open an entry for whoever signs in next (CLAUDE.md §1).
/// </summary>
public sealed class NotTrackingReminder
{
    private NotTrackingReminderWindow? _live;

    public void Present(string title, string message, Action onStart)
    {
        // Replace rather than stack: both triggers can fire, and two copies of the same reminder
        // tell the person nothing more.
        DismissIfShowing();

        var window = new NotTrackingReminderWindow(title, message, onStart);
        window.Closed += (_, _) =>
        {
            if (ReferenceEquals(_live, window))
            {
                _live = null;
            }
        };

        _live = window;
        window.Show();
        window.Activate();
    }

    public void DismissIfShowing()
    {
        var window = _live;
        _live = null;
        window?.Close();
    }
}
