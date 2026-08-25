using System.Text;
using NiftyTimer.Capture;
using NiftyTimer.Policy;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using Xunit;

namespace NiftyTimer.Tests;

public class ScreenshotUploaderTests
{
    private static readonly CaptureGroup Group = new("group-1", 1, 2);

    private static string BodyText(byte[] body) => Encoding.UTF8.GetString(body);

    /// <summary>
    /// The multipart invariant, and the reason this body is hand-built rather than assembled with
    /// <c>MultipartFormDataContent</c>: <c>@fastify/multipart</c>'s <c>req.file()</c> only exposes
    /// fields parsed BEFORE the file part. A file-first body therefore arrives with undefined
    /// metadata and 422s every upload — which classifies as permanent, so the screenshot is
    /// dropped rather than retried, silently and forever.
    /// </summary>
    [Fact]
    public void EveryTextFieldPrecedesTheFilePart()
    {
        var body = BodyText(ScreenshotUploader.MultipartBody("B", "shot-1", "2026-08-25T09:00:00Z", Group, [1, 2, 3]));

        var file = body.IndexOf("name=\"file\"", StringComparison.Ordinal);
        Assert.True(file > 0, "the body must contain a file part");

        foreach (var field in new[] { "id", "timestamp", "captureGroupId", "displayIndex", "displayCount" })
        {
            var at = body.IndexOf($"name=\"{field}\"", StringComparison.Ordinal);
            Assert.True(at > 0, $"missing field {field}");
            Assert.True(at < file, $"field {field} must precede the file part");
        }
    }

    [Fact]
    public void TheIdComesFirstAndTheTimestampSecond()
    {
        var body = BodyText(ScreenshotUploader.MultipartBody("B", "shot-1", "2026-08-25T09:00:00Z", Group, [1]));

        Assert.True(
            body.IndexOf("name=\"id\"", StringComparison.Ordinal)
            < body.IndexOf("name=\"timestamp\"", StringComparison.Ordinal));
    }

    [Fact]
    public void TheGroupingFieldsCarryTheDisplayPosition()
    {
        var body = BodyText(ScreenshotUploader.MultipartBody("B", "shot-1", "2026-08-25T09:00:00Z", Group, [1]));

        Assert.Contains("name=\"captureGroupId\"\r\n\r\ngroup-1", body, StringComparison.Ordinal);
        Assert.Contains("name=\"displayIndex\"\r\n\r\n1", body, StringComparison.Ordinal);
        Assert.Contains("name=\"displayCount\"\r\n\r\n2", body, StringComparison.Ordinal);
    }

