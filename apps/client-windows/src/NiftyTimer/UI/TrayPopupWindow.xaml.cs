using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using NiftyTimer.App;

namespace NiftyTimer.UI;

/// <summary>
/// The dropdown behind the tray icon. Closes when it loses focus, like a menu.
///
/// It is a window rather than a real menu because it holds live controls — a text box for the
/// note and a searchable picker — which a Win32 popup menu cannot host.
/// </summary>
public partial class TrayPopupWindow : Window
{
    private readonly MenuViewModel _viewModel;
    private readonly Uri _dashboardUrl;
    private readonly string _buildStamp;
    private readonly DispatcherTimer _tick;

    private bool _suppressCallbacks;

    public TrayPopupWindow(MenuViewModel viewModel, Uri dashboardUrl, string buildStamp)
    {
        InitializeComponent();

        _viewModel = viewModel;
        _dashboardUrl = dashboardUrl;
        _buildStamp = buildStamp;

        _viewModel.PropertyChanged += OnViewModelChanged;

        // Only ticks while the popup is visible: the tray tooltip carries the live time the rest
        // of the time, and a per-second dispatcher timer against a hidden window is pure waste.
        _tick = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = TimeSpan.FromSeconds(1),
        };
        _tick.Tick += (_, _) => _viewModel.Tick();

        Deactivated += (_, _) => Hide();
        IsVisibleChanged += OnIsVisibleChanged;

