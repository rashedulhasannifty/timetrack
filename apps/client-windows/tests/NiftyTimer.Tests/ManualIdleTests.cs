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
/// Manual tracking used to run THROUGH an away window and let the employee adjudicate it on
/// return. These tests pin the replacement: inactivity times the session out, and the entry ends
/// at a point derived from the threshold rather than from whenever the poller noticed.
/// </summary>
public class ManualIdleMonitorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private sealed class Recorder : IManualIdleMonitorDelegate
    {
        public List<(DateTimeOffset From, DateTimeOffset StoppingAt)> TimedOut { get; } = [];

        public void DidTimeOut(DateTimeOffset awayStart, DateTimeOffset stopInstant) =>
            TimedOut.Add((awayStart, stopInstant));
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
    public void ActivateArmsWithoutTouchingTheTimer()
    {
        var (monitor, recorder) = New(() => T0);

        monitor.Activate();

        Assert.Equal(ManualIdleState.Active, monitor.State);
        Assert.Empty(recorder.TimedOut);
    }

    [Fact]
    public void SubThresholdTickDoesNothing()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddSeconds(299);
        monitor.Tick(299);

        Assert.Equal(ManualIdleState.Active, monitor.State);
        Assert.Empty(recorder.TimedOut);
    }

    /// <summary>
    /// The headline. Input stopped at T0; the entry ends 300s later — those idle minutes stay on
    /// the timesheet, because the admin's chosen threshold is what the team is willing to credit.
    /// </summary>
    [Fact]
    public void CrossingTheThresholdTimesOutAndKeepsTheIdleMinutes()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddSeconds(300);
        monitor.Tick(300);

        Assert.Equal((T0, T0.AddSeconds(300)), Assert.Single(recorder.TimedOut));
    }

    /// <summary>
    /// The poller runs on its own cadence, so a reading can overshoot the threshold. The entry's
    /// end must not drift with it: two PCs on the same policy end the same span in the same place.
    /// </summary>
    [Fact]
    public void TheStopInstantComesFromTheThresholdNotTheTickThatNoticed()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddSeconds(475);
        monitor.Tick(475); // noticed 175s late

        Assert.Equal((T0, T0.AddSeconds(300)), Assert.Single(recorder.TimedOut));
    }

    /// <summary>
    /// A locked screen is not a long read: the moment input stopped is known exactly, so no idle
    /// minutes are credited that provably did not happen.
    /// </summary>
    [Fact]
    public void SleepOrLockStopsWhereTheInputDid()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddSeconds(60);
        monitor.MarkAway();

        Assert.Equal((now, now), Assert.Single(recorder.TimedOut));
    }

    /// <summary>
    /// Disarming as it fires is what stops a still-idle PC from re-closing an entry the timeout
    /// already closed — and what lets the coordinator re-arm on the next manual session.
    /// </summary>
    [Fact]
    public void TimingOutDisarmsTheMonitor()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddSeconds(300);
        monitor.Tick(300);
        Assert.Equal(ManualIdleState.Inactive, monitor.State);

        now = T0.AddSeconds(600);
        monitor.Tick(600);
        monitor.MarkAway();

        Assert.Single(recorder.TimedOut); // a disarmed monitor decides nothing
    }

    /// <summary>
    /// The OS idle counter does not reset when someone presses Stop and starts something else.
    /// Without clamping to the arming instant, that inherited reading closes the new span the
    /// moment it opens — a policy stop for inactivity that belongs to the previous session.
    /// </summary>
    [Fact]
    public void IdlenessInheritedFromBeforeTheSessionDoesNotCount()
    {
        var now = T0.AddSeconds(900); // 15 min idle before this session
        var (monitor, recorder) = New(() => now);
        monitor.Activate();           // armed at T0+900

        monitor.Tick(900);

        Assert.Empty(recorder.TimedOut); // the new session has been idle for 0s, not 900s
        Assert.Equal(ManualIdleState.Active, monitor.State);

        // It times out on its OWN inactivity, measured from arming.
        now = T0.AddSeconds(1200);
        monitor.Tick(1200);

        Assert.Equal((T0.AddSeconds(900), T0.AddSeconds(1200)), Assert.Single(recorder.TimedOut));
    }

    [Fact]
    public void DeactivateReportsNothing()
    {
        var now = T0;
        var (monitor, recorder) = New(() => now);
        monitor.Activate();

        now = T0.AddSeconds(120);
        monitor.Deactivate();

        Assert.Equal(ManualIdleState.Inactive, monitor.State);
        Assert.Empty(recorder.TimedOut); // nothing is ever left pending to abandon
    }
}