    /// <summary>The server attributes the upload to the bearer token; a userId field would be an
    /// unexpected extra at best and a spoofing vector at worst.</summary>
    [Fact]
    public void NoUserIdIsEverSent()
    {
        var body = BodyText(ScreenshotUploader.MultipartBody("B", "shot-1", "2026-08-25T09:00:00Z", Group, [1]));

        Assert.DoesNotContain("userId", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void TheImageBytesSurviveTheEncodingIntact()
    {
        byte[] jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        var body = ScreenshotUploader.MultipartBody("B", "shot-1", "2026-08-25T09:00:00Z", Group, jpeg);

        // The JPEG must appear verbatim — a text-encoding round trip would corrupt every image.
        var marker = Encoding.UTF8.GetBytes("image/jpeg\r\n\r\n");
        var start = IndexOf(body, marker) + marker.Length;
        Assert.Equal(jpeg, body.Skip(start).Take(jpeg.Length).ToArray());
    }

    [Fact]
    public void TheBodyIsTerminatedWithTheClosingBoundary()
    {
        var body = BodyText(ScreenshotUploader.MultipartBody("B", "shot-1", "2026-08-25T09:00:00Z", Group, [1]));

        Assert.EndsWith("\r\n--B--\r\n", body, StringComparison.Ordinal);
    }

    private static int IndexOf(byte[] haystack, byte[] needle)
    {
        for (var i = 0; i <= haystack.Length - needle.Length; i++)
        {
            var match = true;
            for (var j = 0; j < needle.Length; j++)
            {
                if (haystack[i + j] != needle[j])
                {
                    match = false;
                    break;
                }
            }

            if (match)
            {
                return i;
            }
        }

        return -1;
    }
}

public class DisplayOrderingTests
{
    private static WindowsDisplayGrabber.MonitorDescriptor Monitor(string name, bool primary = false) =>
        new(name, primary);

    /// <summary>
    /// The index has to mean the same physical monitor from one tick to the next, or the same
    /// screen shuffles position in the dashboard grid between captures. The OS enumeration order
    /// does not guarantee that, so the order is imposed here.
    /// </summary>
    [Fact]
    public void ThePrimaryDisplayComesFirstRegardlessOfEnumerationOrder()
    {
        var ordered = WindowsDisplayGrabber.Ordered(
        [
            Monitor(@"\\.\DISPLAY3"),
            Monitor(@"\\.\DISPLAY1"),
            Monitor(@"\\.\DISPLAY2", primary: true),
        ]);

        Assert.Equal(@"\\.\DISPLAY2", ordered[0].DeviceName);
        Assert.True(ordered[0].IsPrimary);
    }

    [Fact]
    public void TheRestFollowByDeviceNameSoTheOrderIsStable()
    {
        var ordered = WindowsDisplayGrabber.Ordered(
        [
            Monitor(@"\\.\DISPLAY3"),
            Monitor(@"\\.\DISPLAY1", primary: true),
            Monitor(@"\\.\DISPLAY2"),
        ]);

        Assert.Equal([@"\\.\DISPLAY1", @"\\.\DISPLAY2", @"\\.\DISPLAY3"], ordered.Select(m => m.DeviceName));
    }

    [Fact]
    public void TheSameSetInADifferentOrderProducesTheSameResult()
    {
        var a = WindowsDisplayGrabber.Ordered([Monitor("B"), Monitor("A", primary: true), Monitor("C")]);
        var b = WindowsDisplayGrabber.Ordered([Monitor("C"), Monitor("B"), Monitor("A", primary: true)]);

        Assert.Equal(a.Select(m => m.DeviceName), b.Select(m => m.DeviceName));
    }
}

public class ScreenshotSchedulerTests
{
    private static AckGate OpenGate() =>
        new(new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: false)));

    private static ScreenshotScheduler Build(
        AckGate gate,
        ImageBufferSpy buffer,
        IDisplayGrabber grabber,
        Func<bool>? isTracking = null)
    {
        var counter = 0;
        return new ScreenshotScheduler(
            gate,
            grabber,
            buffer,
            intervalMinutes: 10,
            isTracking ?? (() => true),
            idGen: _ => $"shot-{counter++}",
            groupIdGen: static _ => "group-1",
            clock: static () => DateTimeOffset.Parse("2026-08-25T09:00:00Z", null));
    }

    /// <summary>
    /// A two-monitor desk is one moment, not two unrelated screenshots. One tick, one capture
    /// time, one group id.
    /// </summary>
    [Fact]
    public async Task EveryDisplayIsCapturedUnderOneSharedGroup()
    {
        var buffer = new ImageBufferSpy();
        var scheduler = Build(OpenGate(), buffer, new FakeDisplayGrabber(displays: 2));

        Assert.True(await scheduler.CaptureTickAsync());

        Assert.Equal(2, buffer.Images.Count);
        Assert.All(buffer.Images, i => Assert.Equal("group-1", i.Group.Id));
        Assert.All(buffer.Images, i => Assert.Equal(DateTimeOffset.Parse("2026-08-25T09:00:00Z", null), i.CapturedAt));
        Assert.Equal([0, 1], buffer.Images.Select(i => i.Group.DisplayIndex));
        Assert.All(buffer.Images, i => Assert.Equal(2, i.Group.DisplayCount));
    }

    /// <summary>
    /// One flaky external monitor must not take the whole desk down. The shortfall between
    /// captures and <c>displayCount</c> is what tells the dashboard the group is incomplete.
    /// </summary>
    [Fact]
    public async Task APartialCaptureIsStillRecordedAndMarkedIncomplete()
    {
        var buffer = new ImageBufferSpy();
        var grabber = new FakeDisplayGrabber(() => new DisplayGrabResult([new DisplayCapture(0, [1])], Attempted: 3));
        var scheduler = Build(OpenGate(), buffer, grabber);

        Assert.True(await scheduler.CaptureTickAsync());

        var image = Assert.Single(buffer.Images);
        Assert.Equal(3, image.Group.DisplayCount); // three attached, one captured
    }

