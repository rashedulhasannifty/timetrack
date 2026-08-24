using NiftyTimer.App;
using NiftyTimer.Policy;
using NiftyTimer.Projects;
using NiftyTimer.Reports;
using NiftyTimer.Storage;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

public class AppInstallTests
{
    [Fact]
    public void TheProductionAppIdHasNoVariant() =>
        Assert.Null(AppInstall.Variant(AppInstall.ProductionAppId));

    /// <summary>
    /// A checkout run without packaged settings has no app id. It is treated as a DEV install
    /// rather than silently borrowing production's state — running from a checkout is the most
    /// likely way to collide with a real install on the same machine, and sharing the container
    /// is lossy, not untidy: both processes drain the same buffers.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void AMissingAppIdIsTreatedAsADevInstall(string? appId)
    {
        Assert.Equal("dev", AppInstall.Variant(appId));
        Assert.False(AppInstall.IsProduction(appId));
    }

    [Fact]
    public void ASuffixedAppIdYieldsItsTail() =>
        Assert.Equal("dev", AppInstall.Variant($"{AppInstall.ProductionAppId}.dev"));

    [Fact]
    public void AForeignAppIdIsUsedWhole() =>
        Assert.Equal("com.example.other", AppInstall.Variant("com.example.other"));

    [Fact]
    public void PathSeparatorsCannotEscapeTheContainer()
    {
        var variant = AppInstall.Variant($"{AppInstall.ProductionAppId}.a/b\\c:d");

        Assert.Equal("a-b-c-d", variant);
        Assert.DoesNotContain('/', variant!);
        Assert.DoesNotContain('\\', variant!);
    }

    [Fact]
    public void EachInstallGetsItsOwnContainerAndTokenFile()
    {
        var production = AppInstall.ProductionAppId;
        var dev = $"{AppInstall.ProductionAppId}.dev";

        Assert.Equal("NiftyTimer", AppInstall.SupportDirectoryName(production));
        Assert.Equal("NiftyTimer-dev", AppInstall.SupportDirectoryName(dev));
        Assert.NotEqual(AppInstall.TokenFileName(production), AppInstall.TokenFileName(dev));
        Assert.NotEqual(AppInstall.SupportDirectory(production), AppInstall.SupportDirectory(dev));
    }

    [Fact]
    public void OnlyTheProductionAppIdIsProduction()
    {
        Assert.True(AppInstall.IsProduction(AppInstall.ProductionAppId));
        Assert.False(AppInstall.IsProduction($"{AppInstall.ProductionAppId}.staging"));
    }
}

public class AppConfigTests
{
    /// <summary>
    /// <c>new Uri(base, "projects")</c> against <c>https://host/v1</c> resolves to
    /// <c>https://host/projects</c> — silently dropping the version prefix. A shipped client pins
    /// <c>/v1</c> forever, so the trailing slash is load-bearing.
    /// </summary>
    [Fact]
    public void TheApiBaseKeepsItsVersionPrefixWhenRelativePathsAreResolved()
    {
        var config = new AppConfig { ApiBaseUrl = "https://timer.example.com/v1" };

        Assert.Equal("https://timer.example.com/v1/projects", new Uri(config.ApiBaseUri, "projects").ToString());
        Assert.Equal(
            "https://timer.example.com/v1/users/abc/ack-monitoring",
            new Uri(config.ApiBaseUri, "users/abc/ack-monitoring").ToString());
    }

    [Fact]
    public void AnAlreadySlashedBaseIsNotDoubled()
    {
        var config = new AppConfig { ApiBaseUrl = "https://timer.example.com/v1/" };

        Assert.Equal("https://timer.example.com/v1/projects", new Uri(config.ApiBaseUri, "projects").ToString());
    }

    /// <summary>A developer checkout must talk to localhost, never to production.</summary>
    [Fact]
    public void TheFallbacksPointAtLocalhost()
    {
        var config = new AppConfig();

        Assert.Contains("127.0.0.1", config.ApiBaseUrl, StringComparison.Ordinal);
        Assert.EndsWith("/v1", config.ApiBaseUrl, StringComparison.Ordinal);
        Assert.Contains("127.0.0.1", config.DashboardUrl, StringComparison.Ordinal);
    }
}

