using System.Reflection;
using NiftyTimer.Activity;
using NiftyTimer.Policy;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

public class ActivityRateMeterTests
{
    [Fact]
    public void NoInputAtAllIsZeroPercent()
    {
        var meter = new ActivityRateMeter(12);
        for (var i = 0; i < 12; i++)
        {
            meter.AddBucket(0, 0);
        }

        Assert.Equal(0, meter.ActivityPct());
    }

    [Fact]
    public void EveryBucketActiveIsOneHundredPercent()
    {
        var meter = new ActivityRateMeter(12);
        for (var i = 0; i < 12; i++)
        {
            meter.AddBucket(1, 0);
        }

        Assert.Equal(100, meter.ActivityPct());
    }

    /// <summary>A bucket is active on key OR pointer — moving the mouse is working.</summary>
    [Fact]
    public void PointerOnlyCountsAsActive()
    {
        var meter = new ActivityRateMeter(4);
        meter.AddBucket(0, 3);
        meter.AddBucket(0, 0);
        meter.AddBucket(0, 0);
        meter.AddBucket(0, 0);

        Assert.Equal(25, meter.ActivityPct());
    }

    [Fact]
    public void ItRoundsToTheNearestPercent()
    {
        var meter = new ActivityRateMeter(12);
        for (var i = 0; i < 5; i++)
        {
            meter.AddBucket(1, 1);
        }

        for (var i = 0; i < 7; i++)
        {
            meter.AddBucket(0, 0);
        }

        Assert.Equal(42, meter.ActivityPct()); // 5/12 = 41.67
    }

    /// <summary>
    /// A cycle that somehow over-runs its bucket count must not be able to report above the
    /// server's 0–100 bound, which would 422 the whole batch.
    /// </summary>
    [Fact]
    public void ExtraBucketsAreIgnoredRatherThanExceedingOneHundred()
    {
        var meter = new ActivityRateMeter(4);
        for (var i = 0; i < 10; i++)
        {
            meter.AddBucket(1, 1);
        }

        Assert.Equal(100, meter.ActivityPct());
    }
}

/// <summary>
/// A structural guard on CLAUDE.md §1, not a behavioural test.
///
/// On macOS "counts, not content" is guaranteed by the platform — the counter API cannot return
/// key identity. On Windows the underlying APIs can, so the guarantee lives in the shape of this
/// interface: two counters and nothing else. The assertion is on the EXACT member set, not
/// containment, so adding a <c>LastVirtualKey</c> or a <c>RecentScanCodes</c> fails CI rather than
/// shipping.
/// </summary>
public class EventCounterBoundaryTests
{
    [Fact]
    public void TheInputBoundaryExposesTwoCountersAndNothingElse()
    {
        var members = typeof(IInputCounting)
            .GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Select(m => m is PropertyInfo p ? $"{p.PropertyType.Name} {p.Name}" : m.Name)
            .Where(name => !name.StartsWith("get_", StringComparison.Ordinal))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(["Int64 KeyEvents", "Int64 PointerEvents"], members);
    }

    /// <summary>
    /// The properties are read-only on purpose: a settable counter is a channel, and a channel is
    /// how content would eventually get across.
    /// </summary>
    [Fact]
    public void TheCountersAreReadOnly()
    {
        foreach (var property in typeof(IInputCounting).GetProperties())
        {
            Assert.False(property.CanWrite, $"{property.Name} must not be settable.");
        }
    }
}

public class AppSamplerTests
{
    private static AppSampler.ForegroundProcess Process(
        string path = @"C:\Program Files\Microsoft VS Code\Code.exe",
        string? description = "Visual Studio Code",
        string? title = "README.md - timetrack") =>
        new(path, description, title);