    /// <summary>Screenshots are tied to the clock — there are none when it is stopped, and a
    /// stopped clock must not even cost a policy fetch.</summary>
    [Fact]
    public async Task AStoppedClockCapturesNothingAndAsksNothing()
    {
        var provider = new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: false));
        var buffer = new ImageBufferSpy();
        var grabber = new FakeDisplayGrabber();
        var scheduler = Build(new AckGate(provider), buffer, grabber, isTracking: () => false);

        Assert.False(await scheduler.CaptureTickAsync());

        Assert.Empty(buffer.Images);
        Assert.Equal(0, provider.Calls);
        Assert.Equal(0, grabber.Calls);
    }

    [Fact]
    public async Task AClosedGateNeverReachesTheGrabber()
    {
        var buffer = new ImageBufferSpy();
        var grabber = new FakeDisplayGrabber();
        var gate = new AckGate(new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: true)));
        var scheduler = Build(gate, buffer, grabber);

        Assert.False(await scheduler.CaptureTickAsync());

        Assert.Equal(0, grabber.Calls);
        Assert.Empty(buffer.Images);
    }

    /// <summary>Revoking acknowledgement mid-session stops capture on the next tick, not at the
    /// next launch.</summary>
    [Fact]
    public async Task TheGateIsReCheckedOnEveryTick()
    {
        var acknowledged = true;
        var provider = new FakePolicyProvider(() => FakePolicyProvider.Policy(ackRequired: !acknowledged));
        var buffer = new ImageBufferSpy();
        var scheduler = Build(new AckGate(provider), buffer, new FakeDisplayGrabber(displays: 1));

        Assert.True(await scheduler.CaptureTickAsync());

        acknowledged = false;
        Assert.False(await scheduler.CaptureTickAsync());

        Assert.Single(buffer.Images);
    }

    /// <summary>A grabber that can capture nothing at all is a skipped tick, not a crash — the
    /// timer keeps running so capture resumes when a display comes back.</summary>
    [Fact]
    public async Task ATotalGrabFailureIsASkippedTick()
    {
        var buffer = new ImageBufferSpy();
        var grabber = new FakeDisplayGrabber(() => throw new DisplayGrabException(DisplayGrabFailure.NoDisplay));
        var scheduler = Build(OpenGate(), buffer, grabber);

        Assert.False(await scheduler.CaptureTickAsync());
        Assert.Empty(buffer.Images);
    }
}

public class ScreenshotSyncEngineTests
{
    private static ScreenshotSyncEngine Build(IImageBuffer buffer, IScreenshotUploading uploader) =>
        new(buffer, uploader, batchLimit: 20);

    [Fact]
    public async Task AConfirmedUploadRemovesTheLocalFile()
    {
        var uploader = new FakeScreenshotUploader(new UploadResult.Success());

        // Driven through a REAL store rather than the spy: the drain reads the image off disk, so
        // a spy handing back a path that does not exist would exercise only the unreadable-file
        // branch and never the upload it is meant to be testing.
        using var temp = new TempDirectory();
        var store = new ImageBufferStore(temp.Path);
        store.Enqueue("shot-1", DateTimeOffset.UtcNow, [1, 2, 3], new CaptureGroup("g", 0, 1));

        using var engine = Build(store, uploader);
        Assert.False(await engine.SyncNowAsync());

        Assert.Equal(["shot-1"], uploader.Uploaded);
        Assert.Equal(0, store.PendingCount());
    }

    /// <summary>
    /// PRD §6.2 — the local file survives anything short of a confirmed upload. Deleting on send
    /// would lose exactly the captures whose response went missing.
    /// </summary>
    [Fact]
    public async Task ATransientFailureKeepsTheImageForTheNextCycle()
    {
        using var temp = new TempDirectory();
        var store = new ImageBufferStore(temp.Path);
        store.Enqueue("shot-1", DateTimeOffset.UtcNow, [1], new CaptureGroup("g", 0, 1));

        var uploader = new FakeScreenshotUploader(new UploadResult.Transient());
        using var engine = Build(store, uploader);

        Assert.True(await engine.SyncNowAsync()); // backed off
        Assert.Equal(1, store.PendingCount());
    }