        Render();
    }

    /// <summary>The user asked to sign out.</summary>
    public event Action? SignOutRequested;

    /// <summary>The user asked to quit the app.</summary>
    public event Action? QuitRequested;

    /// <summary>
    /// The person asked to apply a pending update. Advisory throughout: an update is never
    /// applied without this, and declining it costs nothing but staying on the old build.
    /// </summary>
    public event Action? UpdateRequested;

    /// <summary>
    /// Lifts the close guard for a real shutdown. <see cref="OnClosing"/> otherwise cancels every
    /// close so that dismissing the popup does not end the process.
    /// </summary>
    public bool AllowClose { get; set; }

    /// <summary>
    /// Show the popup anchored near the tray. Positioned against the working area rather than the
    /// full screen so it does not sit under the taskbar, whichever edge the taskbar is docked to.
    /// </summary>
    public void ShowNearTray()
    {
        Render();

        var work = SystemParameters.WorkArea;
        Left = work.Right - Width - 12;
        Top = work.Bottom - ActualHeight - 12;

        Show();
        Activate();

        // SizeToContent means ActualHeight is only correct after the first layout pass.
        Dispatcher.BeginInvoke(
            DispatcherPriority.Loaded,
            () => Top = SystemParameters.WorkArea.Bottom - ActualHeight - 12);
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        // Closing the popup must not end the process — the tray icon is the app's real lifetime.
        // A genuine shutdown sets AllowClose first, or this handler would refuse the quit.
        if (!AllowClose)
        {
            e.Cancel = true;
            Hide();
        }

        base.OnClosing(e);
    }

    private void OnIsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (IsVisible)
        {
            // Belt-and-braces alongside RefreshTheme: ShowNearTray already renders before Show(),
            // so this is redundant on that path, but it keeps the status brushes correct for any
            // future caller that flips Visibility directly instead of going through ShowNearTray.
            Render();
            _tick.Start();
        }
        else
        {
            _tick.Stop();
        }
    }

    private void OnViewModelChanged(object? sender, PropertyChangedEventArgs e) => Render();

    private void Render()
    {
        _suppressCallbacks = true;
        try
        {
            RenderStatus();

            NoticeLabel.Text = NoticeText() ?? string.Empty;
            NoticeLabel.Visibility = NoticeText() is null ? Visibility.Collapsed : Visibility.Visible;

            SyncUpdateRow();

            RenderControls();

            RenderPicker();

            if (NoteBox.Text != _viewModel.Note)
            {
                NoteBox.Text = _viewModel.Note;
            }

            TodayLabel.Text = _viewModel.TodayLabel;
            WeekLabel.Text = _viewModel.WeekLabel;
            MonthLabel.Text = _viewModel.MonthLabel;

            PendingLabel.Text = _viewModel.PendingLabel;
            PendingLabel.Visibility = _viewModel.HasPending ? Visibility.Visible : Visibility.Collapsed;

            BuildLabel.Text = _buildStamp;
        }
        finally
        {
            _suppressCallbacks = false;
        }
    }

    /// <summary>
    /// The status line and the hero timer.
    ///
    /// The timer is hidden when there is nothing running: a large 00:00:00 reads as a clock that
    /// has stopped rather than one that was never started, which is the wrong thing to say to
    /// someone who has not begun their day.
    ///
    /// The selection is deliberately NOT repeated here — the picker below carries it with a
    /// checkmark, and this line was only doing that job when the picker could not.
    /// </summary>
    private void RenderStatus()
    {
        var tracking = _viewModel.IsTracking;
        var paused = _viewModel.IsPaused;

        StatusLabel.Text = (tracking, paused, _viewModel.IsReady) switch
        {
            (true, _, _) => "Recording",
            (_, true, _) => "Paused",
            (_, _, false) => "Not ready",
            _ => "Idle · Not tracking",
        };

        var active = tracking || paused;

        // Recording rather than Accent: it is the role that means "the clock is running", and it
        // is what a later status colour change would want to move.
        StatusDot.Fill = active
            ? (Brush)FindResource("Recording")
            : (Brush)FindResource("TextSecondary");

        StatusLabel.Foreground = active
            ? (Brush)FindResource("Recording")
            : (Brush)FindResource("TextSecondary");

        ElapsedLabel.Text = _viewModel.ElapsedLabel;
        ElapsedLabel.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>
    /// Repaint after a theme swap. The status brushes are assigned in code rather than bound, so
    /// unlike everything else in this window they do not re-resolve on their own when the merged
    /// dictionary changes.
    /// </summary>
    public void RefreshTheme() => Render();

    private string? NoticeText()
    {
        if (_viewModel.Notice is { } notice)
        {
            return notice;
        }

        return _viewModel.LiveSyncBlocked
            ? "The running entry is not reaching the server. Your time is still recorded locally."
            : null;
    }

    /// <summary>
    /// Refill the list from the view model's filtered projection.
    ///
    /// Reassigning ItemsSource on every Render is cheap at this size and keeps the window's single
    /// imperative-push model intact (PR 2 is structural parity, not an MVVM migration). The
    /// selection is restored by VALUE rather than by reference, because the projection rebuilds its
    /// records on every read and the old instance is never the new one.
    ///
    /// The reassignment is guarded, though: <c>Render()</c> also runs once a second off the
    /// popup's own tick (<see cref="MenuViewModel.Tick"/> raises <c>ElapsedLabel</c>, which this
    /// window is subscribed to regardless of tracking state while the popup is visible), and
    /// <see cref="MenuViewModel.FilteredChoices"/> allocates a fresh list on every read. An
    /// unconditional reassignment would hand the ListBox a new collection every second, which
    /// regenerates its containers and resets the scroll offset to the top — so anyone scrolled
    /// into a long project list would get snapped back to row one while the popup just sits
    /// there. <c>PickerItem</c> is a record, so <c>SequenceEqual</c> compares the rows by value
    /// and only replaces the source when the projection actually changed.
    /// </summary>
    private void RenderPicker()
    {
        var choices = _viewModel.FilteredChoices;
        if (ProjectList.ItemsSource is not IReadOnlyList<PickerItem> current || !current.SequenceEqual(choices))
        {
            ProjectList.ItemsSource = choices;
        }

        var selected = _viewModel.SelectedChoice;
        ProjectList.SelectedItem = selected is null
            ? null
            : choices.FirstOrDefault(c => c.ProjectId == selected.ProjectId && c.TaskId == selected.TaskId);

        if (SearchBox.Text != _viewModel.Query)
        {
            SearchBox.Text = _viewModel.Query;
        }
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppressCallbacks)
        {
            _viewModel.Query = SearchBox.Text;
        }
    }

    private void OnProjectSelected(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressCallbacks || ProjectList.SelectedItem is not PickerItem item)
        {
            return;
        }

        _viewModel.SelectProject(item.ProjectId, item.TaskId);
    }

    private void OnNoteChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppressCallbacks)
        {
            _viewModel.Note = NoteBox.Text;
        }
    }

    /// <summary>
    /// Which two buttons the phase calls for, and which of them is the prominent one.
    ///
    /// Idle offers only Start — there is nothing to stop or pause, and a disabled second button is
    /// noise. Tracking makes Stop prominent and Pause secondary; paused inverts that, because the
    /// obvious next action is to carry on.
    /// </summary>
    private void RenderControls()
    {
        var prominent = (Style)FindResource("ProminentButton");
        var bordered = (Style)FindResource("BorderedButton");

        if (_viewModel.IsPaused)
        {
            Apply(PrimaryButton, PrimaryGlyph, PrimaryLabel, prominent, "PlayGlyph", "Resume", _viewModel.IsReady);
            Apply(SecondaryButton, SecondaryGlyph, SecondaryLabel, bordered, "StopGlyph", "Stop", _viewModel.CanStop);
            SecondaryButton.Visibility = Visibility.Visible;
            Grid.SetColumnSpan(PrimaryButton, 1);
            PrimaryButton.ToolTip = null;
            SecondaryButton.ToolTip = null;
            return;
        }

        if (_viewModel.IsTracking)
        {
            Apply(PrimaryButton, PrimaryGlyph, PrimaryLabel, bordered, "PauseGlyph", "Pause", true);
            Apply(SecondaryButton, SecondaryGlyph, SecondaryLabel, prominent, "StopGlyph", "Stop", _viewModel.CanStop);
            SecondaryButton.Visibility = Visibility.Visible;
            Grid.SetColumnSpan(PrimaryButton, 1);
            PrimaryButton.ToolTip = null;
            SecondaryButton.ToolTip = null;
            return;
        }

        Apply(PrimaryButton, PrimaryGlyph, PrimaryLabel, prominent, "PlayGlyph", "Start", _viewModel.CanStart);
        SecondaryButton.Visibility = Visibility.Collapsed;

        // Idle has nothing to stop or pause, so SecondaryButton is collapsed above — but a
        // collapsed element still keeps its own grid column reserved, which would otherwise leave
        // Start at half the row's width with dead space beside it. Spanning all three columns
        // (Primary's own plus the gap and Secondary's) is what actually delivers the "fill the
        // popup like macOS's maxWidth: .infinity" idle state the plan calls for. Reset back to 1
        // in the tracking/paused branches above so a stale span from a previous idle render never
        // makes Start overlap Stop once the second button reappears.
        Grid.SetColumnSpan(PrimaryButton, 3);

        // The tooltip is the only place the ack gate explains itself on this surface. Without it a
        // disabled Start is indistinguishable from a broken one. Assigned in every branch (not just
        // here) so a stale "acknowledge the policy" tooltip can never persist onto the Pause/Resume
        // button after the phase moves on — that would misstate why a control is disabled on
        // monitoring software, where the ack gate is a real policy boundary.
        PrimaryButton.ToolTip = _viewModel.IsReady
            ? "Start tracking"
            : "Acknowledge the monitoring policy to begin";
    }

    private void Apply(
        Button button,
        System.Windows.Shapes.Path glyph,
        TextBlock label,
        Style style,
        string glyphKey,
        string text,
        bool enabled)
    {
        button.Style = style;
        button.IsEnabled = enabled;
        glyph.Data = (Geometry)FindResource(glyphKey);
        label.Text = text;
    }

    private void OnPrimary(object sender, RoutedEventArgs e)
    {
        if (_viewModel.IsPaused)
        {
            _viewModel.Resume();
        }
        else if (_viewModel.IsTracking)
        {
            _viewModel.Pause();
        }
        else
        {
            _viewModel.Start();
        }
    }

    private void OnSecondary(object sender, RoutedEventArgs e) => _viewModel.Stop();

    /// <summary>
    /// PRD §4.3 symmetric transparency — the employee reaches everything recorded about them
    /// through the same dashboard a manager uses, scoped to themselves.
    /// </summary>
    private void OnOpenMyData(object sender, RoutedEventArgs e)
    {
        Hide();
        Process.Start(new ProcessStartInfo(new Uri(_dashboardUrl, "me").ToString())
        {
            UseShellExecute = true,
        });
    }

    private void OnSignOut(object sender, RoutedEventArgs e)
    {
        Hide();
        SignOutRequested?.Invoke();
    }

    private void OnQuit(object sender, RoutedEventArgs e)
    {
        Hide();
        QuitRequested?.Invoke();
    }

    private void OnUpdate(object sender, RoutedEventArgs e)
    {
        Hide();
        UpdateRequested?.Invoke();
    }

    /// <summary>
    /// Show or hide the update line. Called from the view model's change notification, so the
    /// row appears the moment a check finds something rather than at the next menu open.
    /// </summary>
    private void SyncUpdateRow()
    {
        UpdateRow.Visibility = _viewModel.UpdateAvailable ? Visibility.Visible : Visibility.Collapsed;
        UpdateLabel.Text = _viewModel.UpdateOverdue
            ? "An update has been waiting a while."
            : "A new version is available.";
    }

    /// <summary>
    /// Round the window through DWM instead of AllowsTransparency.
    ///
    /// AllowsTransparency is what produced the rounded card before, and it forces this window into
    /// SOFTWARE rendering — which degrades ClearType on the one surface in this client where text
    /// quality is the entire point. DWM rounds the real window with hardware rendering intact.
    ///
    /// The Border's own CornerRadius has to track whether DWM actually rounded the window: see the
    /// HRESULT gate below.
    /// </summary>
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        var preference = DwmWindowCornerPreferenceRound;
        var handle = new WindowInteropHelper(this).Handle;

        // 8 is DWM's own DWMWCP_ROUND radius, not a design-system value — do not "tidy" it onto
        // RadiusSm. Gated on the HRESULT: when DWM rounds the window, the Border must round with
        // it or its square stroke is clipped short at each corner. When the call FAILS (Windows 10,
        // which has no such attribute) the window stays square, so the Border must stay square too
        // or its rounded corners would cut into a square window and show as nubs.
        if (DwmSetWindowAttribute(handle, DwmwaWindowCornerPreference, ref preference, sizeof(int)) == 0)
        {
            ((Border)Content).CornerRadius = new CornerRadius(8);
        }
    }

    private const int DwmwaWindowCornerPreference = 33;
    private const int DwmWindowCornerPreferenceRound = 2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr hwnd,
        int attribute,
        ref int value,
        int size);
}