    /// <summary>
    /// A locked session or the secure desktop has no readable foreground. Reporting "Unknown" is
    /// deliberate: the server requires an appName, and a sample saying "we were watching and could
    /// not tell" is more honest than silently skipping the interval.
    /// </summary>
    [Fact]
    public void AnUnreadableForegroundIsReportedAsUnknown()
    {
        var snapshot = AppSampler.Describe(null, captureWindowTitles: true);

        Assert.Equal("Unknown", snapshot.AppName);
        Assert.Null(snapshot.BundleId);
        Assert.Null(snapshot.WindowTitle);
    }

    /// <summary>
    /// The bundleId convention is permanent — it is what lands in the admin's rule picker — so it
    /// is pinned here: the lowercased executable filename, without extension and without path.
    /// </summary>
    [Fact]
    public void TheBundleIdIsTheLowercasedExecutableStem()
    {
        var snapshot = AppSampler.Describe(Process(), captureWindowTitles: true);

        Assert.Equal("code", snapshot.BundleId);
    }

    [Fact]
    public void TheAppNameComesFromTheFileDescription()
    {
        var snapshot = AppSampler.Describe(Process(), captureWindowTitles: true);

        Assert.Equal("Visual Studio Code", snapshot.AppName);
    }

    /// <summary>Plenty of Win32 executables carry no version resource at all.</summary>
    [Fact]
    public void TheAppNameFallsBackToTheFilenameWhenThereIsNoDescription()
    {
        var snapshot = AppSampler.Describe(Process(description: null), captureWindowTitles: true);

        Assert.Equal("Code", snapshot.AppName);
        Assert.Equal("code", snapshot.BundleId);
    }

    /// <summary>
    /// PRD §13 — a team that opts out of window titles must get an explicit null, not an empty
    /// string. The server distinguishes "no title captured" from "a title that happened to be
    /// blank", and only the first is a truthful record of an opted-out team.
    /// </summary>
    [Fact]
    public void OptingOutOfTitlesYieldsNullNotEmpty()
    {
        var snapshot = AppSampler.Describe(Process(), captureWindowTitles: false);

        Assert.Null(snapshot.WindowTitle);
        Assert.Equal("Visual Studio Code", snapshot.AppName); // the rest of the sample is unaffected
    }

    [Fact]
    public void AnEmptyTitleIsNullRatherThanEmpty()
    {
        var snapshot = AppSampler.Describe(Process(title: string.Empty), captureWindowTitles: true);

        Assert.Null(snapshot.WindowTitle);
    }

    /// <summary>Server bounds: windowTitle ≤120, appName ≤200. Over either is a 422.</summary>
    [Fact]
    public void TitleAndAppNameAreTruncatedToTheServerBounds()
    {
        var snapshot = AppSampler.Describe(
            Process(description: new string('a', 500), title: new string('b', 500)),
            captureWindowTitles: true);

        Assert.Equal(200, snapshot.AppName.Length);
        Assert.Equal(120, snapshot.WindowTitle!.Length);
    }
}

public class ActivitySamplerTests
{
    private static AckGate OpenGate(LivePolicy livePolicy, PolicySettings? settings = null)
    {
        var provider = new FakePolicyProvider(
            FakePolicyProvider.Policy(ackRequired: false, settings ?? new PolicySettings()));
        return new AckGate(provider, policy => livePolicy.Update(policy.Settings));
    }

    private static ActivitySampler Build(
        AckGate gate,
        LivePolicy livePolicy,
        ActivityBufferSpy store,
        FakeInputCounter counter,
        Func<bool>? isTracking = null,
        FakeAppSampler? appSampler = null,
        Action<int>? onBucket = null,
        TimeSpan? interval = null,
        int subBuckets = 12)
    {
        var bucket = 0;
        return new ActivitySampler(
            gate,
            counter,
            appSampler ?? new FakeAppSampler(),
            livePolicy,
            store,
            isTracking ?? (() => true),
            interval ?? TimeSpan.FromSeconds(60),
            subBuckets,
            idGen: static now => $"id-{now.ToUnixTimeMilliseconds()}",
            clock: static () => DateTimeOffset.Parse("2026-08-25T09:00:00Z", null),
            sleep: (_, _) =>
            {
                onBucket?.Invoke(bucket++);
                return Task.CompletedTask;
            });
    }