    /// <summary>A record the server will never accept is dropped, so it cannot wedge every
    /// screenshot queued behind it.</summary>
    [Fact]
    public async Task APermanentRejectionDropsTheImageRatherThanWedgingTheQueue()
    {
        using var temp = new TempDirectory();
        var store = new ImageBufferStore(temp.Path);
        store.Enqueue("poison", DateTimeOffset.UtcNow, [1], new CaptureGroup("g", 0, 1));
        store.Enqueue("good", DateTimeOffset.UtcNow.AddSeconds(1), [1], new CaptureGroup("g", 0, 1));

        var uploader = new FakeScreenshotUploader(new UploadResult.Permanent(422), new UploadResult.Success());
        using var engine = Build(store, uploader);

        Assert.False(await engine.SyncNowAsync());

        Assert.Equal(["poison", "good"], uploader.Uploaded);
        Assert.Equal(0, store.PendingCount());
    }
}

public class ActivityBatchSyncEngineTests
{
    private static ActivitySamplePayload Sample(string id) => new()
    {
        Id = id,
        Timestamp = "2026-08-25T09:00:00Z",
        AppName = "Code",
        BundleId = "code",
        WindowTitle = null,
        ActivityPct = 50,
        Category = "NEUTRAL",
    };

    [Fact]
    public async Task TheWholeBatchGoesInOneRequestAndIsRemovedOnSuccess()
    {
        var store = new ActivityBufferSpy();
        store.Enqueue(Sample("a"));
        store.Enqueue(Sample("b"));
        var uploader = new FakeUploader(new UploadResult.Success());

        using var engine = new ActivityBatchSyncEngine(store, uploader);
        Assert.False(await engine.SyncNowAsync());

        Assert.Single(uploader.Uploads);
        Assert.Equal(["a", "b"], store.Removed);
        Assert.Empty(store.Samples);
    }

    /// <summary>
    /// Exactly one batch per cycle. Looping until empty would mean that if a delete ever failed,
    /// the same samples would be re-taken and re-sent immediately, in a tight loop, for as long as
    /// the delete kept failing.
    /// </summary>
    [Fact]
    public async Task OnlyOneBatchIsSentPerCycle()
    {
        var store = new ActivityBufferSpy();
        for (var i = 0; i < 5; i++)
        {
            store.Enqueue(Sample($"s{i}"));
        }

        var uploader = new FakeUploader();
        using var engine = new ActivityBatchSyncEngine(store, uploader, batchLimit: 2);

        await engine.SyncNowAsync();

        Assert.Single(uploader.Uploads);
        Assert.Equal(3, store.Samples.Count);
    }

    /// <summary>The server rejects an empty samples array (min 1), so there is nothing to send.</summary>
    [Fact]
    public async Task AnEmptyBufferSendsNothing()
    {
        var uploader = new FakeUploader();
        using var engine = new ActivityBatchSyncEngine(new ActivityBufferSpy(), uploader);

        Assert.False(await engine.SyncNowAsync());
        Assert.Empty(uploader.Uploads);
    }

    [Fact]
    public async Task ATransientFailureKeepsTheBatch()
    {
        var store = new ActivityBufferSpy();
        store.Enqueue(Sample("a"));
        var uploader = new FakeUploader(new UploadResult.Transient());

        using var engine = new ActivityBatchSyncEngine(store, uploader);

        Assert.True(await engine.SyncNowAsync());
        Assert.Single(store.Samples);
    }

    /// <summary>
    /// The batch limit is clamped to the server's maximum. A caller asking for 900 would otherwise
    /// build a body the API rejects outright — and that rejection is permanent, so every sample in
    /// it would be discarded.
    /// </summary>
    [Fact]
    public async Task TheBatchLimitCannotExceedTheServerMaximum()
    {
        var store = new ActivityBufferSpy();
        for (var i = 0; i < ActivityBatchSyncEngine.MaxBatchSize + 10; i++)
        {
            store.Enqueue(Sample($"s{i}"));
        }

        var uploader = new FakeUploader();
        using var engine = new ActivityBatchSyncEngine(store, uploader, batchLimit: 5000);

        await engine.SyncNowAsync();

        Assert.Equal(ActivityBatchSyncEngine.MaxBatchSize, store.Removed.Count);
    }
}
