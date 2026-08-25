using System.Text;
using System.Text.Json;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using Xunit;

namespace NiftyTimer.Tests;

public class ImageBufferStoreTests
{
    private static readonly CaptureGroup Group = new("0192f000-0000-7000-8000-00000000000a", 1, 2);

    private static DateTimeOffset At(int minute) =>
        DateTimeOffset.Parse("2026-08-25T09:00:00Z", null).AddMinutes(minute);

    [Fact]
    public void AnEnqueuedImageComesBackWithItsIdentityAndGrouping()
    {
        using var temp = new TempDirectory();
        var store = new ImageBufferStore(temp.Path);

        store.Enqueue("shot-1", At(0), [1, 2, 3], Group);

        var record = Assert.Single(store.Take(10));
        Assert.Equal("shot-1", record.Id);
        Assert.Equal(At(0), record.CapturedAt);
        Assert.Equal(Group, record.Group);
        Assert.Equal([1, 2, 3], File.ReadAllBytes(record.Path));
    }

    /// <summary>
    /// The capture time is stamped once, into the filename, and reused verbatim on every retry.
    /// It is half the server's composite primary key <c>[id, timestamp]</c> AND its monthly
    /// partition key, so a retry that recomputed "now" would land in a different partition under a
    /// different key — duplicating the row instead of upserting it.
    /// </summary>
    [Fact]
    public void TheCaptureTimeSurvivesARoundTripThroughTheFilename()
    {
        using var temp = new TempDirectory();
        var store = new ImageBufferStore(temp.Path);
        var captured = At(0);

        store.Enqueue("shot-1", captured, [1], Group);

        Assert.Equal(captured, store.Take(1)[0].CapturedAt);
        Assert.Equal(captured, store.Take(1)[0].CapturedAt); // and again — it is not "now"
    }

    [Fact]
    public void RecordsComeBackOldestFirst()
    {
        using var temp = new TempDirectory();
        var store = new ImageBufferStore(temp.Path);

        store.Enqueue("third", At(2), [1], Group);
        store.Enqueue("first", At(0), [1], Group);
        store.Enqueue("second", At(1), [1], Group);

        Assert.Equal(["first", "second", "third"], store.Take(10).Select(r => r.Id));
    }

    [Fact]
    public void RemovingTakesTheFileWithIt()
    {
        using var temp = new TempDirectory();
        var store = new ImageBufferStore(temp.Path);
        store.Enqueue("shot-1", At(0), [1], Group);

        store.Remove("shot-1");

        Assert.Equal(0, store.PendingCount());
        Assert.Empty(Directory.GetFiles(temp.Path));
    }

    /// <summary>A crash between the write and the rename leaves a <c>.tmp-</c> file; it must not
    /// be mistaken for a record, and it must not accumulate.</summary>
    [Fact]
    public void LeftoverTemporariesAreSweptOnConstruction()
    {
        using var temp = new TempDirectory();
        File.WriteAllBytes(temp.File(".tmp-interrupted"), [1, 2]);

        var store = new ImageBufferStore(temp.Path);

        Assert.Equal(0, store.PendingCount());
        Assert.Empty(Directory.GetFiles(temp.Path));
    }

    [Fact]
    public void PruningDropsImagesOlderThanTheAgeBound()
    {
        using var temp = new TempDirectory();
        var now = At(0);
        var store = new ImageBufferStore(temp.Path, () => now);

        store.Enqueue("stale", now.AddDays(-8), [1], Group);
        store.Enqueue("fresh", now.AddHours(-1), [1], Group);

        store.Prune(TimeSpan.FromDays(7), maxCount: 100);

        Assert.Equal(["fresh"], store.Take(10).Select(r => r.Id));
    }

    /// <summary>
    /// Images are large, so this buffer is capped by count as well as by age — a week of unsent
    /// captures from a laptop that has been offline is measured in gigabytes.
    /// </summary>
    [Fact]
    public void PruningTrimsTheOldestBeyondTheCountBound()
    {
        using var temp = new TempDirectory();
        var now = At(0);
        var store = new ImageBufferStore(temp.Path, () => now);

        for (var i = 0; i < 5; i++)
        {
            store.Enqueue($"shot-{i}", now.AddMinutes(i), [1], Group);
        }

        store.Prune(TimeSpan.FromDays(7), maxCount: 2);

        Assert.Equal(["shot-3", "shot-4"], store.Take(10).Select(r => r.Id));
    }