    [Fact]
    public async Task ItEnqueuesOneSamplePerMeasuredInterval()
    {
        var livePolicy = new LivePolicy();
        var store = new ActivityBufferSpy();
        var counter = new FakeInputCounter();
        var sampler = Build(OpenGate(livePolicy), livePolicy, store, counter);

        Assert.True(await sampler.CaptureTickAsync());

        var sample = Assert.Single(store.Samples);
        Assert.Equal("Visual Studio Code", sample.AppName);
        Assert.Equal("code", sample.BundleId);
        Assert.Equal("2026-08-25T09:00:00Z", sample.Timestamp);
    }

    /// <summary>Half the buckets carry input, so the sample reports half activity.</summary>
    [Fact]
    public async Task ActivityPercentageComesFromTheSubBuckets()
    {
        var livePolicy = new LivePolicy();
        var store = new ActivityBufferSpy();
        var counter = new FakeInputCounter();
        var sampler = Build(
            OpenGate(livePolicy),
            livePolicy,
            store,
            counter,
            onBucket: index =>
            {
                if (index < 6)
                {
                    counter.Type();
                }
            });

        await sampler.CaptureTickAsync();

        Assert.Equal(50, Assert.Single(store.Samples).ActivityPct);
    }

    /// <summary>
    /// A stopped clock must not cost a policy fetch. Checking the gate first would have an idle
    /// laptop polling the API once a minute, all day, to be told each time that it may capture
    /// something it is not going to capture.
    /// </summary>
    [Fact]
    public async Task AStoppedClockIsCheckedBeforeTheGateIsEverAsked()
    {
        var livePolicy = new LivePolicy();
        var provider = new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: false));
        var gate = new AckGate(provider);
        var store = new ActivityBufferSpy();
        var sampler = Build(gate, livePolicy, store, new FakeInputCounter(), isTracking: () => false);

        Assert.False(await sampler.CaptureTickAsync());

        Assert.Equal(0, provider.Calls);
        Assert.Empty(store.Samples);
    }

    /// <summary>An un-acknowledged user produces no sample at all — not a blank one.</summary>
    [Fact]
    public async Task AClosedGateSkipsTheWholeInterval()
    {
        var livePolicy = new LivePolicy();
        var gate = new AckGate(new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: true)));
        var store = new ActivityBufferSpy();
        var sampler = Build(gate, livePolicy, store, new FakeInputCounter());

        Assert.False(await sampler.CaptureTickAsync());
        Assert.Empty(store.Samples);
    }

    [Fact]
    public async Task AnUnreachablePolicyAlsoSkipsTheInterval()
    {
        var livePolicy = new LivePolicy();
        var gate = new AckGate(new FailingPolicyProvider());
        var store = new ActivityBufferSpy();
        var sampler = Build(gate, livePolicy, store, new FakeInputCounter());

        Assert.False(await sampler.CaptureTickAsync());
        Assert.Empty(store.Samples);
    }

    /// <summary>The gate is re-asked every tick, so revoking acknowledgement stops capture
    /// mid-session rather than at the next launch.</summary>
    [Fact]
    public async Task TheGateIsReCheckedOnEveryTick()
    {
        var livePolicy = new LivePolicy();
        var acknowledged = true;
        var provider = new FakePolicyProvider(() => FakePolicyProvider.Policy(ackRequired: !acknowledged));
        var gate = new AckGate(provider, policy => livePolicy.Update(policy.Settings));
        var store = new ActivityBufferSpy();
        var sampler = Build(gate, livePolicy, store, new FakeInputCounter());

        Assert.True(await sampler.CaptureTickAsync());

        acknowledged = false;
        Assert.False(await sampler.CaptureTickAsync());

        Assert.Single(store.Samples);
    }

    [Fact]
    public async Task TheSampleIsCategorizedAgainstTheLiveTeamLists()
    {
        var livePolicy = new LivePolicy();
        var settings = new PolicySettings { UnproductiveApps = ["code"] };
        var store = new ActivityBufferSpy();
        var sampler = Build(OpenGate(livePolicy, settings), livePolicy, store, new FakeInputCounter());

        await sampler.CaptureTickAsync();

        Assert.Equal("UNPRODUCTIVE", Assert.Single(store.Samples).Category);
    }

    /// <summary>
    /// Cancellation mid-measurement must never leave a partial window behind: a sample built from
    /// three of twelve buckets would report a plausible-looking percentage measured over a quarter
    /// of the interval.
    /// </summary>
    [Fact]
    public async Task ACancelledCycleNeverPersistsAPartialWindow()
    {
        var livePolicy = new LivePolicy();
        var store = new ActivityBufferSpy();
        using var cts = new CancellationTokenSource();
        var bucket = 0;

        var sampler = new ActivitySampler(
            OpenGate(livePolicy),
            new FakeInputCounter(),
            new FakeAppSampler(),
            livePolicy,
            store,
            () => true,
            TimeSpan.FromSeconds(60),
            subBuckets: 12,
            sleep: (_, ct) =>
            {
                if (bucket++ == 3)
                {
                    cts.Cancel();
                }

                ct.ThrowIfCancellationRequested();
                return Task.CompletedTask;
            });

        Assert.False(await sampler.CaptureTickAsync(cts.Token));
        Assert.Empty(store.Samples);
    }

    /// <summary>
    /// The rescheduling asymmetry, observed rather than asserted on an internal.
    ///
    /// A measured cycle has already spent the interval measuring, so it reschedules immediately
    /// and windows stay contiguous. With an instant sleep that means many samples in a short
    /// wall-clock window. If it instead waited the full interval after measuring, only the very
    /// first cycle would have run — activity would be sampled half as often as configured and
    /// every rollup would quietly under-report.
    /// </summary>
    [Fact]
    public async Task MeasuredCyclesRescheduleContiguouslyRatherThanWaitingTheInterval()
    {
        var livePolicy = new LivePolicy();
        var store = new ActivityBufferSpy();
        using var sampler = Build(
            OpenGate(livePolicy),
            livePolicy,
            store,
            new FakeInputCounter(),
            interval: TimeSpan.FromSeconds(30));

        sampler.Start();
        await Task.Delay(250);
        sampler.Stop();
        await sampler.FinishInFlightAsync();

        // A 30s interval means a non-contiguous scheduler produces exactly one sample in 250ms.
        Assert.True(
            store.Samples.Count > 3,
            $"expected contiguous rescheduling to produce many samples, got {store.Samples.Count}");
    }

    /// <summary>
    /// A skipped cycle must wait the full interval, so a closed gate cannot spin the policy
    /// endpoint. Without this the client would hammer the API as fast as the network allows for as
    /// long as acknowledgement is outstanding.
    /// </summary>
    [Fact]
    public async Task ASkippedCycleWaitsTheFullIntervalRatherThanSpinning()
    {
        var livePolicy = new LivePolicy();
        var provider = new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: true));
        var gate = new AckGate(provider);
        var store = new ActivityBufferSpy();
        using var sampler = Build(
            gate,
            livePolicy,
            store,
            new FakeInputCounter(),
            interval: TimeSpan.FromSeconds(30));

        sampler.Start();
        await Task.Delay(250);
        sampler.Stop();
        await sampler.FinishInFlightAsync();

        Assert.Empty(store.Samples);
        Assert.True(provider.Calls <= 2, $"a closed gate must not busy-loop policy fetches, saw {provider.Calls}");
    }
}