public class UuidV7Tests
{
    [Fact]
    public void HasTheCanonicalShapeVersionAndVariant()
    {
        var id = UuidV7.Generate(DateTimeOffset.UnixEpoch, () => 0xFF);

        Assert.Matches("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", id);
        Assert.True(Guid.TryParse(id, out _));
    }

    /// <summary>
    /// The first 48 bits are a big-endian millisecond timestamp. That is what makes these ids sort
    /// chronologically, which is what lets the server use them as a primary key without a separate
    /// ordering column.
    /// </summary>
    [Fact]
    public void EncodesTheTimestampInTheLeadingBits()
    {
        var t = DateTimeOffset.FromUnixTimeMilliseconds(0x0123456789AB);

        var id = UuidV7.Generate(t, () => 0x00);

        Assert.StartsWith("0123456789ab", id.Replace("-", string.Empty), StringComparison.Ordinal);
    }

    [Fact]
    public void LaterTimestampsSortLater()
    {
        var t = new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

        var a = UuidV7.Generate(t, () => 0x00);
        var b = UuidV7.Generate(t.AddMilliseconds(1), () => 0x00);

        Assert.True(string.CompareOrdinal(a, b) < 0);
    }

    [Fact]
    public void GeneratesDistinctIdsWithinTheSameMillisecond()
    {
        var t = new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

        var ids = Enumerable.Range(0, 500).Select(_ => UuidV7.Generate(t)).ToHashSet();

        Assert.Equal(500, ids.Count);
    }

    /// <summary>
    /// RFC 3339, UTC, no fractional seconds — what the shipped Mac client sends and what
    /// <c>z.iso.datetime()</c> accepts.
    /// </summary>
    [Fact]
    public void IsoFormatsAsUtcWithoutFractionalSeconds()
    {
        var local = new DateTimeOffset(2026, 8, 25, 15, 4, 5, 678, TimeSpan.FromHours(6));

        Assert.Equal("2026-08-25T09:04:05Z", UuidV7.Iso(local));
    }
}

public class SelectionResolverTests
{
    private static readonly Project Active =
        new("p1", "team", "Platform", false, [new ProjectTask("t1", "p1", "Sync engine")]);

    private static readonly Project Archived = new("p2", "team", "Old", true, null);

    [Fact]
    public void NoStoredSelectionResolvesToNothing() =>
        Assert.Null(SelectionResolver.Resolve(null, [Active]));

    [Fact]
    public void AValidSelectionSurvives()
    {
        var stored = new StoredSelection("p1", "t1");

        Assert.Equal(stored, SelectionResolver.Resolve(stored, [Active]));
    }

    [Fact]
    public void AnArchivedProjectIsDropped() =>
        Assert.Null(SelectionResolver.Resolve(new StoredSelection("p2", null), [Active, Archived]));

    [Fact]
    public void AMissingProjectIsDropped() =>
        Assert.Null(SelectionResolver.Resolve(new StoredSelection("gone", null), [Active]));

    /// <summary>
    /// A removed task degrades one step rather than dropping the whole selection: the project
    /// choice is still valid and is the part that decides where the time lands.
    /// </summary>
    [Fact]
    public void ARemovedTaskKeepsTheProject()
    {
        var resolved = SelectionResolver.Resolve(new StoredSelection("p1", "gone"), [Active]);

        Assert.Equal(new StoredSelection("p1", null), resolved);
    }
}

public class SelectionStoreTests
{
    [Fact]
    public void RoundTripsPerUser()
    {
        var store = new SelectionStore(new InMemoryUserSettings());

        store.Save(new StoredSelection("p1", "t1"), "user-a");

        Assert.Equal(new StoredSelection("p1", "t1"), store.Load("user-a"));
        Assert.Null(store.Load("user-b"));
    }

    [Fact]
    public void ClearRemovesOnlyThatUser()
    {
        var store = new SelectionStore(new InMemoryUserSettings());
        store.Save(new StoredSelection("p1", null), "user-a");
        store.Save(new StoredSelection("p2", null), "user-b");

        store.Clear("user-a");

        Assert.Null(store.Load("user-a"));
        Assert.NotNull(store.Load("user-b"));
    }
}

public class AckMarkerTests
{
    [Fact]
    public void RecordsAndReadsPerUser()
    {
        var marker = new AckMarker(new InMemoryUserSettings());

        marker.Record("user-a", "v2");

        Assert.True(marker.HasAcknowledged("user-a"));
        Assert.False(marker.HasAcknowledged("user-b"));
    }

