using System.Text.Json;
using NiftyTimer.App;
using NiftyTimer.Notifications;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The manual-session idle machine. Same shape as <see cref="IdleMonitor"/>, but a manual entry is
/// the user's own action, so going away must never stop it (CLAUDE.md §1).
/// </summary>
public class ManualIdleMonitorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private sealed class Recorder : IManualIdleMonitorDelegate
    {
        public List<DateTimeOffset> Begun { get; } = [];

        public List<int> AwaySeconds { get; } = [];

        public List<(DateTimeOffset From, DateTimeOffset To, bool Keeping)> Resolved { get; } = [];

        public List<(DateTimeOffset From, DateTimeOffset To)> Abandoned { get; } = [];

        public void DidBeginAway(DateTimeOffset awayStart) => Begun.Add(awayStart);

        public void DidBecomeAway(int seconds) => AwaySeconds.Add(seconds);

        public void DidResolveAway(DateTimeOffset awayStart, DateTimeOffset resume, bool keeping) =>
            Resolved.Add((awayStart, resume, keeping));

        public void DidAbandonAway(DateTimeOffset awayStart, DateTimeOffset lastKnown) =>
            Abandoned.Add((awayStart, lastKnown));
    }

    private static (ManualIdleMonitor Monitor, Recorder Delegate) New(Func<DateTimeOffset> clock)
    {
        var recorder = new Recorder();
        var monitor = new ManualIdleMonitor(300, clock) { Delegate = recorder };
        return (monitor, recorder);
    }

    /// <summary>
    /// The difference that matters: activating arms the monitor but opens nothing. The manual timer
    /// belongs to the user.
    /// </summary>
    [Fact]
    public void ActivateArmsWithoutStartingAnything()
    {
        var (monitor, recorder) = New(() => T0);

        monitor.Activate();

        Assert.Equal(IdleState.Active, monitor.State);
        Assert.Empty(recorder.Begun);
        Assert.Empty(recorder.Resolved);
    }

    [Fact]
    public void CrossingTheThresholdReportsAwayButNeverStops()
    {
        var now = T0.AddMinutes(30);
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        monitor.Tick(400);

        Assert.Equal(now.AddSeconds(-400), Assert.Single(recorder.Begun));
        Assert.Equal(new IdleState.Away(now.AddSeconds(-400)), monitor.State);
    }

    [Fact]
    public void ResolvingReArmsWithoutOpeningASpan()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();
        monitor.Tick(600);
        now = T0.AddMinutes(30);
        monitor.Tick(0);

        monitor.Resolve(AwayResolution.Discard);

        Assert.Single(recorder.Resolved);
        Assert.Equal(IdleState.Active, monitor.State);
    }

    [Fact]
    public void TearingDownWhileAwayRecordsUnresolved()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();
        monitor.MarkAway();

        now = T0.AddMinutes(20);
        monitor.Deactivate();

        Assert.Equal((T0, now), Assert.Single(recorder.Abandoned));
    }
}

