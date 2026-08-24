using System.Windows;
using NiftyTimer.Policy;

namespace NiftyTimer.UI;

/// <summary>
/// PRD §4.1 — the notice-and-acknowledgement gate. Until the person has acknowledged, the client
/// does not capture: no screenshots, no activity samples, no idle sampling. That is enforced
/// structurally by <see cref="AckGate"/>, not by this window; this window is only how the
/// acknowledgement gets recorded.
///
/// "Not now" is a real option. It leaves the gate closed.
/// </summary>
public partial class AckWindow : Window
{
    private readonly IAckClient _client;
    private readonly EffectivePolicy _policy;
    private readonly string _userId;

    public AckWindow(IAckClient client, EffectivePolicy policy, string userId)
    {
        InitializeComponent();
        _client = client;
        _policy = policy;
        _userId = userId;

        VersionLabel.Text = $"Policy version {policy.PolicyVersion}";
        PolicyText.Text = string.IsNullOrWhiteSpace(policy.PolicyText)
            ? "Your team has not published policy text. Ask your administrator what is recorded before acknowledging."
            : policy.PolicyText;
    }

    /// <summary>Raised once the server has recorded the acknowledgement.</summary>
    public event Action<string>? Acknowledged;

    private async void OnAcknowledge(object sender, RoutedEventArgs e)
    {
        AcknowledgeButton.IsEnabled = false;
        AcknowledgeButton.Content = "Recording…";
        ShowError(null);

        var ok = await _client.AcknowledgeAsync(_userId, _policy.PolicyVersion).ConfigureAwait(true);

        AcknowledgeButton.IsEnabled = true;
        AcknowledgeButton.Content = "I acknowledge";

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
