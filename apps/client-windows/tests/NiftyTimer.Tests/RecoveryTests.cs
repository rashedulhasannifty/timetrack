using System.Text.Json;
using NiftyTimer.App;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The crash-recovery record. One mutable row describing a span that has not finished, kept apart
/// from the durable buffer of completed records.
/// </summary>
public class LiveSpanStoreTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void LoadsNothingWhenNoSpanWasEverWritten()
    {
        using var dir = new TempDirectory();
        var store = new LiveSpanStore(dir.File("live-span.json"), () => "user-1");

        Assert.Null(store.Load());
    }

    [Fact]
    public void RoundTripsTheOpenSpan()
    {
        using var dir = new TempDirectory();
        var store = new LiveSpanStore(dir.File("live-span.json"), () => "user-1");

        store.Begin("entry-1", T0, new TimeTracker.Selection("p1", "t1"), TimeTracker.EntrySource.Auto);

        var span = store.Load()!;
        Assert.Equal("entry-1", span.EntryId);
        Assert.Equal(T0, span.StartTime);
        Assert.Equal("p1", span.ProjectId);
        Assert.Equal("t1", span.TaskId);
        Assert.Equal("AUTO", span.Source);
        Assert.Equal("user-1", span.UserId);
        Assert.Equal(T0, span.LastAlive); // starts equal to the start
    }

    /// <summary>
    /// The heartbeat is what bounds the cost of a crash: recovery closes at LastAlive, so at most
    /// one interval of real work is lost and no downtime is ever counted.
    /// </summary>
    [Fact]
    public void HeartbeatAdvancesLastAliveAndNothingElse()
    {
        using var dir = new TempDirectory();
        var store = new LiveSpanStore(dir.File("live-span.json"), () => "user-1");
        store.Begin("entry-1", T0, new TimeTracker.Selection("p1", null), TimeTracker.EntrySource.Manual);

        store.Heartbeat(T0.AddMinutes(20));

        var span = store.Load()!;
        Assert.Equal(T0, span.StartTime);
        Assert.Equal(T0.AddMinutes(20), span.LastAlive);
    }

    [Fact]
    public void HeartbeatingWithNoSpanWritesNothing()
    {
        using var dir = new TempDirectory();
        var store = new LiveSpanStore(dir.File("live-span.json"), () => "user-1");

        store.Heartbeat(T0);

        Assert.Null(store.Load());
    }

    [Fact]
    public void ClearRemovesTheSpan()
    {
        using var dir = new TempDirectory();
        var store = new LiveSpanStore(dir.File("live-span.json"), () => "user-1");
        store.Begin("entry-1", T0, new TimeTracker.Selection(null, null), TimeTracker.EntrySource.Manual);

        store.Clear();

        Assert.Null(store.Load());
    }

    /// <summary>A crash between the write and the rename must not read back as a plausible span.</summary>
    [Fact]
    public void ATruncatedFileReadsAsNoSpan()
    {
        using var dir = new TempDirectory();
        var path = dir.File("live-span.json");
        File.WriteAllText(path, "{\"entryId\":\"entry-1\",\"startT");

        Assert.Null(new LiveSpanStore(path, () => "user-1").Load());
    }

    [Theory]
    [InlineData("user-1", "user-1", true)]
    [InlineData("user-1", "user-2", false)]
    [InlineData("user-1", null, false)]
    [InlineData(null, "user-1", true)] // predates userId stamping
    public void RecoversOnlyTheCurrentUsersSpan(string? owner, string? current, bool expected)
    {
        var span = new LiveSpan
        {
            EntryId = "entry-1",
            StartTime = T0,
            Source = "MANUAL",
            LastAlive = T0,
            UserId = owner,
        };

        Assert.Equal(expected, LiveSpanStore.ShouldRecover(span, current));
    }
}