/// <summary>
/// The coordinator that turns manual away windows into buffer writes. This is where the
/// mis-attribution hazards live.
/// </summary>
public class ManualIdleCoordinatorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private sealed class Harness
    {
        public DateTimeOffset Now = T0;

        public BufferSpy Buffer { get; } = new();

        public TimeTracker Tracker { get; private set; } = null!;

        public ManualIdleCoordinator Coordinator { get; private set; } = null!;

        public List<int> Prompts { get; } = [];

        public List<DateTimeOffset> Replaced { get; } = [];

        public int Dismissals { get; private set; }

        public Action<AwayResolution>? Resolve { get; private set; }

        public static Harness Build()
        {
            var h = new Harness();
            var n = 0;
            h.Tracker = new TimeTracker(h.Buffer, () => h.Now, _ => $"entry-{++n}");
            var m = 0;
            h.Coordinator = new ManualIdleCoordinator(
                h.Tracker,
                h.Buffer,
                thresholdSeconds: 300,
                presentAwayPrompt: (minutes, resolve) =>
                {
                    h.Prompts.Add(minutes);
                    h.Resolve = resolve;
                },
                clock: () => h.Now,
                idGen: _ => $"idle-{++m}",
                onEntryReplaced: start => h.Replaced.Add(start),
                dismissPrompt: () => h.Dismissals++);
            return h;
        }

        public IReadOnlyList<IdleEventPayload> IdleEvents() => Buffer.Entries
            .Where(e => e.Kind == BufferKind.IdleEvent)
            .Select(e => JsonSerializer.Deserialize<IdleEventPayload>(e.Payload)!)
            .ToList();

        public IReadOnlyList<TimeEntryPayload> TimeEntries() => Buffer.Entries
            .Where(e => e.Kind == BufferKind.TimeEntry)
            .Select(e => JsonSerializer.Deserialize<TimeEntryPayload>(e.Payload)!)
            .ToList();
    }

    /// <summary>
    /// With no manual span running there is nothing to be idle against — the auto layer handles
    /// that case, and this one must stay silent rather than prompting about a clock that is stopped.
    /// </summary>
    [Fact]
    public void SignalsAreIgnoredWhenNothingIsTracking()
    {
        var h = Harness.Build();

        h.Coordinator.Tick(9999);
        h.Coordinator.MarkAway();

        Assert.Empty(h.Prompts);
        Assert.Empty(h.Buffer.Entries);
        Assert.Equal(IdleState.Inactive, h.Coordinator.MonitorState);
    }

    /// <summary>An AUTO span belongs to the other coordinator; this one must not touch it.</summary>
    [Fact]
    public void SignalsAreIgnoredDuringAnAutoSpan()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null, source: TimeTracker.EntrySource.Auto);

        h.Coordinator.Tick(9999);

        Assert.Empty(h.Prompts);
        Assert.Equal(IdleState.Inactive, h.Coordinator.MonitorState);
    }

    [Fact]
    public void KeepLeavesTheRunningEntryAloneAndRecordsKept()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        var entryId = ((TrackerState.Tracking)h.Tracker.State).EntryId;

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600); // away since 09:20
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0);   // back
        h.Resolve!(AwayResolution.Keep);

        // The manual entry ran straight through; nothing was closed or reopened.
        Assert.Equal(entryId, ((TrackerState.Tracking)h.Tracker.State).EntryId);
        Assert.Empty(h.TimeEntries());

        var idle = Assert.Single(h.IdleEvents());
        Assert.Equal("KEPT", idle.ResolvedAction);
        Assert.Equal("2026-08-25T09:20:00Z", idle.StartTime);
        Assert.Equal("2026-08-25T09:40:00Z", idle.EndTime);
        Assert.Empty(h.Replaced);
    }

    [Fact]
    public void DiscardTrimsTheEntryAtTheAwayStartAndOpensAFreshOne()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", "t1");
        var original = ((TrackerState.Tracking)h.Tracker.State).EntryId;

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600); // away since 09:20
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0);
        h.Resolve!(AwayResolution.Discard);

        var closed = Assert.Single(h.TimeEntries());
        Assert.Equal(original, closed.Id);
        Assert.Equal("2026-08-25T09:00:00Z", closed.StartTime);
        Assert.Equal("2026-08-25T09:20:00Z", closed.EndTime); // trimmed to the away start

        var fresh = Assert.IsType<TrackerState.Tracking>(h.Tracker.State);
        Assert.NotEqual(original, fresh.EntryId);
        Assert.Equal("p1", fresh.Selection.ProjectId);
        Assert.Equal("t1", fresh.Selection.TaskId);

        Assert.Equal("DISCARDED", Assert.Single(h.IdleEvents()).ResolvedAction);
    }

    /// <summary>
    /// The clock must keep reading WORKED time. Twenty minutes were worked before stepping away, so
    /// after the swap the display counts from twenty minutes before the fresh entry's start —
    /// otherwise answering the prompt visibly throws the morning away.
    /// </summary>
    [Fact]
    public void DiscardKeepsTheDisplayClockOnWorkedTime()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600);
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0);
        h.Resolve!(AwayResolution.Discard);

        var displayStart = Assert.Single(h.Replaced);
        Assert.Equal(TimeSpan.FromMinutes(20), h.Now - displayStart);
    }

    /// <summary>
    /// The prompt is not modal. If the person hits Stop while it is on screen, the entry the away
    /// window belonged to is gone — trimming whatever is running now would cut into unrelated work.
    /// </summary>
    [Fact]
    public void DiscardAfterTheEntryEndedRecordsUnresolvedAndTrimsNothing()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600);
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0);

        h.Tracker.Stop();                 // the user stopped while the prompt was up
        h.Tracker.Start("p2", null);      // ...and started something else
        var unrelated = ((TrackerState.Tracking)h.Tracker.State).EntryId;

        h.Resolve!(AwayResolution.Discard);

        Assert.Equal("UNRESOLVED", Assert.Single(h.IdleEvents()).ResolvedAction);
        Assert.Equal(unrelated, ((TrackerState.Tracking)h.Tracker.State).EntryId);
        Assert.Empty(h.Replaced);
    }

    /// <summary>
    /// The same hazard caught earlier: the next signal notices the away entry is gone, records the
    /// window UNRESOLVED, and takes the stale prompt off screen rather than leaving it to be
    /// answered blind.
    /// </summary>
    [Fact]
    public void ANewSignalReconcilesAStaleAwayWindowAndDismissesThePrompt()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600);
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0);
        Assert.Single(h.Prompts);

        h.Tracker.Stop();
        h.Tracker.Start("p2", null);
        h.Coordinator.Tick(0);

        Assert.Equal("UNRESOLVED", Assert.Single(h.IdleEvents()).ResolvedAction);
        Assert.Equal(1, h.Dismissals);
    }

    [Fact]
    public void DeactivateRecordsAPendingWindowAsUnresolved()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600);

        h.Now = T0.AddMinutes(35);
        h.Coordinator.Deactivate();

        var idle = Assert.Single(h.IdleEvents());
        Assert.Equal("UNRESOLVED", idle.ResolvedAction);
        Assert.Equal("2026-08-25T09:20:00Z", idle.StartTime);
        Assert.Equal("2026-08-25T09:35:00Z", idle.EndTime);
    }
}

