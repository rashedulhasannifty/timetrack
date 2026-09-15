using NiftyTimer.App;
using NiftyTimer.Projects;
using NiftyTimer.Reports;
using NiftyTimer.Storage;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The dropdown's Today / This week / This month figures, live while the clock runs. Ported from
/// the macOS client's <c>MenuViewModel.liveTotal</c>.
/// </summary>
public class LiveTotalsTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void AStoppedClockAddsNothing() =>
        Assert.Equal(3600, MenuViewModel.LiveTotal(3600, runningSince: null, fetchedAt: T0, now: T0.AddMinutes(30)));

    /// <summary>The fetched figure already counts the session up to the fetch; count only the rest.</summary>
    [Fact]
    public void ASessionRunningAtTheFetchCountsOnlyTheTimeSince() =>
        Assert.Equal(3600 + 1200, MenuViewModel.LiveTotal(3600, T0, T0.AddMinutes(10), T0.AddMinutes(30)));

    /// <summary>A session that began after the fetch counts from its own start, not the fetch.</summary>
    [Fact]
    public void ASessionStartedAfterTheFetchCountsFromItsStart() =>
        Assert.Equal(3600 + 600, MenuViewModel.LiveTotal(3600, T0.AddMinutes(20), T0, T0.AddMinutes(30)));

    [Fact]
    public void NoFetchYetMeansNoIncrement() =>
        Assert.Equal(3600, MenuViewModel.LiveTotal(3600, T0, fetchedAt: null, now: T0.AddMinutes(30)));

    [Fact]
    public void AClockThatWentBackwardsNeverSubtracts() =>
        Assert.Equal(3600, MenuViewModel.LiveTotal(3600, T0, T0.AddMinutes(10), T0.AddMinutes(5)));

    [Fact]
    public void TheLabelsMoveWhileTheClockRuns()
    {
        var rig = Rig.Build();
        rig.ViewModel.Start();
        rig.Now = T0.AddMinutes(10);
        rig.ViewModel.Totals = Totals(3600);

        rig.Now = T0.AddMinutes(40);

        Assert.Equal("1h 30m", rig.ViewModel.TodayLabel);
        Assert.Equal("1h 30m", rig.ViewModel.WeekLabel);
        Assert.Equal("1h 30m", rig.ViewModel.MonthLabel);
    }

    /// <summary>
    /// Stopping ends the increment, so the figures drop back to the last fetch until fresh ones
    /// arrive — which is why stopping asks for them.
    /// </summary>
    [Fact]
    public void StoppingEndsTheIncrementAndAsksForFreshTotals()
    {
        var rig = Rig.Build();
        rig.ViewModel.Start();
        rig.ViewModel.Totals = Totals(3600);
        rig.Now = T0.AddMinutes(30);

        rig.ViewModel.Stop();

        Assert.Equal(1, rig.StoppedCount);
        Assert.Equal("1h 0m", rig.ViewModel.TodayLabel);
    }

    [Fact]
    public void PausingAlsoAsksForFreshTotals()
    {
        var rig = Rig.Build();
        rig.ViewModel.Start();

        rig.ViewModel.Pause();

        Assert.Equal(1, rig.StoppedCount);
    }

    /// <summary>A project switch closes and reopens the span, but the clock never stops.</summary>
    [Fact]
    public void StartingAndSwitchingProjectsDoNotAskForTotals()
    {
        var rig = Rig.Build();
        rig.ViewModel.Projects = [new Project("p1", "team", "One", false, null), new Project("p2", "team", "Two", false, null)];

        rig.ViewModel.Start();
        rig.ViewModel.SelectProject("p2", null);

        Assert.Equal(0, rig.StoppedCount);
    }

    [Fact]
    public void TheOneSecondTickRedrawsTheTotals()
    {
        var rig = Rig.Build();
        var raised = new List<string?>();
        rig.ViewModel.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        rig.ViewModel.Tick();

        Assert.Contains(nameof(MenuViewModel.TodayLabel), raised);
    }

    private static SelfTotals Totals(int seconds) =>
        new("2026-08-25", "2026-08-24", "2026-08-01", seconds, seconds, seconds);

    private sealed class Rig
    {
        public DateTimeOffset Now = T0;

        public MenuViewModel ViewModel { get; private set; } = null!;

        public int StoppedCount { get; private set; }

        public static Rig Build()
        {
            var rig = new Rig();
            var tracker = new TimeTracker(new BufferSpy(), () => rig.Now);
            rig.ViewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()), () => rig.Now)
            {
                IsReady = true,
            };
            rig.ViewModel.TrackingStopped += () => rig.StoppedCount++;
            return rig;
        }
    }
}

public class RefreshThrottleTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void TheFirstRequestAlwaysRefreshes() =>
        Assert.True(new RefreshThrottle(TimeSpan.FromSeconds(60), () => T0).ShouldRefresh());

    [Fact]
    public void RepeatsInsideTheWindowAreSkipped()
    {
        var now = T0;
        var throttle = new RefreshThrottle(TimeSpan.FromSeconds(60), () => now);
        throttle.ShouldRefresh();

        now = T0.AddSeconds(59);
        Assert.False(throttle.ShouldRefresh());

        now = T0.AddSeconds(60);
        Assert.True(throttle.ShouldRefresh());
    }

    [Fact]
    public void ResetLetsTheNextPersonRefreshAtOnce()
    {
        var throttle = new RefreshThrottle(TimeSpan.FromSeconds(60), () => T0);
        throttle.ShouldRefresh();

        throttle.Reset();

        Assert.True(throttle.ShouldRefresh());
    }
}

/// <summary>Wiring asserted on the IL, as in <see cref="LaunchResolutionWiringTests"/>.</summary>
public class MenuRefreshWiringTests
{
    private static bool References(string method, string typeName, string target) =>
        LaunchResolutionWiringTests.References(LaunchResolutionWiringTests.Body(method), typeName, target);

    [Theory]
    [InlineData("RefreshProjectsAsync")]
    [InlineData("RefreshTotalsAsync")]
    [InlineData("RefreshPendingCount")]
    public void OpeningTheMenuRefreshes(string refresh) =>
        Assert.True(References("MenuDidOpen", nameof(AppDelegate), refresh), $"MenuDidOpen no longer calls {refresh}.");

    [Fact]
    public void BothTrayGesturesOpenTheMenu() =>
        Assert.True(References("WireEvents", nameof(AppDelegate), "OnTrayActivated"));

    [Fact]
    public void TheTrayHandlerRunsTheMenuOpenRefresh() =>
        Assert.True(References("OnTrayActivated", nameof(AppDelegate), "MenuDidOpen"));

    [Fact]
    public void StoppingTheClockRefetchesTotals()
    {
        Assert.True(References("WireEvents", nameof(AppDelegate), "OnTrackingStopped"));
        Assert.True(References("OnTrackingStopped", nameof(AppDelegate), "RefreshTotalsAsync"));
    }

    /// <summary>The next person's first menu open must not be throttled by the previous one's.</summary>
    [Fact]
    public void SignOutResetsTheThrottles() =>
        Assert.True(References("SignOutAsync", nameof(RefreshThrottle), nameof(RefreshThrottle.Reset)));

    /// <summary>
    /// A fetch in flight when sign-out lands must not put one person's tracked time in the next
    /// person's dropdown, so the result is checked against the session it was requested for.
    /// </summary>
    [Fact]
    public void ALateTotalsResultIsCheckedAgainstTheSession() =>
        Assert.True(References("RefreshTotalsAsync", "AuthSession", "get_UserId"));
}