/// <summary>
/// Applying the recovery choice. Both outcomes go through the durable buffer, and both close the
/// server's still-open row.
/// </summary>
public class LiveSpanRecoveryTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private sealed class RecorderSpy : ILiveSpanRecorder
    {
        public int Cleared { get; private set; }

        public void Begin(string entryId, DateTimeOffset startTime, TimeTracker.Selection selection, TimeTracker.EntrySource source)
        {
        }

        public void Clear() => Cleared++;
    }

    private static LiveSpan Span(string? userId = "user-1") => new()
    {
        EntryId = "entry-1",
        StartTime = T0,
        ProjectId = "p1",
        TaskId = "t1",
        Source = "AUTO",
        LastAlive = T0.AddMinutes(45),
        UserId = userId,
    };

    private static (LiveSpanRecovery Recovery, BufferSpy Buffer, RecorderSpy Store) New(Func<string?> currentUser)
    {
        var buffer = new BufferSpy();
        var store = new RecorderSpy();
        var tracker = new TimeTracker(buffer, () => T0, _ => "unused");
        return (new LiveSpanRecovery(tracker, store, currentUser), buffer, store);
    }

    private static TimeEntryPayload Only(BufferSpy buffer) =>
        JsonSerializer.Deserialize<TimeEntryPayload>(Assert.Single(buffer.Entries).Payload)!;

    /// <summary>Keep closes at the last heartbeat, so the hours the machine was off are not counted.</summary>
    [Fact]
    public void KeepClosesTheSpanAtTheLastHeartbeat()
    {
        var (recovery, buffer, store) = New(() => "user-1");

        recovery.Apply(AwayResolution.Keep, Span());

        var entry = Only(buffer);
        Assert.Equal("entry-1", entry.Id); // the ORIGINAL id — the server upserts, not duplicates
        Assert.Equal("2026-08-25T09:00:00Z", entry.StartTime);
        Assert.Equal("2026-08-25T09:45:00Z", entry.EndTime);
        Assert.Equal("AUTO", entry.Source);
        Assert.Equal("p1", entry.ProjectId);
        Assert.Equal(1, store.Cleared);
    }

    /// <summary>
    /// Discard closes at the START, not the last heartbeat — a zero-duration row. Closing at
    /// LastAlive would keep the very time the user asked to throw away, and enqueuing nothing at all
    /// would strand the server's open row forever, permanently 409ing every future live entry for
    /// that user.
    /// </summary>
    [Fact]
    public void DiscardClosesTheSpanAtZeroDurationRatherThanDroppingIt()
    {
        var (recovery, buffer, store) = New(() => "user-1");

        recovery.Apply(AwayResolution.Discard, Span());

        var entry = Only(buffer);
        Assert.Equal("entry-1", entry.Id);
        Assert.Equal(entry.StartTime, entry.EndTime);
        Assert.Equal(1, store.Cleared);
    }

    /// <summary>
    /// The prompt is not modal and can outlive a sign-out. The check reads the user signed in NOW,
    /// not the one captured when the prompt was built, so a stale answer cannot bill one person's
    /// work to another (CLAUDE.md §1 — the buffer uploads by token).
    /// </summary>
    [Fact]
    public void ASpanBelongingToSomeoneElseIsDroppedNotEnqueued()
    {
        var (recovery, buffer, store) = New(() => "user-2");

        recovery.Apply(AwayResolution.Keep, Span("user-1"));

        Assert.Empty(buffer.Entries);
        Assert.Equal(1, store.Cleared); // still cleared locally
    }

    [Fact]
    public void ASpanIsCheckedAgainstWhoeverIsSignedInWhenTheChoiceIsMade()
    {
        var current = "user-1";
        var (recovery, buffer, _) = New(() => current);

        current = "user-2"; // signed out and back in while the prompt sat there
        recovery.Apply(AwayResolution.Keep, Span("user-1"));

        Assert.Empty(buffer.Entries);
    }
}

