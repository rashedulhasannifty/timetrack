using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The automatic-tracking decision machine (PRD §6.1/§6.4). Pure: no UI, no network, no hardware.
/// </summary>
public class IdleMonitorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private sealed class Recorder : IIdleMonitorDelegate
    {
        public List<string> Calls { get; } = [];

        public List<(DateTimeOffset From, DateTimeOffset To, bool Keeping)> Resolved { get; } = [];

        public List<(DateTimeOffset From, DateTimeOffset To)> Abandoned { get; } = [];

        public List<DateTimeOffset> Stops { get; } = [];

        public List<int> AwaySeconds { get; } = [];

        public List<int> ThresholdCrossings { get; } = [];

        public void ShouldStartTracking() => Calls.Add("start");

        public void ShouldStopTracking(DateTimeOffset awayStart)
        {
            Calls.Add("stop");
            Stops.Add(awayStart);
        }

        public void DidBecomeAway(int seconds)
        {
            Calls.Add("away");
            AwaySeconds.Add(seconds);
        }

        public void DidResolveAway(DateTimeOffset awayStart, DateTimeOffset resume, bool keeping)
        {
            Calls.Add("resolve");
            Resolved.Add((awayStart, resume, keeping));
        }

        public void DidAbandonAway(DateTimeOffset awayStart, DateTimeOffset lastKnown)
        {
            Calls.Add("abandon");
            Abandoned.Add((awayStart, lastKnown));
        }

        public void DidCrossIdleThreshold(int seconds)
        {
            Calls.Add("threshold");
            ThresholdCrossings.Add(seconds);
        }
    }

    private static (IdleMonitor Monitor, Recorder Delegate) New(Func<DateTimeOffset> clock, int threshold = 300)
    {
        var recorder = new Recorder();
        var monitor = new IdleMonitor(threshold, clock) { Delegate = recorder };
        return (monitor, recorder);
    }

    [Fact]
    public void StartsInactiveAndSaysNothing()
    {
        var (monitor, recorder) = New(() => T0);

        Assert.Equal(IdleState.Inactive, monitor.State);
        Assert.Empty(recorder.Calls);
    }

    [Fact]
    public void ActivateOpensASpan()
    {
        var (monitor, recorder) = New(() => T0);

        monitor.Activate();

        Assert.Equal(IdleState.Active, monitor.State);
        Assert.Equal(["start"], recorder.Calls);
    }

    [Fact]
    public void TicksBelowTheThresholdChangeNothing()
    {
        var (monitor, recorder) = New(() => T0);
        monitor.Activate();
        recorder.Calls.Clear();

        monitor.Tick(0);
        monitor.Tick(299);

        Assert.Equal(IdleState.Active, monitor.State);
        Assert.Empty(recorder.Calls);
    }

    /// <summary>
    /// The away window starts when input actually stopped, not when we noticed. The poller runs
    /// every 15s, so "now" is always late — backdating by the reported idle seconds is what keeps
    /// the excluded window equal to the real one.
    /// </summary>
    [Fact]
    public void CrossingTheThresholdStopsAtTheBackdatedAwayStart()
    {
        var now = T0.AddMinutes(30);
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        monitor.Tick(310);

        Assert.Equal(new IdleState.Away(now.AddSeconds(-310)), monitor.State);
        Assert.Equal(now.AddSeconds(-310), Assert.Single(recorder.Stops));
        Assert.Equal(310, Assert.Single(recorder.ThresholdCrossings));
    }

    [Fact]
    public void StaysAwayWhileIdleRemainsAboveTheThreshold()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();
        monitor.Tick(300);
        var away = monitor.State;
        recorder.Calls.Clear();

        now = T0.AddMinutes(10);
        monitor.Tick(900);

        Assert.Equal(away, monitor.State); // the away START does not drift
        Assert.Empty(recorder.Calls);
    }

    [Fact]
    public void ReturningBelowTheThresholdAsksTheUser()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();
        monitor.Tick(600);
        var awayStart = now.AddSeconds(-600);

        now = T0.AddMinutes(20);
        monitor.Tick(3);

        Assert.Equal(new IdleState.Awaiting(awayStart, now), monitor.State);
        Assert.Equal((int)(now - awayStart).TotalSeconds, Assert.Single(recorder.AwaySeconds));
    }

    /// <summary>
    /// Sleep and lock are known moments, so they mark away immediately rather than waiting for the
    /// threshold — a closed lid is not five minutes of maybe.
    /// </summary>
    [Fact]
    public void MarkAwayStopsImmediatelyAtNow()
    {
        var now = T0.AddHours(1);
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        monitor.MarkAway();

        Assert.Equal(new IdleState.Away(now), monitor.State);
        Assert.Equal(now, Assert.Single(recorder.Stops));
        Assert.Empty(recorder.ThresholdCrossings); // not an inactivity crossing — no idle nudge
    }

    [Fact]
    public void MarkAwayIsIgnoredUnlessActive()
    {
        var (monitor, recorder) = New(() => T0);

        monitor.MarkAway();

        Assert.Equal(IdleState.Inactive, monitor.State);
        Assert.Empty(recorder.Calls);
    }

    [Fact]
    public void KeepBridgesTheWindowAndReopens()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();
        monitor.Tick(600);
        var awayStart = now.AddSeconds(-600);
        now = T0.AddMinutes(30);
        monitor.Tick(0);
        recorder.Calls.Clear();

        monitor.Resolve(AwayResolution.Keep);

        Assert.Equal((awayStart, now, true), Assert.Single(recorder.Resolved));
        Assert.Equal(IdleState.Active, monitor.State);
        Assert.Equal(["resolve", "start"], recorder.Calls);
    }

    [Fact]
    public void DiscardResolvesWithoutKeepingAndStillReopens()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();
        monitor.Tick(600);
        now = T0.AddMinutes(30);
        monitor.Tick(0);

        monitor.Resolve(AwayResolution.Discard);

        Assert.False(Assert.Single(recorder.Resolved).Keeping);
        Assert.Equal(IdleState.Active, monitor.State);
    }

    /// <summary>
    /// The prompt is not modal and the app can be signed out from under it. A second answer must
    /// not produce a second bridge span.
    /// </summary>
    [Fact]
    public void ResolvingTwiceOnlyCountsOnce()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();
        monitor.Tick(600);
        now = T0.AddMinutes(30);
        monitor.Tick(0);

        monitor.Resolve(AwayResolution.Keep);
        monitor.Resolve(AwayResolution.Keep);

        Assert.Single(recorder.Resolved);
    }

    [Fact]
    public void TearingDownWhileAwayRecordsUnresolved()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();
        monitor.Tick(600);
        var awayStart = now.AddSeconds(-600);

        now = T0.AddMinutes(45);
        monitor.Deactivate();

        Assert.Equal((awayStart, now), Assert.Single(recorder.Abandoned));
        Assert.Equal(IdleState.Inactive, monitor.State);
    }

    /// <summary>
    /// Torn down after the person came back but before they answered: the window ends when they
    /// RETURNED, not when the app quit. Using "now" would silently extend the unresolved window
    /// over time the person was demonstrably at the machine.
    /// </summary>
    [Fact]
    public void TearingDownWhileAwaitingUsesTheResumeInstant()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();
        monitor.Tick(600);
        var awayStart = now.AddSeconds(-600);
        now = T0.AddMinutes(30);
        monitor.Tick(0);
        var resumedAt = now;

        now = T0.AddHours(2);
        monitor.Deactivate();

        Assert.Equal((awayStart, resumedAt), Assert.Single(recorder.Abandoned));
    }

    [Fact]
    public void TearingDownWhileMerelyActiveRecordsNothing()
    {
        var (monitor, recorder) = New(() => T0);
        monitor.Activate();
        recorder.Calls.Clear();

        monitor.Deactivate();

        Assert.Empty(recorder.Calls);
        Assert.Equal(IdleState.Inactive, monitor.State);
    }

    [Fact]
    public void ResumeIsANoOpUnlessAway()
    {
        var (monitor, recorder) = New(() => T0);
        monitor.Activate();
        recorder.Calls.Clear();

        monitor.Resume();

        Assert.Equal(IdleState.Active, monitor.State);
        Assert.Empty(recorder.Calls);
    }
}
