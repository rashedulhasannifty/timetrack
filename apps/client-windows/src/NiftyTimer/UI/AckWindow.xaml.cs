using System.Globalization;
using System.Windows;
using NiftyTimer.Policy;

namespace NiftyTimer.UI;

/// <summary>
/// PRD §4.1 — the notice-and-acknowledgement gate. Until the person has acknowledged, the client
/// does not capture: no screenshots, no activity samples, no idle sampling. That is enforced
/// structurally by <see cref="AckGate"/>, not by this window; this window is only how the
/// acknowledgement gets recorded.
///
/// Laid out after the macOS client's consent screen: what is recorded beside what never is, and a
/// checkbox that must be ticked before Start is enabled.
///
/// "Not now" is a real option. It leaves the gate closed.
/// </summary>
public partial class AckWindow : Window
{
    private readonly IAckClient _client;
    private readonly EffectivePolicy _policy;
    private readonly string _userId;
    private bool _busy;

    public AckWindow(IAckClient client, EffectivePolicy policy, string userId)
    {
        InitializeComponent();
        _client = client;
        _policy = policy;
        _userId = userId;

        RecordedList.ItemsSource = AckContent.Recorded(policy.Settings);
        NeverRecordedList.ItemsSource = AckContent.NeverRecorded;

        PolicyText.Text = string.IsNullOrWhiteSpace(policy.PolicyText)
            ? "Your team has not published policy text. Ask your administrator what is recorded before acknowledging."
            : policy.PolicyText;

        FooterLabel.Text = $"Tracking can't begin until you acknowledge this. Policy {policy.PolicyVersion}.";
    }

    /// <summary>Raised once the server has recorded the acknowledgement.</summary>
    public event Action<string>? Acknowledged;

    /// <summary>Ticked, and not already sending. The button follows this; so does the handler.</summary>
    internal bool CanAcknowledge => HasReadBox.IsChecked == true && !_busy;

    private void OnHasReadChanged(object sender, RoutedEventArgs e) => SyncAcknowledgeButton();

    private void SyncAcknowledgeButton()
    {
        AcknowledgeButton.IsEnabled = CanAcknowledge;
        AcknowledgeButton.Content = _busy ? "Recording…" : "Start Nifty Timer";
    }

    private void OnToggleFullPolicy(object sender, RoutedEventArgs e)
    {
        var show = FullPolicy.Visibility != Visibility.Visible;
        FullPolicy.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        FullPolicyButton.Content = show ? "Hide the full policy" : "Read the full policy";
    }

    private async void OnAcknowledge(object sender, RoutedEventArgs e)
    {
        // The button is disabled until the box is ticked; checked here as well so Enter or a
        // stray automation click cannot record an acknowledgement nobody ticked.
        if (!CanAcknowledge)
        {
            return;
        }

        _busy = true;
        SyncAcknowledgeButton();
        ShowError(null);

        var ok = await _client.AcknowledgeAsync(_userId, _policy.PolicyVersion).ConfigureAwait(true);

        _busy = false;
        SyncAcknowledgeButton();

        if (!ok)
        {
            // Fail closed and say so. Recording the marker locally on a failed call would open
            // manual tracking on the next offline launch for an acknowledgement the server never
            // saw.
            ShowError("Couldn't record your acknowledgement. Check your connection and try again.");
            return;
        }

        Hide();
        Acknowledged?.Invoke(_policy.PolicyVersion);
    }

    private void OnNotNow(object sender, RoutedEventArgs e) => Hide();

    private void ShowError(string? message)
    {
        ErrorLabel.Text = message ?? string.Empty;
        ErrorLabel.Visibility = message is null ? Visibility.Collapsed : Visibility.Visible;
    }
}

/// <summary>
/// The two lists on the acknowledgement window. Kept apart from the window so the consent text is
/// testable without one.
/// </summary>
public static class AckContent
{
    /// <summary>
    /// What this client records, derived from the live policy rather than hard-coded, so the
    /// consent matches what the app will actually do: screenshots and window titles are policy
    /// switches, and the list says so only when they are on.
    ///
    /// Says "app", not the Mac's "app &amp; website": this client categorizes by application only
    /// (browser-site rules are not implemented on Windows), and consent must not claim more than is
    /// captured any more than less.
    /// </summary>
    public static IReadOnlyList<string> Recorded(PolicySettings settings)
    {
        var items = new List<string>
        {
            "Time entries and durations",
            "Active app and its category",
            "Activity level (%)",
        };

        if (settings.ScreenshotsEnabled)
        {
            items.Add(string.Create(
                CultureInfo.InvariantCulture,
                $"A screenshot about every {settings.ScreenshotIntervalMinutes} min"));
        }

        if (settings.CaptureWindowTitles)
        {
            items.Add("Active window titles");
        }

        return items;
    }

    /// <summary>
    /// The fixed guarantees (CLAUDE.md §1). Not policy-dependent: no setting can turn any of them
    /// on. On Windows the keystroke one is structural — the input counter never copies a key's
    /// identity into the process.
    /// </summary>
    public static IReadOnlyList<string> NeverRecorded { get; } =
    [
        "Keystrokes — what you type",
        "Message or document content",
        "Passwords",
        "Webcam, microphone, or clipboard",
    ];
}