    [Fact]
    public void AFileThatDoesNotMatchTheNamingSchemeIsIgnored()
    {
        using var temp = new TempDirectory();
        File.WriteAllText(temp.File("notes.txt"), "hello");
        File.WriteAllBytes(temp.File("garbage.jpg"), [1]);

        var store = new ImageBufferStore(temp.Path);

        Assert.Equal(0, store.PendingCount());
    }

    [Fact]
    public void TheFilenameCarriesEveryComponent()
    {
        var name = ImageBufferStore.FileName(1_700_000_000_000, "shot-1", Group);

        Assert.Equal($"1700000000000__shot-1__{Group.Id}__1__2.jpg", name);
    }
}

public class ActivitySampleStoreTests
{
    private static ActivitySamplePayload Sample(string id, string? title = null) => new()
    {
        Id = id,
        Timestamp = "2026-08-25T09:00:00Z",
        AppName = "Visual Studio Code",
        BundleId = "code",
        WindowTitle = title,
        ActivityPct = 75,
        Category = "PRODUCTIVE",
    };

    [Fact]
    public void AnEnqueuedSampleRoundTripsIntact()
    {
        using var temp = new TempDirectory();
        var store = new ActivitySampleStore(temp.Path);

        store.Enqueue(Sample("a", "README.md"));

        var back = Assert.Single(store.Take(10));
        Assert.Equal("a", back.Id);
        Assert.Equal("Visual Studio Code", back.AppName);
        Assert.Equal("code", back.BundleId);
        Assert.Equal("README.md", back.WindowTitle);
        Assert.Equal(75, back.ActivityPct);
        Assert.Equal("PRODUCTIVE", back.Category);
    }

    [Fact]
    public void SamplesComeBackOldestFirst()
    {
        using var temp = new TempDirectory();
        var tick = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var store = new ActivitySampleStore(temp.Path, () => tick);

        store.Enqueue(Sample("first"));
        tick = tick.AddMinutes(1);
        store.Enqueue(Sample("second"));
        tick = tick.AddMinutes(1);
        store.Enqueue(Sample("third"));

        Assert.Equal(["first", "second", "third"], store.Take(10).Select(s => s.Id));
    }

    [Fact]
    public void TakeRespectsItsLimit()
    {
        using var temp = new TempDirectory();
        var tick = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var store = new ActivitySampleStore(temp.Path, () => tick);

        for (var i = 0; i < 10; i++)
        {
            store.Enqueue(Sample($"s{i}"));
            tick = tick.AddSeconds(1);
        }

        Assert.Equal(3, store.Take(3).Count);
    }

    /// <summary>The batch drain removes the whole batch by id after one successful POST.</summary>
    [Fact]
    public void RemovingABatchClearsExactlyThoseSamples()
    {
        using var temp = new TempDirectory();
        var tick = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var store = new ActivitySampleStore(temp.Path, () => tick);

        foreach (var id in new[] { "a", "b", "c" })
        {
            store.Enqueue(Sample(id));
            tick = tick.AddSeconds(1);
        }

        store.Remove(["a", "c"]);

        Assert.Equal(["b"], store.Take(10).Select(s => s.Id));
    }

    [Fact]
    public void LeftoverTemporariesAreSweptOnConstruction()
    {
        using var temp = new TempDirectory();
        File.WriteAllText(temp.File(".tmp-interrupted"), "{}");

        var store = new ActivitySampleStore(temp.Path);

        Assert.Equal(0, store.PendingCount());
    }

    [Fact]
    public void PruningIsAgeBoundThenCountBound()
    {
        using var temp = new TempDirectory();
        var now = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var tick = now.AddDays(-8);
        var store = new ActivitySampleStore(temp.Path, () => tick);

        store.Enqueue(Sample("stale"));
        tick = now.AddMinutes(-3);
        store.Enqueue(Sample("old"));
        tick = now.AddMinutes(-2);
        store.Enqueue(Sample("newer"));
        tick = now;

        store.Prune(TimeSpan.FromDays(7), maxCount: 1);

        Assert.Equal(["newer"], store.Take(10).Select(s => s.Id));
    }