/// <summary>
/// The coordinator that turns a manual inactivity timeout into a closed entry and a buffer write.
///
/// The bug these pin: a manual entry ran through an away window and KEPT it unless the employee
/// came back and discarded it. A PC left awake produced a multi-day span whose start day reported
/// more tracked time than the day contains. Inactivity now closes the entry by policy.
///
/// Note what this type no longer has: no presentAwayPrompt. Once the timeout has closed the entry
/// there is nothing left for the employee to adjudicate on return, so the prompt is gone by
/// construction rather than by assertion.
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

        public int Stops { get; private set; }

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
                clock: () => h.Now,
                idGen: _ => $"idle-{++m}",
                onTrackingStopped: () => h.Stops++);
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
    /// The headline. Before this, the entry was still running here and would have kept running for
    /// as long as the PC stayed awake.
    /// </summary>
    [Fact]
    public void InactivityClosesTheManualEntryAtTheThreshold()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", "t1");          // manual entry opens at 09:00

        h.Now = T0.AddMinutes(1);
        h.Coordinator.Tick(0);                // the poller arms; still working

        h.Now = T0.AddMinutes(6);
        h.Coordinator.Tick(300);              // idle since 09:01

        Assert.Equal(TrackerState.Idle, h.Tracker.State); // an unattended timer must not keep counting

        var closed = Assert.Single(h.TimeEntries());
        Assert.Equal("2026-08-25T09:00:00Z", closed.StartTime);
        Assert.Equal("2026-08-25T09:06:00Z", closed.EndTime); // 09:01 + 5 min
    }

    /// <summary>
    /// The other half of the policy: the minutes before the timeout stay ON the entry, and the
    /// window is recorded so the Idle panel can show what they were.
    /// </summary>
    [Fact]
    public void TheKeptIdleWindowIsRecorded()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0);                // the poller arms the session

        h.Now = T0.AddMinutes(5);
        h.Coordinator.Tick(300);

        var idle = Assert.Single(h.IdleEvents());
        Assert.Equal("KEPT", idle.ResolvedAction);
        Assert.Equal("2026-08-25T09:00:00Z", idle.StartTime);
        Assert.Equal("2026-08-25T09:05:00Z", idle.EndTime);
    }

    /// <summary>Sleep/lock knows exactly when input stopped, so it credits nothing and records no window.</summary>
    [Fact]
    public void SleepClosesTheEntryWithoutCreditingIdleTime()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);

        h.Now = T0.AddMinutes(1);
        h.Coordinator.MarkAway();

        Assert.Equal(TrackerState.Idle, h.Tracker.State);
        Assert.Equal("2026-08-25T09:01:00Z", Assert.Single(h.TimeEntries()).EndTime);
        Assert.Empty(h.IdleEvents()); // no idle minutes were credited, so there is no window
    }

    /// <summary>
    /// The tray reads MenuViewModel and cannot see a stop performed on the tracker directly —
    /// without this the indicator would keep reporting a session that policy already ended.
    /// </summary>
    [Fact]
    public void TheOwnerIsToldSoTheIndicatorCanFollow()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0);
        Assert.Equal(0, h.Stops);

        h.Now = T0.AddMinutes(5);
        h.Coordinator.Tick(300);

        Assert.Equal(1, h.Stops);
    }

    /// <summary>
    /// With no manual span running there is nothing to be idle against — the auto layer handles
    /// that case, and this one must stay silent rather than closing a clock that is already stopped.
    /// </summary>
    [Fact]
    public void SignalsAreIgnoredWhenNothingIsTracking()
    {
        var h = Harness.Build();

        h.Now = T0.AddMinutes(10);
        h.Coordinator.Tick(600);
        h.Coordinator.MarkAway();

        Assert.Empty(h.Buffer.Entries);
        Assert.Equal(0, h.Stops);
        Assert.Equal(ManualIdleState.Inactive, h.Coordinator.MonitorState);
    }

    /// <summary>
    /// An AUTO span belongs to the other coordinator, which stops at the away start on its own
    /// terms. This one must never reach across and close it on manual terms.
    /// </summary>
    [Fact]
    public void SignalsAreIgnoredDuringAnAutoSpan()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null, source: TimeTracker.EntrySource.Auto);

        h.Now = T0.AddMinutes(5);
        h.Coordinator.Tick(300);

        Assert.IsType<TrackerState.Tracking>(h.Tracker.State);
        Assert.Equal(ManualIdleState.Inactive, h.Coordinator.MonitorState);
    }

    /// <summary>
    /// A paused session is a deliberate break the person already took. It is not this coordinator's
    /// to close, and the tracker is not tracking, so nothing routes.
    /// </summary>
    [Fact]
    public void SignalsAreIgnoredWhilePaused()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0);
        h.Tracker.Pause();

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(1800);

        Assert.IsType<TrackerState.Paused>(h.Tracker.State);
        Assert.Empty(h.IdleEvents());
    }

    /// <summary>
    /// Integrity re-check: the signal was routed while a manual session was live, but TimeTracker
    /// is the authority on what is running NOW. Stopping on a stale decision would close a span
    /// belonging to a different session — the same mis-attribution class as the sign-out leak.
    /// </summary>
    [Fact]
    public void ATimeoutAimedAtAnEndedSessionCannotCloseTheNextOne()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0);

        h.Now = T0.AddMinutes(5);
        h.Tracker.Stop();                  // the user pressed Stop themselves
        h.Tracker.Start("p2", null);       // and started something else
        var fresh = ((TrackerState.Tracking)h.Tracker.State).EntryId;

        h.Coordinator.Tick(300);

        // The new span is untouched: the monitor re-arms on this tick, so nothing decides anything
        // until the NEW session goes idle on its own.
        Assert.Equal(fresh, ((TrackerState.Tracking)h.Tracker.State).EntryId);
        Assert.Single(h.TimeEntries());    // only the span the user stopped is closed

        h.Now = T0.AddMinutes(10);
        h.Coordinator.Tick(300);

        Assert.Equal(TrackerState.Idle, h.Tracker.State);
        Assert.Equal(2, h.TimeEntries().Count);
        Assert.Equal("2026-08-25T09:05:00Z", h.TimeEntries()[1].StartTime);
    }

    /// <summary>
    /// After a timeout the person restarts when they are ready, and the next session is protected
    /// exactly like the first — the monitor re-arms rather than staying spent.
    /// </summary>
    [Fact]
    public void TheNextManualSessionIsProtectedToo()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0);

        h.Now = T0.AddMinutes(5);
        h.Coordinator.Tick(300);
        Assert.Equal(TrackerState.Idle, h.Tracker.State);

        h.Now = T0.AddMinutes(6);
        h.Tracker.Start("p1", null);       // they come back and start again
        h.Coordinator.Tick(0);

        h.Now = T0.AddMinutes(11);
        h.Coordinator.Tick(300);

        Assert.Equal(TrackerState.Idle, h.Tracker.State); // the second session times out like the first
        Assert.Equal(2, h.TimeEntries().Count);
    }

    /// <summary>
    /// Sign-out leaves nothing behind. There is no pending window to abandon, so no UNRESOLVED row
    /// is written against the user who is leaving — and the next user arms a monitor from scratch.
    /// </summary>
    [Fact]
    public void DeactivateSettlesNothingBecauseNothingIsPending()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Coordinator.Tick(0);

        h.Now = T0.AddMinutes(3);
        h.Coordinator.Deactivate();

        Assert.Empty(h.IdleEvents());
        Assert.Equal(ManualIdleState.Inactive, h.Coordinator.MonitorState);
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
