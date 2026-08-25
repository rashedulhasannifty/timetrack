using System.Text;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using Xunit;

namespace NiftyTimer.Tests;

public class BufferStoreTests : IDisposable
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private readonly TempDirectory _dir = new();
    private DateTimeOffset _now = T0;

    private BufferStore NewStore() => new(_dir.File("buffer"), () => _now);

    private static byte[] Payload(string s) => Encoding.UTF8.GetBytes(s);

    public void Dispose() => _dir.Dispose();

    [Fact]
    public void EnqueuedRecordsComeBackInFifoOrder()
    {
        var store = NewStore();

        store.Enqueue("a", BufferKind.TimeEntry, Payload("1"));
        _now = T0.AddSeconds(1);
        store.Enqueue("b", BufferKind.TimeEntry, Payload("2"));
        _now = T0.AddSeconds(2);
        store.Enqueue("c", BufferKind.TimeEntry, Payload("3"));

        var taken = store.Take(BufferKind.TimeEntry, 10);
        Assert.Equal(["a", "b", "c"], taken.Select(t => t.Id));
        Assert.Equal("1", Encoding.UTF8.GetString(taken[0].Payload));
    }

    [Fact]
    public void TakeRoutesByKind()
    {
        var store = NewStore();

        store.Enqueue("a", BufferKind.TimeEntry, Payload("entry"));
        store.Enqueue("b", BufferKind.IdleEvent, Payload("idle"));

        Assert.Equal(["a"], store.Take(BufferKind.TimeEntry, 10).Select(t => t.Id));
        Assert.Equal(["b"], store.Take(BufferKind.IdleEvent, 10).Select(t => t.Id));
    }

    [Fact]
    public void TakeRespectsTheLimit()
    {
        var store = NewStore();
        for (var i = 0; i < 10; i++)
        {
            _now = T0.AddSeconds(i);
            store.Enqueue($"id-{i}", BufferKind.TimeEntry, Payload("x"));
        }

        Assert.Equal(3, store.Take(BufferKind.TimeEntry, 3).Count);
    }

    [Fact]
    public void RemoveDropsTheRecord()
    {
        var store = NewStore();
        store.Enqueue("a", BufferKind.TimeEntry, Payload("x"));

        store.Remove("a");

        Assert.Empty(store.Take(BufferKind.TimeEntry, 10));
        Assert.Equal(0, store.PendingCount());
    }

    [Fact]
    public void PruneDropsOnlyRecordsOlderThanTheCutoff()
    {
        var store = NewStore();
        store.Enqueue("old", BufferKind.TimeEntry, Payload("x"));
        _now = T0.AddDays(8);
        store.Enqueue("fresh", BufferKind.TimeEntry, Payload("x"));

        store.Prune(TimeSpan.FromDays(7));

        Assert.Equal(["fresh"], store.Take(BufferKind.TimeEntry, 10).Select(t => t.Id));
    }

    [Fact]
    public void PendingCountSpansBothKinds()
    {
        var store = NewStore();
        store.Enqueue("a", BufferKind.TimeEntry, Payload("x"));
        store.Enqueue("b", BufferKind.IdleEvent, Payload("x"));

        Assert.Equal(2, store.PendingCount());
    }

    [Fact]
    public void ClearEmptiesEverything()
    {
        var store = NewStore();
        store.Enqueue("a", BufferKind.TimeEntry, Payload("x"));
        store.Enqueue("b", BufferKind.IdleEvent, Payload("x"));

        store.Clear();

        Assert.Equal(0, store.PendingCount());
    }

    [Fact]
    public void RecordsSurviveARestart()
    {
        var store = NewStore();
        store.Enqueue("a", BufferKind.TimeEntry, Payload("durable"));

        var reopened = NewStore();

        var taken = Assert.Single(reopened.Take(BufferKind.TimeEntry, 10));
        Assert.Equal("durable", Encoding.UTF8.GetString(taken.Payload));
    }

    /// <summary>
    /// A crash between the temp write and the rename leaves a <c>.tmp-*</c> file. It must be swept
    /// at startup rather than accumulating forever — and it must never be mistaken for a record.
    /// </summary>
    [Fact]
    public void StartupSweepsTemporariesLeftByACrash()
    {
        var dir = _dir.File("buffer");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, ".tmp-orphan"), "half-written");

        var store = NewStore();

        Assert.Equal(0, store.PendingCount());
        Assert.False(File.Exists(Path.Combine(dir, ".tmp-orphan")));
    }

    [Fact]
    public void UnrecognisedFilesAreIgnoredRatherThanCrashingADrain()
    {
        var dir = _dir.File("buffer");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "not-a-record.txt"), "junk");
        File.WriteAllText(Path.Combine(dir, "missing__parts.json"), "junk");

        var store = NewStore();
        store.Enqueue("a", BufferKind.TimeEntry, Payload("x"));

        Assert.Equal(1, store.PendingCount());
    }
}

