using System.Windows;
using System.Windows.Controls;
using NiftyTimer.Notifications;
using NiftyTimer.UI;
using Xunit;

namespace NiftyTimer.Tests;

public class SystemNotificationsTests
{
    /// <summary>
    /// Only an explicit 0 means off. Absent is the untouched default, which is on — and guessing
    /// off would double every nudge on a machine that was going to show the balloon.
    /// </summary>
    [Theory]
    [InlineData(null, true)]
    [InlineData(1, true)]
    [InlineData(0, false)]
    public void OnlyAnExplicitZeroMeansOff(int? toastEnabled, bool expected) =>
        Assert.Equal(expected, SystemNotifications.Resolve(toastEnabled));
}

public class FallbackDistractionNotifierTests
{
    private sealed class RecordingNotifier : ILocalNotifier
    {
        public List<(string Id, string Title, string Body)> Sent { get; } = [];

        public void Notify(string id, string title, string body) => Sent.Add((id, title, body));
    }

    [Fact]
    public void WithNotificationsOnTheNudgeIsANotification()
    {
        var primary = new RecordingNotifier();
        var windows = new List<(string, string)>();
        var notifier = new FallbackDistractionNotifier(primary, () => true, (t, b) => windows.Add((t, b)));

        notifier.Notify("distraction", "Time tracking", "~10 min on distracting apps or sites — refocus?");

        Assert.Single(primary.Sent);
        Assert.Empty(windows);
    }

    /// <summary>The whole point: a balloon Windows would drop becomes a card instead.</summary>
    [Fact]
    public void WithNotificationsOffTheNudgeIsACard()
    {
        var primary = new RecordingNotifier();
        var windows = new List<(string Title, string Body)>();
        var notifier = new FallbackDistractionNotifier(primary, () => false, (t, b) => windows.Add((t, b)));

        notifier.Notify("distraction", "Time tracking", "~10 min on distracting apps or sites — refocus?");

        Assert.Empty(primary.Sent);
        var card = Assert.Single(windows);
        Assert.Equal("Time tracking", card.Title);
        Assert.Equal("~10 min on distracting apps or sites — refocus?", card.Body);
    }

    [Fact]
    public void TheSwitchIsReadOnEveryNudge()
    {
        var enabled = false;
        var primary = new RecordingNotifier();
        var windows = new List<(string, string)>();
        var notifier = new FallbackDistractionNotifier(primary, () => enabled, (t, b) => windows.Add((t, b)));

        notifier.Notify("distraction", "t", "b");
        enabled = true;
        notifier.Notify("distraction", "t", "b");

        Assert.Single(windows);
        Assert.Single(primary.Sent);
    }
}

/// <summary>The real card, driven on the shared WPF thread.</summary>
[Collection("wpf")]
public class DistractionNudgeTests
{
    [Fact]
    public void PresentingShowsACardAndDismissingClosesIt()
    {
        var (shown, afterDismiss) = Wpf.Run(() =>
        {
            var nudge = new DistractionNudge();
            nudge.Present("Time tracking", "~10 min on distracting apps or sites — refocus?");
            var first = nudge.IsShowing;
            nudge.DismissIfShowing();
            return (first, nudge.IsShowing);
        });

        Assert.True(shown);
        Assert.False(afterDismiss);
    }

    [Fact]
    public void GotItClosesTheCard()
    {
        var closed = Wpf.Run(() =>
        {
            var window = new DistractionNudgeWindow("Time tracking", "refocus?");
            var wasClosed = false;
            window.Closed += (_, _) => wasClosed = true;
            ((Button)window.FindName("DismissButton")).RaiseEvent(
                new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            return wasClosed;
        });

        Assert.True(closed);
    }

    /// <summary>A nudge must not itself interrupt: it appears without taking focus.</summary>
    [Fact]
    public void TheCardDoesNotTakeFocus()
    {
        var activated = Wpf.Run(() =>
        {
            var window = new DistractionNudgeWindow("Time tracking", "refocus?");
            var value = window.ShowActivated;
            window.Close();
            return value;
        });

        Assert.False(activated);
    }

    [Fact]
    public void DismissingWhenNothingIsShowingIsHarmless() =>
        Wpf.Run(() =>
        {
            new DistractionNudge().DismissIfShowing();
            return 0;
        });
}

/// <summary>The AppDelegate half, pinned with the shared IL scanner.</summary>
public class DistractionFallbackWiringTests
{
    [Fact]
    public void TheDistractionMonitorNotifiesThroughTheFallback() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("InstallActivitySampling"), nameof(FallbackDistractionNotifier), ".ctor"),
            "AppDelegate.InstallActivitySampling no longer wraps the distraction notifier in the fallback.");

    /// <summary>One person's card must not linger into the next person's session.</summary>
    [Fact]
    public void CaptureTeardownDismissesTheCard() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("TearDownCaptureAsync"), nameof(DistractionNudge), nameof(DistractionNudge.DismissIfShowing)),
            "AppDelegate.TearDownCaptureAsync no longer dismisses the distraction card.");
}
