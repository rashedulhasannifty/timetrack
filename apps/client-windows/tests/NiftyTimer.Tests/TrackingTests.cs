using System.Text.Json;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

public class TimeTrackerTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private static (TimeTracker Tracker, BufferSpy Buffer, Func<DateTimeOffset> Clock) NewTracker(
        Func<DateTimeOffset> clock)
    {
        var buffer = new BufferSpy();
        var n = 0;
        var tracker = new TimeTracker(buffer, clock, _ => $"id-{++n}");
        return (tracker, buffer, clock);
    }

    private static TimeEntryPayload Decode(byte[] payload) =>
        JsonSerializer.Deserialize<TimeEntryPayload>(payload)!;

    [Fact]
    public void StartsIdleAndEnqueuesNothing()
    {
        var (tracker, buffer, _) = NewTracker(() => T0);

        Assert.False(tracker.IsRunning);
        Assert.False(tracker.IsPaused);
        Assert.Empty(buffer.Entries);
    }

    [Fact]
    public void StopEnqueuesOneClosedEntry()
    {
        var now = T0;
        var (tracker, buffer, _) = NewTracker(() => now);

        tracker.Start("p1", "t1");
        now = T0.AddMinutes(30);
        tracker.Stop();

        var entry = Assert.Single(buffer.Entries);
        Assert.Equal(BufferKind.TimeEntry, entry.Kind);

        var payload = Decode(entry.Payload);
        Assert.Equal("p1", payload.ProjectId);
        Assert.Equal("t1", payload.TaskId);
        Assert.Equal("2026-08-25T09:00:00Z", payload.StartTime);
        Assert.Equal("2026-08-25T09:30:00Z", payload.EndTime);
        Assert.Equal("MANUAL", payload.Source);
    }

    [Fact]
    public void ASecondStartWhileTrackingIsIgnored()
    {
        var (tracker, buffer, _) = NewTracker(() => T0);

        tracker.Start("p1", null);
        var first = ((TrackerState.Tracking)tracker.State).EntryId;
        tracker.Start("p2", null);

        Assert.Equal(first, ((TrackerState.Tracking)tracker.State).EntryId);
        Assert.Empty(buffer.Entries);
    }

    /// <summary>
    /// Pause closes the entry and Resume opens a NEW one — the data model is one start/end pair
    /// per entry, so paused time is simply excluded rather than recorded and subtracted.
    /// </summary>
    [Fact]
    public void PauseClosesTheEntryAndResumeOpensANewOne()
    {
        var now = T0;
        var (tracker, buffer, _) = NewTracker(() => now);

        tracker.Start("p1", null);
        now = T0.AddMinutes(10);
        tracker.Pause();

        Assert.True(tracker.IsPaused);
        Assert.Single(buffer.Entries);

        now = T0.AddMinutes(40);
        tracker.Resume();
        now = T0.AddMinutes(50);
        tracker.Stop();

        Assert.Equal(2, buffer.Entries.Count);

        var second = Decode(buffer.Entries[1].Payload);
        Assert.Equal("2026-08-25T09:40:00Z", second.StartTime);
        Assert.Equal("2026-08-25T09:50:00Z", second.EndTime);
        Assert.NotEqual(buffer.Entries[0].Id, buffer.Entries[1].Id);
    }

    [Fact]
    public void ReselectingWhilePausedSurvivesTheResume()
    {
        var now = T0;
        var (tracker, buffer, _) = NewTracker(() => now);

        tracker.Start("p1", null);
        tracker.Pause();
        tracker.Reselect(new TimeTracker.Selection("p2", "t2"));
        tracker.Resume();
        now = T0.AddMinutes(5);
        tracker.Stop();

        var resumed = Decode(buffer.Entries[1].Payload);
        Assert.Equal("p2", resumed.ProjectId);
        Assert.Equal("t2", resumed.TaskId);
    }

    /// <summary>
    /// A note describes what the person was doing; it does not re-attribute the time. So setting
    /// it edits the running span in place rather than splitting it into two entries.
    /// </summary>
    [Fact]
    public void SettingANoteDoesNotSplitTheRunningSpan()
    {
        var now = T0;
        var (tracker, buffer, _) = NewTracker(() => now);

        tracker.Start("p1", null);
        now = T0.AddMinutes(5);
        tracker.SetNote("drafting the port plan");
        now = T0.AddMinutes(20);
        tracker.Stop();

        var entry = Assert.Single(buffer.Entries);
        var payload = Decode(entry.Payload);
        Assert.Equal("drafting the port plan", payload.Note);
        Assert.Equal("2026-08-25T09:00:00Z", payload.StartTime);
        Assert.Equal("2026-08-25T09:20:00Z", payload.EndTime);
    }

    /// <summary>
    /// A backwards clock step (NTP correction, wake from sleep, hand-set clock) must not produce
    /// an inverted span: the server 422s it, the uploader calls that permanent, and the record is
    /// dropped — the person silently loses real tracked time.
    /// </summary>
    [Fact]
    public void ABackwardsClockStepCollapsesToZeroRatherThanInverting()
    {
        var now = T0;
        var (tracker, buffer, _) = NewTracker(() => now);

        tracker.Start("p1", null);
        now = T0.AddMinutes(-15); // the clock stepped backwards mid-span
        tracker.Stop();

        var payload = Decode(Assert.Single(buffer.Entries).Payload);
        Assert.Equal(payload.StartTime, payload.EndTime);
    }

    /// <summary>
    /// Auto-stop closes at the moment the person went away, not at the moment the client noticed.
    /// Closing at "now" would credit them with the whole idle window.
    /// </summary>
    [Fact]
    public void StopCanBackdateTheClose()
    {
        var now = T0;
        var (tracker, buffer, _) = NewTracker(() => now);

        tracker.Start("p1", null);
        now = T0.AddMinutes(30);
        tracker.Stop(T0.AddMinutes(20)); // idle began 10 minutes before we noticed

        var payload = Decode(Assert.Single(buffer.Entries).Payload);
        Assert.Equal("2026-08-25T09:20:00Z", payload.EndTime);
    }

    [Fact]
    public void RecordSpanEnqueuesWithoutTouchingLiveState()
    {
        var (tracker, buffer, _) = NewTracker(() => T0);

        tracker.Start("p1", null);
        tracker.RecordSpan(T0.AddHours(-1), T0.AddMinutes(-30), "p9", null, TimeTracker.EntrySource.Auto);

        Assert.True(tracker.IsRunning);
        var payload = Decode(Assert.Single(buffer.Entries).Payload);
        Assert.Equal("AUTO", payload.Source);
        Assert.Equal("p9", payload.ProjectId);
    }

    /// <summary>
    /// The 409 rollback: the server never accepted the span, so nothing is recorded. Enqueuing a
    /// zero-duration row here would be a fabricated record — the running-entry index is held by
    /// the OTHER machine, so there is nothing local to release.
    /// </summary>
    [Fact]
    public void AbandoningARunningSpanRecordsNothing()
    {
        var (tracker, buffer, _) = NewTracker(() => T0);

        tracker.Start("p1", null);
        var id = ((TrackerState.Tracking)tracker.State).EntryId;

        Assert.True(tracker.AbandonRunningSpan(id));
        Assert.False(tracker.IsRunning);
        Assert.Empty(buffer.Entries);
    }

    /// <summary>
    /// The 409 answers a fire-and-forget publish, so it can land after its span was superseded —
    /// switching project while tracking closes one span and opens another within the same second.
    /// Abandoning on a stale id would stop a clock the server never objected to.
    /// </summary>
    [Fact]
    public void AbandoningAStaleSpanIdLeavesTheCurrentSpanAlone()
    {
        var now = T0;
        var (tracker, _, _) = NewTracker(() => now);

        tracker.Start("p1", null);
        var first = ((TrackerState.Tracking)tracker.State).EntryId;

        now = T0.AddSeconds(2);
        tracker.Stop();
        tracker.Start("p2", null); // superseded: a different span is running now

        Assert.False(tracker.AbandonRunningSpan(first));
        Assert.True(tracker.IsRunning);
        Assert.Equal("p2", ((TrackerState.Tracking)tracker.State).Selection.ProjectId);
    }

    [Fact]
    public void AbandoningWhilePausedOrIdleDoesNothing()
    {
        var (tracker, _, _) = NewTracker(() => T0);

        Assert.False(tracker.AbandonRunningSpan("anything"));

        tracker.Start("p1", null);
        var id = ((TrackerState.Tracking)tracker.State).EntryId;
        tracker.Pause();

        Assert.False(tracker.AbandonRunningSpan(id));
        Assert.True(tracker.IsPaused);
    }

    [Fact]
    public void SpanOpenedAndSpanClosedFire()
    {
        var now = T0;
        var (tracker, _, _) = NewTracker(() => now);

        var opened = 0;
        var closed = new List<ClosedSpan>();
        tracker.SpanOpened += (_, _, _, _) => opened++;
        tracker.SpanClosed += closed.Add;

        tracker.Start("p1", null);
        now = T0.AddMinutes(1);
        tracker.Stop();

        Assert.Equal(1, opened);

        // The closed span carries everything needed to publish it, not just its bounds — the close
        // has to reach the server before the next open, or that open is refused with a 409.
        var span = Assert.Single(closed);
        Assert.Equal("id-1", span.EntryId);
        Assert.Equal(T0, span.Start);
        Assert.Equal(T0.AddMinutes(1), span.End);
        Assert.Equal("p1", span.Selection.ProjectId);
        Assert.Equal(TimeTracker.EntrySource.Manual, span.Source);
    }

    /// <summary>
    /// The clamp that keeps a backwards clock step from producing an inverted span applies to the
    /// published close as much as the buffered one — they must not disagree about when the entry
    /// ended.
    /// </summary>
    [Fact]
    public void AnInvertedCloseIsClampedInTheReportedSpanToo()
    {
        var now = T0;
        var (tracker, _, _) = NewTracker(() => now);

        var closed = new List<ClosedSpan>();
        tracker.SpanClosed += closed.Add;

        tracker.Start("p1", null);
        tracker.Stop(T0.AddMinutes(-10));

        var span = Assert.Single(closed);
        Assert.Equal(T0, span.Start);
        Assert.Equal(T0, span.End);
    }
}

