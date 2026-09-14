using NiftyTimer.Activity;
using NiftyTimer.App;
using NiftyTimer.Notifications;
using NiftyTimer.Policy;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>Ported case for case from the macOS client's <c>DistractionMonitorTests</c>.</summary>
public class DistractionMonitorTests
{
    private static DistractionMonitor Monitor(NotifierSpy spy, int threshold, int repeat = 0, bool enabled = true)
    {
        var settings = new DistractionSettings(enabled, threshold, repeat);
        return new DistractionMonitor(spy, () => settings);
    }

    private static void Run(DistractionMonitor monitor, Category category, int count)
    {
        for (var i = 0; i < count; i++)
        {
            monitor.Tick(category);
        }
    }

    [Fact]
    public void FiresExactlyOnceAtTheThreshold()
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10);

        Run(monitor, Category.Unproductive, 9);
        Assert.Empty(spy.Sent);

        monitor.Tick(Category.Unproductive);
        Assert.Equal(DistractionMonitor.NotificationId, Assert.Single(spy.Sent).Id);
    }

    [Theory]
    [InlineData(Category.Productive)]
    [InlineData(Category.Neutral)]
    public void AnyOtherSampleBreaksTheStreak(Category breaker)
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10);

        Run(monitor, Category.Unproductive, 9);
        monitor.Tick(breaker);
        Run(monitor, Category.Unproductive, 9);

        Assert.Empty(spy.Sent); // never ten in a row
    }

    [Fact]
    public void FiresOncePerStreakWithoutRepeats()
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10);

        Run(monitor, Category.Unproductive, 15);

        Assert.Single(spy.Sent);
    }

    [Fact]
    public void ReArmsAfterTheStreakBreaks()
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10);

        Run(monitor, Category.Unproductive, 10);
        monitor.Tick(Category.Productive);
        Run(monitor, Category.Unproductive, 10);

        Assert.Equal(2, spy.Sent.Count);
    }

    /// <summary>Threshold 10, repeat 5, twenty unbroken samples → nudges at 10, 15 and 20.</summary>
    [Fact]
    public void RepeatsWhileTheStreakContinues()
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10, repeat: 5);

        Run(monitor, Category.Unproductive, 20);

        Assert.Equal(3, spy.Sent.Count);
    }

    [Fact]
    public void TheRepeatCadenceRestartsAfterABreak()
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10, repeat: 5);

        Run(monitor, Category.Unproductive, 15); // 10, 15
        monitor.Tick(Category.Neutral);
        Run(monitor, Category.Unproductive, 10); // 10 again, not 5 after the last

        Assert.Equal(3, spy.Sent.Count);
    }

    [Fact]
    public void RepeatZeroKeepsOneNudgePerStreak()
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10, repeat: 0);

        Run(monitor, Category.Unproductive, 40);

        Assert.Single(spy.Sent);
    }

    /// <summary>The team's master switch is off — no nudge, ever.</summary>
    [Fact]
    public void NeverFiresWhileAlertsAreDisabled()
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10, repeat: 5, enabled: false);

        Run(monitor, Category.Unproductive, 40);

        Assert.Empty(spy.Sent);
    }

    /// <summary>Re-enabling starts a fresh streak rather than resuming the old one.</summary>
    [Fact]
    public void DisablingMidStreakDropsTheStreak()
    {
        var spy = new NotifierSpy();
        var settings = new DistractionSettings(true, 10, 0);
        var monitor = new DistractionMonitor(spy, () => settings);

        Run(monitor, Category.Unproductive, 9);
        settings = new DistractionSettings(false, 10, 0);
        monitor.Tick(Category.Unproductive); // would have been the tenth
        settings = new DistractionSettings(true, 10, 0);
        Run(monitor, Category.Unproductive, 9);

        Assert.Empty(spy.Sent);
    }

    /// <summary>An admin lowering the threshold applies without a relaunch.</summary>
    [Fact]
    public void AThresholdChangeAppliesOnTheNextSample()
    {
        var spy = new NotifierSpy();
        var settings = new DistractionSettings(true, 10, 0);
        var monitor = new DistractionMonitor(spy, () => settings);

        Run(monitor, Category.Unproductive, 5);
        Assert.Empty(spy.Sent);

        settings = new DistractionSettings(true, 6, 0);
        monitor.Tick(Category.Unproductive); // the sixth sample, under the new threshold of six

        Assert.Single(spy.Sent);
    }

    [Fact]
    public void TheBodyReportsTheStreakLengthNotTheThreshold()
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10, repeat: 5);

        Run(monitor, Category.Unproductive, 15);

        Assert.Equal(2, spy.Sent.Count);
        Assert.Contains("10 min", spy.Sent[0].Body, StringComparison.Ordinal);
        Assert.Contains("15 min", spy.Sent[1].Body, StringComparison.Ordinal); // not 10 again
    }

    /// <summary>A zero threshold would nudge on every sample; a negative repeat means nothing.</summary>
    [Fact]
    public void SettingsAreClampedToSaneValues()
    {
        var spy = new NotifierSpy();
        var clamped = new DistractionSettings(true, 0, -3);

        Assert.Equal(1, clamped.ThresholdMinutes);
        Assert.Equal(0, clamped.RepeatMinutes);

        var monitor = new DistractionMonitor(spy, () => clamped);
        monitor.Tick(Category.Unproductive);

        Assert.Single(spy.Sent);
    }

    [Fact]
    public void StopResetsTheStreak()
    {
        var spy = new NotifierSpy();
        var monitor = Monitor(spy, threshold: 10);

        Run(monitor, Category.Unproductive, 9);
        monitor.Stop();
        Run(monitor, Category.Unproductive, 9);

        Assert.Empty(spy.Sent); // rebuilt from zero, still short of ten
    }

    [Fact]
    public void SettingsComeFromTheTeamPolicy()
    {
        var settings = DistractionSettings.From(new PolicySettings
        {
            DistractionAlertsEnabled = true,
            DistractionThresholdMinutes = 7,
            DistractionRepeatMinutes = 3,
        });

        Assert.Equal(new DistractionSettings(true, 7, 3), settings);
        Assert.False(DistractionSettings.Off.Enabled);
    }
}