public class SyncEngineTests : IDisposable
{
    private readonly TempDirectory _dir = new();

    private BufferStore NewBuffer() => new(_dir.File("buffer"));

    public void Dispose() => _dir.Dispose();

    private static byte[] Payload(string s) => Encoding.UTF8.GetBytes(s);

    [Fact]
    public async Task DrainsBothKindsAndRemovesWhatSucceeded()
    {
        var buffer = NewBuffer();
        buffer.Enqueue("e1", BufferKind.TimeEntry, Payload("entry"));
        buffer.Enqueue("i1", BufferKind.IdleEvent, Payload("idle"));

        var entries = new FakeUploader();
        var idle = new FakeUploader();
        var engine = new SyncEngine(buffer, entries, idle);

        var backedOff = await engine.SyncNowAsync();

        Assert.False(backedOff);
        Assert.Single(entries.Uploads);
        Assert.Single(idle.Uploads);
        Assert.Equal(0, buffer.PendingCount());
    }

    /// <summary>
    /// A transient failure on time entries stops the WHOLE cycle: the session is likely unusable,
    /// so the idle pass would fail too and would only burn requests against the API's flat
    /// per-IP rate limit.
    /// </summary>
    [Fact]
    public async Task ATransientTimeEntryFailureSkipsTheIdlePass()
    {
        var buffer = NewBuffer();
        buffer.Enqueue("e1", BufferKind.TimeEntry, Payload("entry"));
        buffer.Enqueue("i1", BufferKind.IdleEvent, Payload("idle"));

        var entries = new FakeUploader { Default = new UploadResult.Transient() };
        var idle = new FakeUploader();
        var engine = new SyncEngine(buffer, entries, idle);

        var backedOff = await engine.SyncNowAsync();

        Assert.True(backedOff);
        Assert.Empty(idle.Uploads);
        Assert.Equal(2, buffer.PendingCount()); // nothing lost
    }

    [Fact]
    public async Task ATransientFailureKeepsTheRecordForTheNextCycle()
    {
        var buffer = NewBuffer();
        buffer.Enqueue("e1", BufferKind.TimeEntry, Payload("entry"));

        var entries = new FakeUploader(new UploadResult.Transient());
        var engine = new SyncEngine(buffer, entries, new FakeUploader());

        await engine.SyncNowAsync();
        Assert.Equal(1, buffer.PendingCount());

        await engine.SyncNowAsync(); // scripted result exhausted → Success
        Assert.Equal(0, buffer.PendingCount());
    }

    /// <summary>
    /// A permanent 4xx record is DROPPED. A record the server will never accept, retried forever,
    /// wedges the queue behind it and stops every later record from ever syncing.
    /// </summary>
    [Fact]
    public async Task APoisonRecordIsDroppedRatherThanWedgingTheQueue()
    {
        var buffer = NewBuffer();
        buffer.Enqueue("poison", BufferKind.TimeEntry, Payload("bad"));

        var entries = new FakeUploader { Default = new UploadResult.Permanent(422) };
        var engine = new SyncEngine(buffer, entries, new FakeUploader());

        var backedOff = await engine.SyncNowAsync();

        Assert.False(backedOff);
        Assert.Equal(0, buffer.PendingCount());
    }

    [Fact]
    public async Task AnAuthFailureStopsTheCycleAndKeepsTheRecord()
    {
        var buffer = NewBuffer();
        buffer.Enqueue("e1", BufferKind.TimeEntry, Payload("entry"));

        var entries = new FakeUploader { Default = new UploadResult.AuthFailed() };
        var engine = new SyncEngine(buffer, entries, new FakeUploader());

        Assert.True(await engine.SyncNowAsync());
        Assert.Equal(1, buffer.PendingCount());
    }

    [Fact]
    public async Task PrunesStaleRecordsEveryCycle()
    {
        var now = new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);
        var buffer = new BufferStore(_dir.File("buffer"), () => now);
        buffer.Enqueue("ancient", BufferKind.TimeEntry, Payload("x"));