/// <summary>
/// <see cref="TimeTracker"/>'s side of the live-span contract. The tracker is the only writer, so
/// every exit from Tracking has to leave the record consistent.
/// </summary>
public class TimeTrackerLiveSpanTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private sealed class RecorderSpy : ILiveSpanRecorder
    {
        public List<string> Begun { get; } = [];

        public int Cleared { get; private set; }

        public void Begin(string entryId, DateTimeOffset startTime, TimeTracker.Selection selection, TimeTracker.EntrySource source) =>
            Begun.Add(entryId);

        public void Clear() => Cleared++;
    }

    private static (TimeTracker Tracker, RecorderSpy Live) New()
    {
        var live = new RecorderSpy();
        var n = 0;
        return (new TimeTracker(new BufferSpy(), () => T0, _ => $"entry-{++n}", live), live);
    }

    [Fact]
    public void StartingRecordsTheOpenSpan()
    {
        var (tracker, live) = New();

        tracker.Start("p1", null);

        Assert.Equal(["entry-1"], live.Begun);
        Assert.Equal(0, live.Cleared);
    }

    [Fact]
    public void StoppingClearsIt()
    {
        var (tracker, live) = New();
        tracker.Start("p1", null);

        tracker.Stop();

        Assert.Equal(1, live.Cleared);
    }

    [Fact]
    public void PausingClearsItAndResumingRecordsAgain()
    {
        var (tracker, live) = New();
        tracker.Start("p1", null);

        tracker.Pause();
        Assert.Equal(1, live.Cleared);

        tracker.Resume();
        Assert.Equal(["entry-1", "entry-2"], live.Begun);
    }

    /// <summary>
    /// Regression: abandoning is the one exit from Tracking that skips Close(), so it has to clear
    /// the record itself. Leaving it would resurrect the span the server just refused — the next
    /// launch offers to recover it and Keep enqueues time this machine was told it could not
    /// record, from a 409 that was supposed to be a no-op.
    /// </summary>
    [Fact]
    public void AbandoningAfterAConflictClearsTheRecord()
    {
        var (tracker, live) = New();
        tracker.Start("p1", null);
        var entryId = ((TrackerState.Tracking)tracker.State).EntryId;

        Assert.True(tracker.AbandonRunningSpan(entryId));

        Assert.Equal(1, live.Cleared);
    }

    /// <summary>A 409 for a span that has already been superseded must not clear the live one.</summary>
    [Fact]
    public void AStaleConflictLeavesTheRecordAlone()
    {
        var (tracker, live) = New();
        tracker.Start("p1", null);

        Assert.False(tracker.AbandonRunningSpan("entry-does-not-exist"));

        Assert.Equal(0, live.Cleared);
    }

    /// <summary>
    /// Bridge and recovery spans are already closed, so they must not touch the record — recovery
    /// in particular calls this while its own span is still on disk and clears it itself.
    /// </summary>
    [Fact]
    public void RecordingAClosedSpanDoesNotTouchTheRecord()
    {
        var (tracker, live) = New();

        tracker.RecordSpan(T0, T0.AddMinutes(10), "p1", null, TimeTracker.EntrySource.Auto);

        Assert.Empty(live.Begun);
        Assert.Equal(0, live.Cleared);
    }
}

/// <summary>Today's local tally for the S4 end-of-day summary. Never reaches the API.</summary>
public class DailyTotalAccumulatorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private static DailyTotalAccumulator New() => new(t => t); // treat UTC as local, deterministically

    [Fact]
    public void SumsSpansEndingOnTheSameDay()
    {
        var acc = New();

        acc.Add(T0, T0.AddMinutes(30));
        acc.Add(T0.AddHours(2), T0.AddHours(2).AddMinutes(15));

        Assert.Equal(45 * 60, acc.TodaySeconds(T0.AddHours(3)));
    }

    [Fact]
    public void ASpanEndingOnANewDayRollsTheTallyOver()
    {
        var acc = New();
        acc.Add(T0, T0.AddMinutes(30));

        var tomorrow = T0.AddDays(1);
        acc.Add(tomorrow, tomorrow.AddMinutes(10));

        Assert.Equal(10 * 60, acc.TodaySeconds(tomorrow));
    }

    [Fact]
    public void YesterdaysTallyIsNotTodays()
    {
        var acc = New();
        acc.Add(T0, T0.AddMinutes(30));

        Assert.Equal(0, acc.TodaySeconds(T0.AddDays(1)));
    }

    [Fact]
    public void AnInvertedSpanContributesNothingRatherThanANegative()
    {
        var acc = New();

        acc.Add(T0.AddMinutes(30), T0);

        Assert.Equal(0, acc.TodaySeconds(T0.AddMinutes(30)));
    }

    [Fact]
    public void ResetEmptiesTheTally()
    {
        var acc = New();
        acc.Add(T0, T0.AddMinutes(30));

        acc.Reset();

        Assert.Equal(0, acc.TodaySeconds(T0));
    }
}
