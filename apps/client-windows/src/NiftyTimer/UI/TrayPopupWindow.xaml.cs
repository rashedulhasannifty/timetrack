using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
using NiftyTimer.App;

namespace NiftyTimer.UI;

/// <summary>One row in the project/task picker.</summary>
public sealed record PickerItem(string Label, string ProjectId, string? TaskId);

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
            ElapsedLabel.Text = _viewModel.ElapsedLabel;
            StatusLabel.Text = StatusText();

            NoticeLabel.Text = NoticeText() ?? string.Empty;
            NoticeLabel.Visibility = NoticeText() is null ? Visibility.Collapsed : Visibility.Visible;

            SyncUpdateRow();

            StartStopButton.Content = _viewModel.IsTracking ? "Stop" : "Start";
            StartStopButton.IsEnabled = _viewModel.IsTracking ? _viewModel.CanStop : _viewModel.CanStart;

            PauseResumeButton.Content = _viewModel.IsPaused ? "Resume" : "Pause";
            PauseResumeButton.IsEnabled = _viewModel.IsPaused ? _viewModel.IsReady : _viewModel.IsTracking;

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

    private string StatusText()
    {
        if (!_viewModel.IsReady)
        {
            return "Not ready";
        }

        if (_viewModel.IsTracking)
        {
            return $"Tracking · {_viewModel.SelectionLabel}";
        }

        return _viewModel.IsPaused ? $"Paused · {_viewModel.SelectionLabel}" : "Stopped";
    }

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

    private void RenderPicker()
    {
        var items = new List<PickerItem>();
        foreach (var project in _viewModel.Projects)
        {
            items.Add(new PickerItem(project.Name, project.Id, null));
            foreach (var task in project.Tasks ?? [])
            {
                items.Add(new PickerItem($"{project.Name} · {task.Name}", project.Id, task.Id));
            }
        }

        ProjectPicker.ItemsSource = items;
        ProjectPicker.SelectedItem = _viewModel.Selection is { } selection
            ? items.FirstOrDefault(i => i.ProjectId == selection.ProjectId && i.TaskId == selection.TaskId)
            : null;
    }

    private void OnProjectSelected(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressCallbacks || ProjectPicker.SelectedItem is not PickerItem item)
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

    private void OnStartStop(object sender, RoutedEventArgs e)
    {
        if (_viewModel.IsTracking)
        {
            _viewModel.Stop();
        }
        else
        {
            _viewModel.Start();
        }
    }

    private void OnPauseResume(object sender, RoutedEventArgs e)
    {
        if (_viewModel.IsPaused)
        {
            _viewModel.Resume();
        }
        else
        {
            _viewModel.Pause();
        }
    }

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
