using System.Globalization;
using System.Windows;

namespace NiftyTimer.UI;

/// <summary>
/// The distraction nudge as a small card, for when Windows notifications are switched off. Ported
/// from the macOS client's <c>DistractionNudgeView</c>.
///
/// Non-modal, always visible, dismissible, and shown without taking focus. It carries only the
/// generic, category-derived nudge text — never an app name, host or window title (CLAUDE.md §1).
/// </summary>
public partial class DistractionNudgeWindow : Window
{
    public DistractionNudgeWindow(string title, string message)
    {
        InitializeComponent();

        TitleLabel.Text = title.ToUpper(CultureInfo.CurrentCulture);
        MessageLabel.Text = message;
    }

    private void OnDismiss(object sender, RoutedEventArgs e) => Close();
}

/// <summary>
/// Presents one card at a time and can dismiss it — the same shape as
/// <see cref="NotTrackingReminder"/>. Dismissed on sign-out, so one person's nudge never lingers
/// into the next person's session.
/// </summary>
public sealed class DistractionNudge
{
    private DistractionNudgeWindow? _live;

    public bool IsShowing => _live is not null;

    public void Present(string title, string message)
    {
        // Replace rather than stack. The monitor fires once per streak, but this stays defensive.
        DismissIfShowing();

        var window = new DistractionNudgeWindow(title, message);
        window.Closed += (_, _) =>
        {
            if (ReferenceEquals(_live, window))
            {
                _live = null;
            }
        };

        _live = window;
        window.Show();
    }

    public void DismissIfShowing()
    {
        var window = _live;
        _live = null;
        window?.Close();
    }
}