public class DistractionNotifierPacingTests
{
    /// <summary>
    /// The monitor paces its own repeats from the team policy, down to one minute. The notifier's
    /// five-minute backstop would otherwise swallow every repeat an admin set below five.
    /// </summary>
    [Fact]
    public void TheDistractionNudgeIsNotSwallowedByTheRepeatWindow()
    {
        var now = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var shown = new List<(string, string)>();
        var notifier = new LocalNotifier((t, b) => shown.Add((t, b)), () => now);

        notifier.Notify(DistractionMonitor.NotificationId, "Time tracking", "~10 min");
        now = now.AddMinutes(1);
        notifier.Notify(DistractionMonitor.NotificationId, "Time tracking", "~11 min");

        Assert.Equal(2, shown.Count);
    }
}

public class ActivitySamplerCategoryTests
{
    private static ActivitySampler Build(Func<bool> isTracking, List<Category> seen)
    {
        var livePolicy = new LivePolicy();
        var gate = new AckGate(
            new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: false, new PolicySettings())),
            policy => livePolicy.Update(policy.Settings));

        return new ActivitySampler(
            gate,
            new FakeInputCounter(),
            new FakeAppSampler(),
            livePolicy,
            new ActivityBufferSpy(),
            isTracking,
            TimeSpan.FromSeconds(60),
            subBuckets: 12,
            sleep: (_, _) => Task.CompletedTask,
            onCategorized: seen.Add);
    }

    /// <summary>
    /// The distraction nudge is fed from here. Only the category crosses — the callback's type
    /// cannot carry an app name or a title.
    /// </summary>
    [Fact]
    public async Task EachMeasuredSampleReportsItsCategory()
    {
        var seen = new List<Category>();
        var sampler = Build(() => true, seen);

        Assert.True(await sampler.CaptureTickAsync());

        Assert.Equal(Category.Neutral, Assert.Single(seen)); // no rules configured → neutral
    }

    [Fact]
    public async Task ASkippedTickReportsNothing()
    {
        var seen = new List<Category>();
        var sampler = Build(() => false, seen);

        Assert.False(await sampler.CaptureTickAsync());

        Assert.Empty(seen);
    }
}

/// <summary>Wiring asserted on the IL, as in <see cref="LaunchResolutionWiringTests"/>.</summary>
public class DistractionWiringTests
{
    [Fact]
    public void ActivitySamplingInstallsTheMonitor() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("InstallActivitySampling"), nameof(DistractionMonitor), ".ctor"),
            "AppDelegate.InstallActivitySampling no longer creates the distraction monitor.");

    [Fact]
    public void TheSamplerFeedsTheMonitor() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("InstallActivitySampling"), nameof(AppDelegate), "OnActivityCategorized"),
            "AppDelegate.InstallActivitySampling no longer hands the category callback to the sampler.");

    /// <summary>One person's streak must never nudge the next person on the same machine.</summary>
    [Fact]
    public void SignOutClearsTheStreak() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("TearDownCaptureAsync"), nameof(DistractionMonitor), nameof(DistractionMonitor.Stop)),
            "AppDelegate.TearDownCaptureAsync no longer clears the distraction streak.");
}
