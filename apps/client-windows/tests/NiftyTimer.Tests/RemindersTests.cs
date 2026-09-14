using NiftyTimer.App;
using NiftyTimer.Projects;
using NiftyTimer.Storage;
using NiftyTimer.Tracking;
using NiftyTimer.UI;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// Auto mode's forgot-to-start reminder: the same monitor as manual mode, configured the way the
/// macOS client configures it.
/// </summary>
public class AutoModeReminderTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void TheReminderIsPresentedInsteadOfNotified()
    {
        var spy = new NotifierSpy();
        var shown = new List<(string Title, string Body)>();
        var monitor = new ManualNudgeMonitor(
            spy, 300, 600, () => false, () => false,
            presentForgotToStart: (title, body) => shown.Add((title, body)));

        monitor.Tick(0, T0);
        monitor.Tick(0, T0.AddMinutes(10));

        Assert.Empty(spy.Sent);
        var (title, body) = Assert.Single(shown);
        Assert.Equal("Time tracking", title);
        Assert.Contains("10 min without tracking", body, StringComparison.Ordinal);
    }

    /// <summary>The auto coordinator already owns the idle nudge; a second one would compete.</summary>
    [Fact]
    public void TheIdleNudgeIsLeftToTheAutoCoordinator()
    {
        var spy = new NotifierSpy();
        var monitor = new ManualNudgeMonitor(
            spy, 300, 600, () => true, () => false, emitsManualIdleNudge: false);

        monitor.Tick(600, T0);

        Assert.Empty(spy.Sent);
    }

    /// <summary>An unanswered away prompt is already asking them to act; no second window on it.</summary>
    [Fact]
    public void AnUnansweredAwayPromptStandsTheReminderDown()
    {
        var spy = new NotifierSpy();
        var shown = new List<(string, string)>();
        var awaiting = true;
        var monitor = new ManualNudgeMonitor(
            spy, 300, 600, () => false, () => false,
            presentForgotToStart: (title, body) => shown.Add((title, body)),
            isAwaitingResolution: () => awaiting);

        monitor.Tick(0, T0);
        monitor.Tick(0, T0.AddMinutes(10));
        Assert.Empty(shown);

        // Answered: the stretch starts over from here rather than firing on minutes spent looking
        // at the prompt.
        awaiting = false;
        monitor.Tick(0, T0.AddMinutes(11));
        Assert.Empty(shown);

        monitor.Tick(0, T0.AddMinutes(21));
        Assert.Single(shown);
    }

    /// <summary>Manual mode is unchanged: a balloon, and the idle nudge still fires.</summary>
    [Fact]
    public void TheDefaultsKeepManualModeAsItWas()
    {
        var spy = new NotifierSpy();
        var monitor = new ManualNudgeMonitor(spy, 300, 600, () => true, () => false);

        monitor.Tick(600, T0);

        Assert.Equal("manual-idle", Assert.Single(spy.Sent).Id);
    }
}

public class RecentSelectionTests
{
    [Fact]
    public void PicksTheNewestEntryThatNamesAProject()
    {
        var selection = RecentSelectionClient.NewestSelection(
        [
            new RecentEntryRow("2026-08-20T09:00:00.000Z", "p-old", "t-old"),
            new RecentEntryRow("2026-08-24T09:00:00.000Z", "p-new", "t-new"),
            new RecentEntryRow("2026-08-22T09:00:00.000Z", "p-mid", null),
        ]);

        Assert.Equal(new StoredSelection("p-new", "t-new"), selection);
    }

    /// <summary>Time tracked against no project says nothing about which project to restore.</summary>
    [Fact]
    public void SkipsEntriesWithoutAProject()
    {
        var selection = RecentSelectionClient.NewestSelection(
        [
            new RecentEntryRow("2026-08-24T09:00:00.000Z", null, null),
            new RecentEntryRow("2026-08-20T09:00:00.000Z", "p1", null),
        ]);

        Assert.Equal(new StoredSelection("p1", null), selection);
    }

    [Fact]
    public void NoHistoryMeansNothingToRestore() =>
        Assert.Null(RecentSelectionClient.NewestSelection([]));
}

public class TrayTooltipTests
{
    [Fact]
    public void SaysWhetherTheClockIsRunning()
    {
        Assert.Equal("Nifty Timer — tracking 0:12:00", TrayTooltip.For(true, "0:12:00", false, false));
        Assert.Equal("Nifty Timer — not tracking", TrayTooltip.For(false, "0:00:00", false, false));
    }

    [Fact]
    public void AnOverdueUpdateIsMarked()
    {
        var tooltip = TrayTooltip.For(false, "0:00:00", liveSyncBlocked: false, updateOverdue: true);

        Assert.StartsWith("⚠", tooltip, StringComparison.Ordinal);
        Assert.Contains("update", tooltip, StringComparison.Ordinal);
    }

    /// <summary>Time not reaching the server outranks an advisory update.</summary>
    [Fact]
    public void ABlockedLiveEntryOutranksTheUpdate()
    {
        var tooltip = TrayTooltip.For(true, "0:12:00", liveSyncBlocked: true, updateOverdue: true);

        Assert.Contains("server", tooltip, StringComparison.Ordinal);
        Assert.DoesNotContain("update", tooltip, StringComparison.Ordinal);
    }

    /// <summary>Shell_NotifyIcon keeps 127 characters; the warning must survive intact.</summary>
    [Fact]
    public void TheLongestTooltipFitsTheShellLimit() =>
        Assert.True(TrayTooltip.For(true, "123:59:59", liveSyncBlocked: true, updateOverdue: true).Length <= 127);
}

/// <summary>Wiring asserted on the IL, as in <see cref="LaunchResolutionWiringTests"/>.</summary>
public class ReminderWiringTests
{
    private static bool References(string method, string typeName, string target) =>
        LaunchResolutionWiringTests.References(LaunchResolutionWiringTests.Body(method), typeName, target);

    [Fact]
    public void AutoModeInstallsTheReminder() =>
        Assert.True(References("InstallIdleDetection", nameof(AppDelegate), "PresentNotTrackingReminder"));

    /// <summary>A reminder left up across sign-out would start the NEXT person's clock.</summary>
    [Fact]
    public void SignOutDismissesTheReminder() =>
        Assert.True(References("TearDownIdleDetection", nameof(NotTrackingReminder), nameof(NotTrackingReminder.DismissIfShowing)));

    [Fact]
    public void AProjectRefreshTriesTheFreshInstallFallback()
    {
        Assert.True(References("RefreshProjectsAsync", nameof(AppDelegate), "TryRecentSelectionFallbackAsync"));
        Assert.True(References(
            "TryRecentSelectionFallbackAsync",
            nameof(RecentSelectionClient),
            nameof(RecentSelectionClient.MostRecentSelectionAsync)));
    }
}