        now = now.AddDays(30);

        var entries = new FakeUploader();
        var engine = new SyncEngine(buffer, entries, new FakeUploader(), maxAge: TimeSpan.FromDays(7));

        await engine.SyncNowAsync();

        Assert.Empty(entries.Uploads); // pruned before it was ever attempted
        Assert.Equal(0, buffer.PendingCount());
    }

    /// <summary>
    /// Sign-out clears the buffer right after its "final drain", and <c>CreateTimeEntry</c> carries
    /// no userId — the server attributes by token — so anything left behind would upload as the
    /// NEXT person's time. A drain that silently skipped because a cycle was in flight would
    /// therefore discard real tracked time, which is why sign-out waits rather than skips.
    /// </summary>
    [Fact]
    public async Task FlushWaitsForAnInFlightCycleInsteadOfSkipping()
    {
        var buffer = NewBuffer();
        buffer.Enqueue("e1", BufferKind.TimeEntry, Payload("entry"));

        var release = new TaskCompletionSource();
        var slow = new BlockingUploader(release.Task);
        var engine = new SyncEngine(buffer, slow, new FakeUploader());

        var cycle = engine.SyncNowAsync();
        await slow.Entered;

        // A second timer tick during a cycle is dropped...
        Assert.False(await engine.SyncNowAsync());

        // ...but sign-out's flush must not be.
        var flush = engine.FlushAsync();
        release.SetResult();
        await cycle;
        await flush;

        Assert.Equal(0, buffer.PendingCount());
    }

    [Fact]
    public async Task RespectsTheBatchLimit()
    {
        var buffer = NewBuffer();
        for (var i = 0; i < 10; i++)
        {
            buffer.Enqueue($"e{i}", BufferKind.TimeEntry, Payload("x"));
        }

        var entries = new FakeUploader();
        var engine = new SyncEngine(buffer, entries, new FakeUploader(), batchLimit: 4);

        await engine.SyncNowAsync();

        Assert.Equal(4, entries.Uploads.Count);
        Assert.Equal(6, buffer.PendingCount());
    }
}

public class BackoffPolicyTests
{
    [Fact]
    public void DoublesFromTheBaseAndCapsAtTheMaximum()
    {
        var policy = new BackoffPolicy(
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(300),
            jitter: d => d);

        Assert.Equal(5, policy.NextDelay().TotalSeconds);
        Assert.Equal(10, policy.NextDelay().TotalSeconds);
        Assert.Equal(20, policy.NextDelay().TotalSeconds);
        Assert.Equal(40, policy.NextDelay().TotalSeconds);
    }

    [Fact]
    public void NeverExceedsTheCap()
    {
        var policy = new BackoffPolicy(
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(60),
            jitter: d => d);

        for (var i = 0; i < 20; i++)
        {
            Assert.True(policy.NextDelay().TotalSeconds <= 60);
        }
    }

    [Fact]
    public void ResetReturnsToTheBase()
    {
        var policy = new BackoffPolicy(TimeSpan.FromSeconds(5), jitter: d => d);
        policy.NextDelay();
        policy.NextDelay();

        policy.Reset();

        Assert.Equal(0, policy.FailureCount);
        Assert.Equal(5, policy.NextDelay().TotalSeconds);
    }

    /// <summary>
    /// The API's throttler is a flat 100 req/min keyed on the request IP, shared by every client
    /// behind one office NAT, and a 429 classifies as transient. Without jitter the whole office
    /// retries on the same tick and re-trips the limit together — which is why, unlike the Swift
    /// original, the DEFAULT here is randomized rather than the identity function.
    /// </summary>
    [Fact]
    public void TheDefaultJitterActuallyVaries()
    {
        var observed = new HashSet<double>();
        for (var i = 0; i < 50; i++)
        {
            var policy = new BackoffPolicy(TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(300));
            observed.Add(policy.NextDelay().TotalSeconds);
        }

        Assert.True(observed.Count > 1, "the default backoff must not be deterministic");
    }

    [Fact]
    public void DefaultJitterStaysWithinTwentyFivePercentAndIsNeverNegative()
    {
        for (var i = 0; i < 200; i++)
        {
            var delay = BackoffPolicy.DefaultJitter(TimeSpan.FromSeconds(40)).TotalSeconds;
            Assert.InRange(delay, 30, 50);
        }
    }
}