/// <summary>
/// The manual-mode nudge decider. Notify-only — it holds no tracker reference, so it cannot stop a
/// clock even by accident.
/// </summary>
public class ManualNudgeMonitorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private sealed class SpyNotifier : ILocalNotifier
    {
        public List<(string Id, string Body)> Sent { get; } = [];

        public void Notify(string id, string title, string body) => Sent.Add((id, body));
    }

    private static (ManualNudgeMonitor Monitor, SpyNotifier Notifier) New(
        Func<bool> isTracking,
        Func<bool>? isPaused = null)
    {
        var notifier = new SpyNotifier();
        var monitor = new ManualNudgeMonitor(
            notifier,
            idleThresholdSeconds: 300,
            forgotToStartSeconds: 600,
            isTracking,
            isPaused ?? (() => false));
        return (monitor, notifier);
    }

    [Fact]
    public void NudgesToStartAfterALongActiveStretchWithNoClockRunning()
    {
        var (monitor, notifier) = New(() => false);

        monitor.Tick(0, T0);
        monitor.Tick(0, T0.AddMinutes(5));
        Assert.Empty(notifier.Sent);

        monitor.Tick(0, T0.AddMinutes(10));

        Assert.Equal("forgot-to-start", Assert.Single(notifier.Sent).Id);
    }

    [Fact]
    public void TheForgotToStartNudgeFiresOnlyOncePerStretch()
    {
        var (monitor, notifier) = New(() => false);

        monitor.Tick(0, T0);
        monitor.Tick(0, T0.AddMinutes(10));
        monitor.Tick(0, T0.AddMinutes(15));
        monitor.Tick(0, T0.AddMinutes(20));

        Assert.Single(notifier.Sent);
    }

    /// <summary>Going away breaks the stretch — coming back starts the ten minutes over.</summary>
    [Fact]
    public void GoingIdleResetsTheForgotToStartStretch()
    {
        var (monitor, notifier) = New(() => false);

        monitor.Tick(0, T0);
        monitor.Tick(400, T0.AddMinutes(5)); // away
        monitor.Tick(0, T0.AddMinutes(6));   // back — the clock restarts here
        monitor.Tick(0, T0.AddMinutes(12));  // only 6 min of presence

        Assert.Empty(notifier.Sent);

        monitor.Tick(0, T0.AddMinutes(16));
        Assert.Equal("forgot-to-start", Assert.Single(notifier.Sent).Id);
    }

    [Fact]
    public void NudgesAboutIdleWhileAManualClockIsRunning()
    {
        var (monitor, notifier) = New(() => true);

        monitor.Tick(600, T0);

        var sent = Assert.Single(notifier.Sent);
        Assert.Equal("manual-idle", sent.Id);
        Assert.Contains("10 min", sent.Body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheIdleNudgeReArmsOnlyAfterActivityResumes()
    {
        var (monitor, notifier) = New(() => true);

        monitor.Tick(600, T0);
        monitor.Tick(900, T0.AddMinutes(5));
        Assert.Single(notifier.Sent);

        monitor.Tick(0, T0.AddMinutes(10));   // back at the keyboard
        monitor.Tick(600, T0.AddMinutes(20)); // idle again

        Assert.Equal(2, notifier.Sent.Count);
    }

    /// <summary>A paused session is a deliberate break. Nudging through it is nagging.</summary>
    [Fact]
    public void SaysNothingWhilePaused()
    {
        var (monitor, notifier) = New(() => false, () => true);

        monitor.Tick(0, T0);
        monitor.Tick(0, T0.AddMinutes(30));
        monitor.Tick(900, T0.AddMinutes(40));

        Assert.Empty(notifier.Sent);
    }

    [Fact]
    public void NeverSaysZeroMinutes()
    {
        var (monitor, notifier) = New(() => true);

        monitor.Tick(300, T0); // exactly 5 min

        Assert.Contains("5 min", Assert.Single(notifier.Sent).Body, StringComparison.Ordinal);
    }
}