    /// <summary>
    /// Cleared on sign-out. Otherwise one user's acknowledgement would grant offline readiness to
    /// whoever signs in next on the same machine (CLAUDE.md §1).
    /// </summary>
    [Fact]
    public void ClearRevokesReadinessForThatUser()
    {
        var marker = new AckMarker(new InMemoryUserSettings());
        marker.Record("user-a", "v2");

        marker.Clear("user-a");

        Assert.False(marker.HasAcknowledged("user-a"));
    }
}

public class LivePolicyTests
{
    [Fact]
    public void StartsPendingAndCapturesNothing()
    {
        var live = new LivePolicy();

        Assert.False(live.Current.CaptureWindowTitles);
        Assert.False(live.Current.DistractionAlertsEnabled);
    }

    [Fact]
    public void UpdateSwapsTheWholeSnapshot()
    {
        var live = new LivePolicy();

        live.Update(new PolicySettings { CaptureWindowTitles = true, ScreenshotIntervalMinutes = 3 });

        Assert.True(live.Current.CaptureWindowTitles);
        Assert.Equal(3, live.Current.ScreenshotIntervalMinutes);
    }

    /// <summary>
    /// The gate publishes from a background cycle while samplers read from theirs. A reader must
    /// see one coherent snapshot, never a half-applied policy.
    /// </summary>
    [Fact]
    public async Task ReadersAlwaysSeeACoherentSnapshot()
    {
        var live = new LivePolicy();
        using var stop = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

        var writer = Task.Run(
            () =>
            {
                var n = 0;
                while (!stop.IsCancellationRequested)
                {
                    n++;
                    live.Update(new PolicySettings
                    {
                        ScreenshotIntervalMinutes = n % 2 == 0 ? 5 : 15,
                        CaptureWindowTitles = n % 2 == 0,
                    });
                }
            },
            CancellationToken.None);

        var reader = Task.Run(
            () =>
            {
                while (!stop.IsCancellationRequested)
                {
                    var snapshot = live.Current;

                    // The two fields are written together, so they must never disagree.
                    Assert.Equal(snapshot.CaptureWindowTitles, snapshot.ScreenshotIntervalMinutes == 5);
                }
            },
            CancellationToken.None);

        await Task.WhenAll(writer, reader);
    }
}

public class MenuViewModelTests
{
    private static MenuViewModel NewViewModel(out BufferSpy buffer) =>
        NewViewModel(out buffer, out _);