    /// <summary>
    /// A corrupt record is skipped rather than deleted: pruning already bounds the buffer, and
    /// deleting on a read error would discard a sample a retry might still recover.
    /// </summary>
    [Fact]
    public void ACorruptRecordIsSkippedWithoutTakingTheBatchDown()
    {
        using var temp = new TempDirectory();
        var tick = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);
        var store = new ActivitySampleStore(temp.Path, () => tick);

        store.Enqueue(Sample("good"));
        File.WriteAllText(Path.Combine(temp.Path, "1700000000000__corrupt.json"), "{ not json");

        Assert.Equal(["good"], store.Take(10).Select(s => s.Id));
    }
}

/// <summary>
/// The null rules for the activity body. The hazard here is the mirror image of the Swift
/// client's: System.Text.Json writes nulls by default, so what would break this is somebody adding
/// a blanket <c>WhenWritingNull</c> ignore condition — after which <c>windowTitle</c> silently
/// stops being sent and every batch 422s.
/// </summary>
public class ActivitySamplePayloadTests
{
    private static string Serialize(ActivitySamplePayload payload) =>
        Encoding.UTF8.GetString(new ActivityBatchPayload { Samples = [payload] }.ToJsonUtf8());

    private static ActivitySamplePayload Payload(string? bundleId = "code", string? title = "README.md") => new()
    {
        Id = "0192f000-0000-7000-8000-000000000000",
        Timestamp = "2026-08-25T09:00:00Z",
        AppName = "Visual Studio Code",
        BundleId = bundleId,
        WindowTitle = title,
        ActivityPct = 75,
        Category = "PRODUCTIVE",
    };

    /// <summary>
    /// <c>windowTitle</c> is <c>.nullable()</c> but NOT <c>.optional()</c>, so the key must be
    /// present. Omitting it is a 422 on every sample of every team that has opted out of titles.
    /// </summary>
    [Fact]
    public void AnAbsentWindowTitleIsAnExplicitNullNotAnOmission()
    {
        var json = Serialize(Payload(title: null));
        var sample = JsonDocument.Parse(json).RootElement.GetProperty("samples")[0];

        Assert.True(sample.TryGetProperty("windowTitle", out var title));
        Assert.Equal(JsonValueKind.Null, title.ValueKind);
    }

    [Fact]
    public void AnAbsentBundleIdIsAlsoAnExplicitNull()
    {
        var json = Serialize(Payload(bundleId: null));
        var sample = JsonDocument.Parse(json).RootElement.GetProperty("samples")[0];

        Assert.True(sample.TryGetProperty("bundleId", out var bundle));
        Assert.Equal(JsonValueKind.Null, bundle.ValueKind);
    }

    /// <summary>
    /// Bodies parse in Zod strict mode, so an unexpected field is a 422 — and a 422 classifies as
    /// permanent, so the whole batch is dropped rather than retried. No helpful
    /// <c>platform</c>/<c>deviceId</c>, and in particular no URL or host: those never leave the
    /// device.
    /// </summary>
    [Fact]
    public void SendsExactlyTheFieldsTheSchemaDefines()
    {
        var json = Serialize(Payload());
        var keys = JsonDocument.Parse(json).RootElement.GetProperty("samples")[0]
            .EnumerateObject()
            .Select(p => p.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            ["activityPct", "appName", "bundleId", "category", "id", "timestamp", "windowTitle"],
            keys);
    }

    [Fact]
    public void TheBatchIsWrappedInASamplesArray()
    {
        var keys = JsonDocument.Parse(Serialize(Payload())).RootElement
            .EnumerateObject()
            .Select(p => p.Name)
            .ToArray();

        Assert.Equal(["samples"], keys);
    }

    [Fact]
    public void TheCategoryTravelsAsAnUppercaseToken()
    {
        var json = Serialize(Payload());
        var sample = JsonDocument.Parse(json).RootElement.GetProperty("samples")[0];

        Assert.Equal("PRODUCTIVE", sample.GetProperty("category").GetString());
    }
}
