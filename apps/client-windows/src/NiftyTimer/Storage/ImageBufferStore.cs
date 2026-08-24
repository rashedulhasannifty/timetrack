using System.Globalization;

namespace NiftyTimer.Storage;

/// <summary>
/// Which tick a buffered capture belongs to, and where it sat within that tick. Stamped on every
/// screenshot so the dashboard can show a multi-monitor desk as one moment rather than as
/// unrelated images.
///
/// <c>DisplayIndex</c> and <c>DisplayCount</c> are bounded by the server schema
/// (<c>displayIndex</c> 0–15, <c>displayCount</c> 1–16). Exceeding either is a 422, which
/// classifies as permanent — the capture would be dropped rather than retried — so the grabber
/// caps the number of displays it reports rather than letting an unusual desk silently lose its
/// screenshots.
/// </summary>
public sealed record CaptureGroup(string Id, int DisplayIndex, int DisplayCount)
{
    /// <summary>Server bound: <c>displayCount: z.coerce.number().int().min(1).max(16)</c>.</summary>
    public const int MaxDisplays = 16;
}

/// <summary>One buffered capture, identified without opening the file.</summary>
public sealed record BufferedImage(string Id, DateTimeOffset CapturedAt, CaptureGroup Group, string Path);

/// <summary>The image-buffer seam. Tests substitute a spy.</summary>
public interface IImageBuffer
{
    void Enqueue(string id, DateTimeOffset capturedAt, byte[] jpeg, CaptureGroup group);

    IReadOnlyList<BufferedImage> Take(int limit);

    void Remove(string id);

    void Prune(TimeSpan maxAge, int maxCount);

    void Clear();

    int PendingCount();
}

/// <summary>
/// PRD §6.2 / §7.4 — durable, file-backed buffer for captured screenshots.
///
/// Same durability model as <see cref="BufferStore"/> (one file per record, write-then-rename,
/// startup sweep of <c>.tmp-*</c>) but it holds raw JPEG bytes rather than JSON, because
/// screenshots upload as binary multipart through their own uploader and engine.
///
/// The filename
/// <c>&lt;capturedAtMillis&gt;__&lt;id&gt;__&lt;groupId&gt;__&lt;displayIndex&gt;__&lt;displayCount&gt;.jpg</c>
/// carries FIFO order, the server <c>id</c>, the capture time and the whole display grouping — so
/// none of it needs the file to be read, and in particular the capture time is stamped ONCE and
/// reused verbatim on every retry. That matters more than it looks: <c>timestamp</c> is half the
/// server's composite primary key <c>[id, timestamp]</c> and also its monthly partition key, so a
/// retry that recomputed "now" would land in a different partition under a different key and
/// duplicate the row instead of upserting it.
///
/// A UUID contains no <c>__</c>, so the five components can never be ambiguous.
///
/// Not a capture path — it stores what capture already produced — so it takes no gate and lives
/// in <c>NiftyTimer.Storage</c>.
/// </summary>
public sealed class ImageBufferStore : IImageBuffer
{
    private readonly string _directory;
    private readonly Func<DateTimeOffset> _clock;

    public ImageBufferStore(string directory, Func<DateTimeOffset>? clock = null)
    {
        _directory = directory;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        Directory.CreateDirectory(directory);
        SweepTemporaries();
    }

    public void Enqueue(string id, DateTimeOffset capturedAt, byte[] jpeg, CaptureGroup group)
    {
        var millis = capturedAt.ToUnixTimeMilliseconds();
        var dst = Path.Combine(_directory, FileName(millis, id, group));
        var tmp = Path.Combine(_directory, $".tmp-{id}");
        try
        {
            File.WriteAllBytes(tmp, jpeg);
            File.Move(tmp, dst, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            TryDelete(tmp);
        }
    }

    /// <summary>
    /// FIFO (capture time ascending), up to <paramref name="limit"/>. Returns paths — the caller
    /// reads the bytes lazily, so listing the buffer for the menu's pending count never touches
    /// a single image.
    /// </summary>
    public IReadOnlyList<BufferedImage> Take(int limit)
    {
        var result = new List<BufferedImage>();
        foreach (var rec in AllRecords())
        {
            if (result.Count >= limit)
            {
                break;
            }

            result.Add(new BufferedImage(
                rec.Id,
                DateTimeOffset.FromUnixTimeMilliseconds(rec.CapturedAtMillis),
                rec.Group,
                rec.Path));
        }

        return result;
    }

    public void Remove(string id)
    {
        foreach (var rec in AllRecords())
        {
            if (rec.Id == id)
            {
                TryDelete(rec.Path);
            }
        }
    }

    /// <summary>
    /// Age-bound then count-bound. Unlike the JSON buffers this one is also capped by count,
    /// because a week of unsent screenshots from a laptop that has been offline is measured in
    /// gigabytes, not kilobytes.
    /// </summary>
    public void Prune(TimeSpan maxAge, int maxCount)
    {
        var cutoff = _clock().Subtract(maxAge).ToUnixTimeMilliseconds();
        var surviving = new List<Record>();
        foreach (var rec in AllRecords())
        {
            if (rec.CapturedAtMillis < cutoff)
            {
                TryDelete(rec.Path);
            }
            else
            {
                surviving.Add(rec);
            }
        }

        for (var i = 0; i < surviving.Count - maxCount; i++)
        {
            TryDelete(surviving[i].Path);
        }
    }

    public void Clear()
    {
        foreach (var rec in AllRecords())
        {
            TryDelete(rec.Path);
        }
    }

    /// <summary>Captures still waiting to upload. Directory listing only; no image is read.</summary>
    public int PendingCount() => AllRecords().Count;

    internal static string FileName(long millis, string id, CaptureGroup group) =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"{millis}__{id}__{group.Id}__{group.DisplayIndex}__{group.DisplayCount}.jpg");

    private readonly record struct Record(string Path, long CapturedAtMillis, string Id, CaptureGroup Group);

    private string[] Contents()
    {
        try
        {
            return Directory.GetFiles(_directory);
        }
        catch (DirectoryNotFoundException)
        {
            return [];
        }
    }

    private static Record? Parse(string path)
    {
        var name = Path.GetFileName(path);
        if (!name.EndsWith(".jpg", StringComparison.Ordinal))
        {
            return null;
        }

        var parts = name[..^4].Split("__");
        if (parts.Length != 5 ||
            !long.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var millis) ||
            !int.TryParse(parts[3], NumberStyles.Integer, CultureInfo.InvariantCulture, out var index) ||
            !int.TryParse(parts[4], NumberStyles.Integer, CultureInfo.InvariantCulture, out var count))
        {
            return null;
        }

        return new Record(path, millis, parts[1], new CaptureGroup(parts[2], index, count));
    }

    private List<Record> AllRecords()
    {
        var records = new List<Record>();
        foreach (var path in Contents())
        {
            if (Parse(path) is { } rec)
            {
                records.Add(rec);
            }
        }

        records.Sort(static (a, b) =>
        {
            var byTime = a.CapturedAtMillis.CompareTo(b.CapturedAtMillis);
            return byTime != 0 ? byTime : string.CompareOrdinal(a.Id, b.Id);
        });
        return records;
    }

    private void SweepTemporaries()
    {
        foreach (var path in Contents())
        {
            if (Path.GetFileName(path).StartsWith(".tmp-", StringComparison.Ordinal))
            {
                TryDelete(path);
            }
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Another pass got there first, or the file is briefly locked; the next cycle retries.
        }
    }
}