    private static MenuViewModel NewViewModel(out BufferSpy buffer, out TimeTracker tracker)
    {
        buffer = new BufferSpy();
        tracker = new TimeTracker(buffer, () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
        return new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()));
    }

    private static string RunningEntryId(TimeTracker tracker) =>
        ((TrackerState.Tracking)tracker.State).EntryId;

    /// <summary>
    /// Manual tracking is not a capture path, so it is not behind the gate — the rule that an
    /// un-acknowledged user cannot start the clock lives here instead, and needs its own test.
    /// </summary>
    [Fact]
    public void StartDoesNothingUntilTheSessionIsReady()
    {
        var vm = NewViewModel(out var buffer);

        vm.Start();

        Assert.False(vm.IsTracking);
        Assert.Empty(buffer.Entries);
    }

    [Fact]
    public void StartWorksOnceReady()
    {
        var vm = NewViewModel(out _);
        vm.IsReady = true;

        vm.Start();

        Assert.True(vm.IsTracking);
        Assert.False(vm.CanStart);
        Assert.True(vm.CanStop);
    }

    /// <summary>
    /// The 409 rollback, from the user's side: the clock stops, they are told why, and the vague
    /// "not reaching the server" warning is cleared rather than shown alongside it.
    /// </summary>
    [Fact]
    public void ATrackingConflictStopsTheClockAndExplainsItself()
    {
        var vm = NewViewModel(out var buffer, out var tracker);
        vm.IsReady = true;
        vm.Start();
        vm.LiveSyncBlocked = true;

        vm.HandleTrackingConflict(RunningEntryId(tracker));

        Assert.False(vm.IsTracking);
        Assert.False(vm.LiveSyncBlocked);
        Assert.Contains("another machine", vm.Notice, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(buffer.Entries); // nothing fabricated for a span the server never accepted
    }

    /// <summary>
    /// The publish is fire-and-forget, so a 409 for a span that has since been superseded must not
    /// stop the clock that is running now. Picking a project right after Start is the common way
    /// to produce exactly that ordering.
    /// </summary>
    [Fact]
    public void AConflictForASupersededSpanIsIgnored()
    {
        var vm = NewViewModel(out _, out var tracker);
        vm.IsReady = true;
        vm.Projects = [new Project("p1", "team", "One", false, null), new Project("p2", "team", "Two", false, null)];
        vm.Start();
        var firstSpan = RunningEntryId(tracker);

        vm.SelectProject("p2", null); // closes the first span, opens a second

        vm.HandleTrackingConflict(firstSpan); // the late 409 for the span that is already gone

        Assert.True(vm.IsTracking);
        Assert.Null(vm.Notice);
    }

    [Fact]
    public void StartingAgainClearsAStaleNotice()
    {
        var vm = NewViewModel(out _, out var tracker);
        vm.IsReady = true;
        vm.Start();
        vm.HandleTrackingConflict(RunningEntryId(tracker));

        vm.Start();

        Assert.Null(vm.Notice);
        Assert.True(vm.IsTracking);
    }

    /// <summary>
    /// A project switch DOES re-attribute time, so the running span is closed and reopened — the
    /// opposite of a note change, which edits in place.
    /// </summary>
    [Fact]
    public void SwitchingProjectWhileTrackingClosesAndReopensTheSpan()
    {
        var vm = NewViewModel(out var buffer);
        vm.IsReady = true;
        vm.Projects = [new Project("p1", "team", "One", false, null), new Project("p2", "team", "Two", false, null)];
        vm.Start();

        vm.SelectProject("p2", null);

        Assert.Single(buffer.Entries); // the first span was closed
        Assert.True(vm.IsTracking);
        Assert.Equal("Two", vm.SelectionLabel);
    }

    /// <summary>
    /// Sign-out drops everything user-specific from memory, so the next person to sign in on this
    /// machine cannot inherit a wrong-team selection or someone else's totals.
    /// </summary>
    [Fact]
    public void ResetDropsEverythingUserSpecific()
    {
        var vm = NewViewModel(out _);
        vm.IsReady = true;
        vm.Projects = [new Project("p1", "team", "One", false, null)];
        vm.SelectProject("p1", null);
        vm.Totals = new SelfTotals("2026-08-25", "2026-08-24", "2026-08-01", 100, 200, 300);
        vm.PendingCount = 4;

        vm.Reset();

        Assert.False(vm.IsReady);
        Assert.Empty(vm.Projects);
        Assert.Null(vm.Selection);
        Assert.Null(vm.Totals);
        Assert.Equal(0, vm.PendingCount);
        Assert.Null(vm.UserId);
    }

    [Fact]
    public void TotalsRenderAsDashesUntilTheyLoad()
    {
        var vm = NewViewModel(out _);

        Assert.Equal("—", vm.TodayLabel);
        Assert.Equal("—", vm.WeekLabel);
        Assert.Equal("—", vm.MonthLabel);
    }

    [Fact]
    public void PendingLabelReadsNaturallyForOne()
    {
        var vm = NewViewModel(out _);

        vm.PendingCount = 1;
        Assert.Equal("1 record pending", vm.PendingLabel);

        vm.PendingCount = 3;
        Assert.Equal("3 records pending", vm.PendingLabel);
    }
}

public class WorkTotalFormatTests
{
    [Theory]
    [InlineData(0, "0m")]
    [InlineData(59, "0m")]
    [InlineData(720, "12m")]
    [InlineData(3600, "1h 0m")]
    [InlineData(29520, "8h 12m")]
    [InlineData(-5, "0m")]
    public void ShortFormatsWholeMinutes(int seconds, string expected) =>
        Assert.Equal(expected, WorkTotalFormat.Short(seconds));

    [Fact]
    public void ElapsedCountsPastTwentyFourHours() =>
        Assert.Equal("26:01:05", WorkTotalFormat.Elapsed(TimeSpan.FromSeconds((26 * 3600) + 65)));

    [Fact]
    public void ElapsedNeverGoesNegative() =>
        Assert.Equal("0:00:00", WorkTotalFormat.Elapsed(TimeSpan.FromSeconds(-10)));
}
