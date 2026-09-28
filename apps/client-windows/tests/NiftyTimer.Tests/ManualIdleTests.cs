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
/// the user's own action, so going away must never stop it (CLAUDE.md §1) — with one exception:
/// <see cref="ManualIdleMonitor.AwayLimit"/>. Nobody comes back from a PC left awake over a
/// weekend, so an away window that nobody ever answers is bounded by policy rather than left open
/// forever.
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

        public List<(DateTimeOffset AwayStart, DateTimeOffset DetectedAt)> LimitExceeded { get; } = [];

        public int Withdrawn { get; private set; }

        public void DidBeginAway(DateTimeOffset awayStart) => Begun.Add(awayStart);

        public void DidBecomeAway(int seconds) => AwaySeconds.Add(seconds);

        public void DidResolveAway(DateTimeOffset awayStart, DateTimeOffset resume, bool keeping) =>
            Resolved.Add((awayStart, resume, keeping));

        public void DidAbandonAway(DateTimeOffset awayStart, DateTimeOffset lastKnown) =>
            Abandoned.Add((awayStart, lastKnown));

        public void DidExceedAwayLimit(DateTimeOffset awayStart, DateTimeOffset detectedAt) =>
            LimitExceeded.Add((awayStart, detectedAt));

        public void DidWithdrawPrompt() => Withdrawn++;
    }

    private static (ManualIdleMonitor Monitor, Recorder Delegate) New(
        Func<DateTimeOffset> clock,
        TimeSpan? awayLimit = null)
    {
        var recorder = new Recorder();
        var monitor = new ManualIdleMonitor(300, clock, awayLimit) { Delegate = recorder };
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
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate(); // armed at T0

        now = T0.AddMinutes(30);
        monitor.Tick(400);

        var expectedAwayStart = now.AddSeconds(-400);
        Assert.Equal(expectedAwayStart, Assert.Single(recorder.Begun));
        Assert.Equal(new IdleState.Away(expectedAwayStart), monitor.State);
    }

    [Fact]
    public void ResolvingReArmsWithoutOpeningASpan()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate(); // armed at T0

        now = T0.AddMinutes(10);
        monitor.Tick(600); // idle 600s as of T0+10min -> away since T0

        now = T0.AddMinutes(30);
        monitor.Tick(0); // back -> awaiting

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

    /// <summary>
    /// The OS idle counter does not reset when someone presses Stop and starts something else.
    /// Without clamping to the arming instant, that inherited reading would flag a session away
    /// for idle time that happened before it was even armed.
    /// </summary>
    [Fact]
    public void IdlenessInheritedFromBeforeTheSessionDoesNotCount()
    {
        var now = T0.AddSeconds(900); // 15 min "idle" already elapsed before this session
        var (monitor, recorder) = New(() => now);
        monitor.Activate(); // armed at T0+900s

        monitor.Tick(900); // a reading claiming 900s idle, right at arming

        Assert.Empty(recorder.Begun); // clamped to the arming instant: 0s idle so far, not 900s
        Assert.Equal(IdleState.Active, monitor.State);

        now = now.AddSeconds(300); // 300s pass with continued inactivity
        monitor.Tick(1200); // the OS still reports one long-idle reading

        Assert.Equal(T0.AddSeconds(900), Assert.Single(recorder.Begun));
    }

    /// <summary>
    /// The headline addition: an away window that nobody ever answers does not stay open forever.
    /// </summary>
    [Fact]
    public void AwayPastTheLimitTimesOutWithoutInputReturning()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now, TimeSpan.FromMinutes(60));
        monitor.Activate();
        monitor.MarkAway(); // away since T0

        now = T0.AddMinutes(61);
        monitor.Tick(600); // still idle, no return — but well past the limit

        Assert.Equal(IdleState.Inactive, monitor.State);
        Assert.Equal((T0, now), Assert.Single(recorder.LimitExceeded));
        Assert.Empty(recorder.AwaySeconds); // the limit fires instead of the prompt
    }

    /// <summary>Returning inside the limit still asks — the ordinary keep/discard path.</summary>
    [Fact]
    public void ReturningWithinTheLimitStillPrompts()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now, TimeSpan.FromMinutes(60));
        monitor.Activate();
        monitor.MarkAway(); // away since T0

        now = T0.AddMinutes(59);
        monitor.Tick(0); // back, 59 minutes later — inside the limit

        Assert.Equal(59 * 60, Assert.Single(recorder.AwaySeconds));
        Assert.Empty(recorder.LimitExceeded);
        Assert.Equal(new IdleState.Awaiting(T0, now), monitor.State);
    }

    /// <summary>
    /// The boundary that matters: input DID resume, but too late. The limit wins over the prompt.
    /// </summary>
    [Fact]
    public void ReturningPastTheLimitTimesOutInsteadOfPrompting()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now, TimeSpan.FromMinutes(60));
        monitor.Activate();
        monitor.MarkAway();

        now = T0.AddMinutes(61);
        monitor.Tick(0); // input has resumed, but 61 minutes after the away start

        Assert.Equal(IdleState.Inactive, monitor.State);
        Assert.Equal((T0, now), Assert.Single(recorder.LimitExceeded));
        Assert.Empty(recorder.AwaySeconds);
    }

    /// <summary>
    /// Sleep can outlast the limit on its own — the poller is paused for the whole stretch, so no
    /// tick ever fires. Wake is where a sleep that long is caught.
    /// </summary>
    [Fact]
    public void SleepPastTheLimitTimesOutOnWakeRatherThanPrompting()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now, TimeSpan.FromMinutes(60));
        monitor.Activate();
        monitor.MarkAway(); // lock/sleep marks away immediately

        // No ticks arrive during sleep.
        now = T0.AddHours(3);
        monitor.Resume(); // the wake signal, not a tick

        Assert.Equal(IdleState.Inactive, monitor.State);
        Assert.Equal((T0, now), Assert.Single(recorder.LimitExceeded));
        Assert.Empty(recorder.AwaySeconds);
    }

    /// <summary>The mirror case: waking within the limit still asks, via the same Resume path.</summary>
    [Fact]
    public void WakingWithinTheLimitPromptsViaResume()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now, TimeSpan.FromMinutes(60));
        monitor.Activate();
        monitor.MarkAway();

        now = T0.AddMinutes(45);
        monitor.Resume();

        Assert.Equal(45 * 60, Assert.Single(recorder.AwaySeconds));
        Assert.Empty(recorder.LimitExceeded);
    }

    /// <summary>
    /// Someone comes back, ignores the prompt, and leaves for the night. The open prompt must not
    /// switch idle detection off: going idle again resolves it as Discard (its default) and the
    /// second absence starts its own away window from the moment input stopped.
    /// </summary>
    [Fact]
    public void GoingIdleAgainWhileThePromptIsOpenDiscardsItAndBeginsASecondAway()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddMinutes(5);
        monitor.Tick(300); // away since T0

        now = T0.AddMinutes(7);
        monitor.Tick(5); // back -> prompt

        now = T0.AddMinutes(13);
        monitor.Tick(330); // left again at 09:07:30

        var secondStart = T0.AddMinutes(7).AddSeconds(30);
        Assert.Equal(1, recorder.Withdrawn);
        Assert.Equal((T0, T0.AddMinutes(7), false), Assert.Single(recorder.Resolved));
        Assert.Equal(secondStart, recorder.Begun[^1]);
        Assert.Equal(new IdleState.Away(secondStart), monitor.State);

        // The prompt's own answer, arriving after it was withdrawn, changes nothing.
        monitor.Resolve(AwayResolution.Keep);
        Assert.Single(recorder.Resolved);
    }

    [Fact]
    public void TheSecondAbsenceIsBoundedByTheLimitLikeAnyOther()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddMinutes(5);
        monitor.Tick(300);
        now = T0.AddMinutes(7);
        monitor.Tick(5); // prompt
        now = T0.AddMinutes(13);
        monitor.Tick(330); // second away since 09:07:30

        now = T0.AddMinutes(68); // overnight
        monitor.Tick(3630);

        Assert.Equal(T0.AddMinutes(7).AddSeconds(30), Assert.Single(recorder.LimitExceeded).AwayStart);
        Assert.Equal(IdleState.Inactive, monitor.State);
    }

    [Fact]
    public void LockingWhileThePromptIsOpenDiscardsItAndBeginsAwayNow()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddMinutes(5);
        monitor.Tick(300);
        now = T0.AddMinutes(7);
        monitor.Tick(5); // prompt

        now = T0.AddMinutes(8);
        monitor.MarkAway(); // lock

        Assert.Equal(1, recorder.Withdrawn);
        Assert.Equal((T0, T0.AddMinutes(7), false), Assert.Single(recorder.Resolved));
        Assert.Equal(new IdleState.Away(T0.AddMinutes(8)), monitor.State);
    }

    /// <summary>The second absence never reaches back before the return that opened the prompt.</summary>
    [Fact]
    public void TheSecondAwayStartIsClampedToTheReturn()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddMinutes(5);
        monitor.Tick(300);
        now = T0.AddMinutes(7);
        monitor.Tick(5); // back at 09:07
        now = T0.AddMinutes(12);
        monitor.Tick(900); // a reading older than the return

        Assert.Equal(T0.AddMinutes(7), recorder.Begun[^1]);
    }

    [Fact]
    public void AnOpenPromptIsLeftAloneWhileThePersonIsActive()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddMinutes(5);
        monitor.Tick(300);
        now = T0.AddMinutes(7);
        monitor.Tick(5); // prompt
        now = T0.AddMinutes(17);
        monitor.Tick(30); // working, not answering

        Assert.Equal(0, recorder.Withdrawn);
        Assert.Empty(recorder.Resolved);
        Assert.Equal(new IdleState.Awaiting(T0, T0.AddMinutes(7)), monitor.State);
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

        public List<DateTimeOffset> LimitNotices { get; } = [];

        public int Dismissals { get; private set; }

        public int Stops { get; private set; }

        public Action<AwayResolution>? Resolve { get; private set; }

        /// <summary>
        /// The same callback the coordinator was given, exposed so a test can play the AppDelegate
        /// side of sign-out: it dismisses the prompt window in a SEPARATE call after Deactivate,
        /// never as a side effect of Deactivate itself.
        /// </summary>
        public Action DismissPrompt { get; private set; } = () => { };

        public static Harness Build(TimeSpan? awayLimit = null)
        {
            var h = new Harness();
            var n = 0;
            h.Tracker = new TimeTracker(h.Buffer, () => h.Now, _ => $"entry-{++n}");
            var m = 0;
            h.DismissPrompt = () => h.Dismissals++;
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
                dismissPrompt: h.DismissPrompt,
                onTrackingStopped: () => h.Stops++,
                onAwayLimitExceeded: awayStart => h.LimitNotices.Add(awayStart),
                awayLimit: awayLimit);
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
        h.Coordinator.Tick(0); // arm at 09:00

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600); // away since 09:20
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0); // back
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
        h.Coordinator.Tick(0); // arm at 09:00

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
        Assert.Equal("t1", fresh.Selection.TaskId); // same project/task carried over

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
        h.Coordinator.Tick(0);

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
        h.Coordinator.Tick(0);

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600);
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0);

        h.Tracker.Stop(); // the user stopped while the prompt was up
        h.Tracker.Start("p2", null); // ...and started something else
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
        h.Coordinator.Tick(0);

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
        h.Coordinator.Tick(0);

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600);

        h.Now = T0.AddMinutes(35);
        h.Coordinator.Deactivate();

        var idle = Assert.Single(h.IdleEvents());
        Assert.Equal("UNRESOLVED", idle.ResolvedAction);
        Assert.Equal("2026-08-25T09:20:00Z", idle.StartTime);
        Assert.Equal("2026-08-25T09:35:00Z", idle.EndTime);
    }

    /// <summary>
    /// Sign-out while a prompt is on screen: Deactivate settles the window as UNRESOLVED first,
    /// then AppDelegate dismisses the prompt window as a separate call — the same order
    /// <c>AppDelegate.TearDownIdleDetection</c> uses. A resolve landing after either step must be a
    /// no-op, or the next user to sign in would inherit the previous user's Keep or Discard.
    /// </summary>
    [Fact]
    public void SignOutWhileAwaitingDismissesThePromptAndRecordsUnresolved()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0); // arm at 09:00

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600); // away since 09:20
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0); // back — the prompt is up
        var resolve = h.Resolve!;
        Assert.Single(h.Prompts);

        h.Coordinator.Deactivate();
        h.DismissPrompt();

        var idle = Assert.Single(h.IdleEvents());
        Assert.Equal("UNRESOLVED", idle.ResolvedAction);
        Assert.Equal(1, h.Dismissals);

        // The mis-attribution bug itself: a stale resolve landing after sign-out must do nothing.
        resolve(AwayResolution.Keep);
        resolve(AwayResolution.Discard);

        Assert.Single(h.IdleEvents()); // still just the one UNRESOLVED row
        Assert.Empty(h.TimeEntries());
    }

    /// <summary>
    /// The headline addition. Nobody ever answered, and the machine stayed awake and idle the
    /// whole time: the entry stops itself at the away start, none of the away time counts, and the
    /// person is told rather than asked.
    /// </summary>
    [Fact]
    public void LimitPastWithoutReturnStopsTheEntryAtAwayStartAndNotifies()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", "t1");
        var original = ((TrackerState.Tracking)h.Tracker.State).EntryId;
        h.Coordinator.Tick(0); // arm at 09:00

        h.Now = T0.AddMinutes(6);
        h.Coordinator.Tick(300); // away since 09:01

        h.Now = T0.AddMinutes(70); // past the 60-minute limit, still idle
        h.Coordinator.Tick(600);

        Assert.Equal(TrackerState.Idle, h.Tracker.State); // stopped outright, nothing reopened
        Assert.Empty(h.Prompts); // never asked

        var closed = Assert.Single(h.TimeEntries());
        Assert.Equal(original, closed.Id);
        Assert.Equal("2026-08-25T09:01:00Z", closed.EndTime); // stopped AT the away start

        var idle = Assert.Single(h.IdleEvents());
        Assert.Equal("DISCARDED", idle.ResolvedAction);
        Assert.Equal("2026-08-25T09:01:00Z", idle.StartTime);

        Assert.Equal(1, h.Stops);
        Assert.Equal(T0.AddMinutes(1), Assert.Single(h.LimitNotices));
    }

    /// <summary>The boundary case: input DID come back, but 61 minutes after the away start.</summary>
    [Fact]
    public void ReturningPastTheLimitStopsTheEntryInsteadOfPrompting()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0);

        h.Now = T0.AddMinutes(6);
        h.Coordinator.Tick(300); // away since 09:01

        h.Now = T0.AddMinutes(62); // 61 minutes after the away start
        h.Coordinator.Tick(0);

        Assert.Equal(TrackerState.Idle, h.Tracker.State);
        Assert.Empty(h.Prompts);
        Assert.Equal("DISCARDED", Assert.Single(h.IdleEvents()).ResolvedAction);
    }

    /// <summary>
    /// Sleep can blow through the limit on its own — no tick ever fires while asleep — so the
    /// coordinator has to catch it on the wake signal, not only on a poll tick.
    /// </summary>
    [Fact]
    public void LimitExceededDuringSleepIsCaughtOnWake()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0); // arm at 09:00

        h.Now = T0.AddMinutes(1);
        h.Coordinator.MarkAway(); // lock/sleep — away since 09:01

        // No ticks arrive while asleep.
        h.Now = T0.AddHours(4);
        h.Coordinator.Resume(); // the wake signal

        Assert.Equal(TrackerState.Idle, h.Tracker.State);
        Assert.Empty(h.Prompts); // the limit path, not the prompt

        var closed = Assert.Single(h.TimeEntries());
        Assert.Equal("2026-08-25T09:01:00Z", closed.EndTime);

        var idle = Assert.Single(h.IdleEvents());
        Assert.Equal("DISCARDED", idle.ResolvedAction);
        Assert.Equal("2026-08-25T09:01:00Z", idle.StartTime);

        Assert.Equal(T0.AddMinutes(1), Assert.Single(h.LimitNotices));
    }

    /// <summary>
    /// The per-entry arming fix (ported from the timeout-model regression it was found in).
    /// Stopping BEFORE any away cycle leaves the monitor Active; without re-arming for the fresh
    /// entry, a stale idle reading reported right after Start would flag the NEW entry away using
    /// the OLD entry's arming instant — before the new entry even existed.
    /// </summary>
    [Fact]
    public void StartingAFreshEntryReArmsSoStaleIdlenessDoesNotCarryOver()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null); // 09:00
        h.Coordinator.Tick(0); // arm at 09:00

        h.Now = T0.AddMinutes(6);
        h.Tracker.Stop(); // stopped before any away cycle — monitor still Active
        h.Tracker.Start("p2", null); // a different project, started right away
        var fresh = ((TrackerState.Tracking)h.Tracker.State).EntryId;

        // Reporting 600s idle right after Start must not retroactively flag the FRESH entry away
        // using the OLD entry's arming instant (09:00) — it has to measure from when THIS entry
        // armed (09:06), which is well under the threshold.
        h.Coordinator.Tick(600);

        Assert.Equal(fresh, ((TrackerState.Tracking)h.Tracker.State).EntryId);
        Assert.Empty(h.Prompts);
        Assert.Empty(h.IdleEvents());
    }

    /// <summary>The other half: the fresh entry is still fully protected on its OWN inactivity.</summary>
    [Fact]
    public void TheFreshEntryStillGoesAwayOnItsOwnInactivity()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0);

        h.Now = T0.AddMinutes(6);
        h.Tracker.Stop();
        h.Tracker.Start("p2", null);
        h.Coordinator.Tick(0); // re-arm for the fresh entry at 09:06

        h.Now = T0.AddMinutes(12);
        h.Coordinator.Tick(300); // 5 min idle since 09:07 (armed at 09:06)
        h.Now = T0.AddMinutes(13);
        h.Coordinator.Tick(0); // back

        Assert.Equal(6, Assert.Single(h.Prompts)); // away for 6 minutes: 09:07 to 09:13
    }

    /// <summary>
    /// Back, prompt ignored, gone for the night. Without this the unanswered prompt switched idle
    /// detection off and the timer ran to the 12h cap. Now the prompt is withdrawn as a Discard, the
    /// minutes worked after returning are kept, and the second absence ends the entry.
    /// </summary>
    [Fact]
    public void LeavingForTheNightWithThePromptOpenStillStopsTheTimer()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", "t1");
        h.Coordinator.Tick(0); // arm at 09:00

        h.Now = T0.AddMinutes(5);
        h.Coordinator.Tick(300); // away since 09:00
        h.Now = T0.AddMinutes(7);
        h.Coordinator.Tick(5); // back -> prompt
        Assert.Single(h.Prompts);

        h.Now = T0.AddMinutes(13);
        h.Coordinator.Tick(330); // left again at 09:07:30

        Assert.Equal(1, h.Dismissals);
        var replacement = Assert.IsType<TrackerState.Tracking>(h.Tracker.State);
        Assert.Equal(T0.AddMinutes(7), replacement.StartedAt); // opens at the return
        Assert.Equal("p1", replacement.Selection.ProjectId);

        h.Now = T0.AddMinutes(68); // overnight
        h.Coordinator.Tick(3630);

        Assert.Equal(TrackerState.Idle, h.Tracker.State);
        Assert.Equal(T0.AddMinutes(7).AddSeconds(30), Assert.Single(h.LimitNotices));

        var entries = h.TimeEntries();
        Assert.Equal(2, entries.Count);
        Assert.Equal("2026-08-25T09:07:00Z", entries[1].StartTime);
        Assert.Equal("2026-08-25T09:07:30Z", entries[1].EndTime); // the worked minutes are kept

        var idle = h.IdleEvents();
        Assert.Equal(2, idle.Count);
        Assert.All(idle, e => Assert.Equal("DISCARDED", e.ResolvedAction));

        // The prompt's own answer, arriving late, changes nothing.
        h.Resolve?.Invoke(AwayResolution.Keep);
        Assert.Equal(2, h.IdleEvents().Count);
    }

    [Fact]
    public void AnsweringDiscardResumesFromTheReturnNotFromTheClick()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", "t1");
        h.Coordinator.Tick(0);

        h.Now = T0.AddMinutes(5);
        h.Coordinator.Tick(300); // away since 09:00
        h.Now = T0.AddMinutes(7);
        h.Coordinator.Tick(5); // back at 09:07
        h.Now = T0.AddMinutes(17);
        h.Coordinator.Tick(20); // working for ten minutes first
        h.Resolve!(AwayResolution.Discard);

        Assert.Equal(T0.AddMinutes(7), Assert.IsType<TrackerState.Tracking>(h.Tracker.State).StartedAt);
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
        monitor.Tick(0, T0.AddMinutes(6)); // back — the clock restarts here
        monitor.Tick(0, T0.AddMinutes(12)); // only 6 min of presence

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

        monitor.Tick(0, T0.AddMinutes(10)); // back at the keyboard
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