public class LiveEntryPublisherTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private static readonly TimeTracker.Selection Selection = new("p1", "t1");

    private static Task Publish(LiveEntryPublisher publisher) =>
        publisher.PublishAsync("entry-1", T0, Selection, TimeTracker.EntrySource.Manual);

    private static ClosedSpan Closed(string id = "entry-1") =>
        new(id, T0, T0.AddMinutes(20), Selection, TimeTracker.EntrySource.Manual);

    [Fact]
    public async Task PublishesACloseWithItsEndTime()
    {
        var uploader = new FakeUploader();
        var publisher = new LiveEntryPublisher(uploader);

        await publisher.PublishCloseAsync(Closed());

        var payload = JsonSerializer.Deserialize<TimeEntryPayload>(Assert.Single(uploader.Uploads))!;
        Assert.Equal("entry-1", payload.Id);
        Assert.Equal("2026-08-25T09:00:00Z", payload.StartTime);
        Assert.Equal("2026-08-25T09:20:00Z", payload.EndTime);
    }

    /// <summary>
    /// The ordering the whole fix rests on. Every close is followed within milliseconds by an open,
    /// and the server holds the one-open-entry slot until it hears the close — so if the open
    /// overtakes it, the open is refused and the user is told they are tracking on another machine
    /// they do not have. Two fire-and-forget HTTP calls can complete in either order, so the
    /// publisher chains them.
    /// </summary>
    [Fact]
    public async Task ACloseIsAlwaysSentBeforeAnOpenQueuedAfterIt()
    {
        var gate = new TaskCompletionSource();
        var uploader = new OrderSpy(firstCallWaitsFor: gate.Task);
        var publisher = new LiveEntryPublisher(uploader);

        var close = publisher.PublishCloseAsync(Closed());
        var open = publisher.PublishAsync("entry-2", T0.AddMinutes(20), Selection, TimeTracker.EntrySource.Manual);

        // Release the close only after the open has had every chance to overtake it.
        await Task.Delay(50);
        Assert.Equal(["entry-1"], uploader.Started);

        gate.SetResult();
        await Task.WhenAll(close, open);

        Assert.Equal(["entry-1", "entry-2"], uploader.Completed);
    }

    /// <summary>
    /// A 409 immediately after one of our own closes failed to land is us holding our own slot, not
    /// evidence of a second machine. Stopping the user's clock and telling them to "stop it there
    /// first" over our own failed request is the worse wrong answer.
    /// </summary>
    [Fact]
    public async Task AConflictIsNotBlamedOnAnotherMachineWhenOurOwnCloseFailed()
    {
        var uploader = new FakeUploader(new UploadResult.Transient(), new UploadResult.Permanent(409));
        var publisher = new LiveEntryPublisher(uploader);

        var conflicts = new List<string>();
        publisher.ConflictDetected += conflicts.Add;

        await publisher.PublishCloseAsync(Closed());          // fails
        await Publish(publisher);                             // 409 against our own still-open row

        Assert.Empty(conflicts);
    }

    [Fact]
    public async Task AConflictAfterASuccessfulCloseIsStillReported()
    {
        var uploader = new FakeUploader(new UploadResult.Success(), new UploadResult.Permanent(409));
        var publisher = new LiveEntryPublisher(uploader);

        var conflicts = new List<string>();
        publisher.ConflictDetected += conflicts.Add;

        await publisher.PublishCloseAsync(Closed());
        await Publish(publisher);

        Assert.Equal(["entry-1"], conflicts);
    }

    /// <summary>The suppression must lift once the close finally lands, or 409s go unreported forever.</summary>
    [Fact]
    public async Task ReportingResumesOnceTheCloseGetsThrough()
    {
        var uploader = new FakeUploader(
            new UploadResult.Transient(),
            new UploadResult.Success(),
            new UploadResult.Permanent(409));
        var publisher = new LiveEntryPublisher(uploader);

        var conflicts = new List<string>();
        publisher.ConflictDetected += conflicts.Add;

        await publisher.PublishCloseAsync(Closed());  // fails
        await publisher.PublishCloseAsync(Closed());  // retried, lands
        await Publish(publisher);                     // now a 409 means what it says

        Assert.Equal(["entry-1"], conflicts);
    }

    /// <summary>A failed publish must not wedge the chain for the rest of the session.</summary>
    [Fact]
    public async Task AFailedPublishDoesNotStallEverythingBehindIt()
    {
        var uploader = new ThrowingThenWorkingUploader();
        var publisher = new LiveEntryPublisher(uploader);

        await Assert.ThrowsAnyAsync<Exception>(() => Publish(publisher));
        await Publish(publisher);

        Assert.Equal(2, uploader.Calls);
    }

    private sealed class OrderSpy : IUploader
    {
        private readonly Task _firstCallWaitsFor;
        private int _calls;

        public OrderSpy(Task firstCallWaitsFor) => _firstCallWaitsFor = firstCallWaitsFor;

        public List<string> Started { get; } = [];

        public List<string> Completed { get; } = [];

        public async Task<UploadResult> UploadAsync(byte[] payload, CancellationToken cancellationToken = default)
        {
            var id = JsonSerializer.Deserialize<TimeEntryPayload>(payload)!.Id;
            lock (Started)
            {
                Started.Add(id);
            }

            if (Interlocked.Increment(ref _calls) == 1)
            {
                await _firstCallWaitsFor;
            }

            lock (Completed)
            {
                Completed.Add(id);
            }

            return new UploadResult.Success();
        }
    }

    private sealed class ThrowingThenWorkingUploader : IUploader
    {
        public int Calls { get; private set; }

        public Task<UploadResult> UploadAsync(byte[] payload, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Calls == 1
                ? throw new InvalidOperationException("boom")
                : Task.FromResult<UploadResult>(new UploadResult.Success());
        }
    }

    [Fact]
    public async Task PublishesTheRunningEntryWithANullEndTime()
    {
        var uploader = new FakeUploader();
        var publisher = new LiveEntryPublisher(uploader);

        await Publish(publisher);

        var payload = JsonSerializer.Deserialize<TimeEntryPayload>(Assert.Single(uploader.Uploads))!;
        Assert.Equal("entry-1", payload.Id);
        Assert.Null(payload.EndTime);
        Assert.Equal("2026-08-25T09:00:00Z", payload.StartTime);
    }

    [Fact]
    public async Task ASingleFailureIsSwallowed()
    {
        var uploader = new FakeUploader(new UploadResult.Transient());
        var publisher = new LiveEntryPublisher(uploader);

        var blocked = new List<bool>();
        publisher.BlockedChanged += blocked.Add;

        await Publish(publisher);

        Assert.Empty(blocked);
    }

    [Fact]
    public async Task SustainedFailureRaisesTheBlockedWarningOnce()
    {
        var uploader = new FakeUploader { Default = new UploadResult.Transient() };
        var publisher = new LiveEntryPublisher(uploader);

        var blocked = new List<bool>();
        publisher.BlockedChanged += blocked.Add;

        for (var i = 0; i < 5; i++)
        {
            await Publish(publisher);
        }

        Assert.Equal([true], blocked); // fires on CHANGE, not on every heartbeat
    }

    [Fact]
    public async Task ASuccessClearsTheBlockedWarning()
    {
        var uploader = new FakeUploader(
            new UploadResult.Transient(),
            new UploadResult.Transient(),
            new UploadResult.Transient(),
            new UploadResult.Success());
        var publisher = new LiveEntryPublisher(uploader);

        var blocked = new List<bool>();
        publisher.BlockedChanged += blocked.Add;

        for (var i = 0; i < 4; i++)
        {
            await Publish(publisher);
        }

        Assert.Equal([true, false], blocked);
    }

    /// <summary>
    /// A 409 means "you are already tracking on another machine" — a definite answer, not a flaky
    /// link. It must NOT go through the consecutive-failure counter, or the user would see a
    /// vague "not recording" warning twice before anything told them the real reason.
    /// </summary>
    [Fact]
    public async Task ConflictRaisesItsOwnSignalAndNeverTheGenericWarning()
    {
        var uploader = new FakeUploader { Default = new UploadResult.Permanent(409) };
        var publisher = new LiveEntryPublisher(uploader);

        var blocked = new List<bool>();
        var conflicts = new List<string>();
        publisher.BlockedChanged += blocked.Add;
        publisher.ConflictDetected += conflicts.Add;

        for (var i = 0; i < 5; i++)
        {
            await Publish(publisher);
        }

        Assert.Equal(5, conflicts.Count);
        Assert.All(conflicts, id => Assert.Equal("entry-1", id)); // identifies WHICH span was refused
        Assert.Empty(blocked);
    }

    /// <summary>Other permanent 4xx are ordinary failures and still escalate.</summary>
    [Fact]
    public async Task OtherPermanentFailuresStillEscalate()
    {
        var uploader = new FakeUploader { Default = new UploadResult.Permanent(422) };
        var publisher = new LiveEntryPublisher(uploader);

        var blocked = new List<bool>();
        var conflicts = new List<string>();
        publisher.BlockedChanged += blocked.Add;
        publisher.ConflictDetected += conflicts.Add;

        for (var i = 0; i < 3; i++)
        {
            await Publish(publisher);
        }

        Assert.Empty(conflicts);
        Assert.Equal([true], blocked);
    }
}
