using System.Windows;
using System.Windows.Controls;
using NiftyTimer.Policy;
using NiftyTimer.UI;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The consent text. It is derived from the live policy, so these pin that it says exactly what
/// the policy switches on — no more, which would be alarming for nothing, and no less, which would
/// make the acknowledgement meaningless.
/// </summary>
public class AckContentTests
{
    [Fact]
    public void ScreenshotsAndTitlesAreListedOnlyWhenThePolicyTurnsThemOn()
    {
        var recorded = AckContent.Recorded(new PolicySettings
        {
            ScreenshotsEnabled = false,
            CaptureWindowTitles = false,
        });

        Assert.DoesNotContain(recorded, item => item.Contains("screenshot", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain("Active window titles", recorded);
        Assert.Contains("Time entries and durations", recorded);
    }

    [Fact]
    public void TheScreenshotLineCarriesTheTeamsInterval()
    {
        var recorded = AckContent.Recorded(new PolicySettings
        {
            ScreenshotsEnabled = true,
            ScreenshotIntervalMinutes = 15,
        });

        Assert.Contains("A screenshot about every 15 min", recorded);
    }

    [Fact]
    public void WindowTitlesAreListedWhenCaptured()
    {
        var recorded = AckContent.Recorded(new PolicySettings { CaptureWindowTitles = true });

        Assert.Contains("Active window titles", recorded);
    }

    /// <summary>This client categorizes by application only, so consent must not mention sites.</summary>
    [Fact]
    public void NothingClaimsWebsiteCategorization()
    {
        var recorded = AckContent.Recorded(new PolicySettings { ScreenshotsEnabled = true, CaptureWindowTitles = true });

        Assert.DoesNotContain(recorded, item => item.Contains("website", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void KeystrokesAreNamedAsNeverRecorded() =>
        Assert.Contains("Keystrokes — what you type", AckContent.NeverRecorded);
}

/// <summary>The real window, driven on the shared WPF thread and never shown.</summary>
[Collection("wpf")]
public class AckWindowTests
{
    private sealed class CountingAckClient : IAckClient
    {
        public int Calls { get; private set; }

        public Task<bool> AcknowledgeAsync(string userId, string policyVersion, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(true);
        }
    }

    private static readonly EffectivePolicy TestPolicy = new()
    {
        AckRequired = true,
        PolicyVersion = "v3",
        PolicyText = "The full policy.",
        Settings = new PolicySettings { ScreenshotsEnabled = true },
    };

    private static T WithWindow<T>(Func<AckWindow, CountingAckClient, T> body) =>
        Wpf.Run(() =>
        {
            var client = new CountingAckClient();
            var window = new AckWindow(client, TestPolicy, "user-1");
            try
            {
                return body(window, client);
            }
            finally
            {
                window.Close();
            }
        });

    [Fact]
    public void StartStaysDisabledUntilTheBoxIsTicked()
    {
        var (before, ticked, unticked) = WithWindow((window, _) =>
        {
            var button = (Button)window.FindName("AcknowledgeButton");
            var box = (CheckBox)window.FindName("HasReadBox");
            var first = button.IsEnabled;
            box.IsChecked = true;
            var second = button.IsEnabled;
            box.IsChecked = false;
            return (first, second, button.IsEnabled);
        });

        Assert.False(before);
        Assert.True(ticked);
        Assert.False(unticked);
    }

    /// <summary>A click that reaches the handler without the tick — Enter, automation — records nothing.</summary>
    [Fact]
    public void AnUntickedAcknowledgeIsIgnored()
    {
        var calls = WithWindow((window, client) =>
        {
            ((Button)window.FindName("AcknowledgeButton")).RaiseEvent(
                new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            return client.Calls;
        });

        Assert.Equal(0, calls);
    }

    [Fact]
    public void TheRecordedCardFollowsThePolicy()
    {
        var shown = WithWindow((window, _) =>
            ((ItemsControl)window.FindName("RecordedList")).Items.Cast<string>().ToList());

        Assert.Equal(AckContent.Recorded(TestPolicy.Settings), shown);
    }

    [Fact]
    public void TheFullPolicyIsHiddenUntilAskedFor()
    {
        var (before, after) = WithWindow((window, _) =>
        {
            var panel = (FrameworkElement)window.FindName("FullPolicy");
            var first = panel.Visibility;
            ((Button)window.FindName("FullPolicyButton")).RaiseEvent(
                new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            return (first, panel.Visibility);
        });

        Assert.Equal(Visibility.Collapsed, before);
        Assert.Equal(Visibility.Visible, after);
    }
}
