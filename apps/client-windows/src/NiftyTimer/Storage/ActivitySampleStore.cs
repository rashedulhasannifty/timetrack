using System.Globalization;
using System.Text.Json;
using NiftyTimer.Sync;

namespace NiftyTimer.Storage;

/// <summary>The activity-buffer seam. Tests substitute a spy.</summary>
public interface IActivitySampleBuffer
{
    void Enqueue(ActivitySamplePayload sample);

    IReadOnlyList<ActivitySamplePayload> Take(int limit);

    void Remove(IEnumerable<string> ids);

    void Prune(TimeSpan maxAge, int maxCount);

    void Clear();

    int PendingCount();
}

/// <summary>
/// PRD §7.5 — durable, file-backed buffer for activity samples.
///
/// Shares <see cref="BufferStore"/>'s durability model (one file per record, write to
/// <c>.tmp-&lt;id&gt;</c> then rename, sweep leftover temporaries on construction, FIFO by a
/// filename-encoded millisecond stamp) but is a SEPARATE store because it drains in BATCHES
/// through its own uploader and engine, where <see cref="BufferStore"/> posts one record per
/// request. Filename <c>&lt;createdMillis&gt;__&lt;id&gt;.json</c> carries order and identity
/// without opening the file.
///
/// Not a capture path: this holds records that have already been captured, so it takes no gate
/// and lives in <c>NiftyTimer.Storage</c> rather than a capture namespace.
/// </summary>
public sealed class ActivitySampleStore : IActivitySampleBuffer
{
    private readonly string _directory;
    private readonly Func<DateTimeOffset> _clock;

    public ActivitySampleStore(string directory, Func<DateTimeOffset>? clock = null)
    {
        _directory = directory;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        Directory.CreateDirectory(directory);
        SweepTemporaries();
    }

    public void Enqueue(ActivitySamplePayload sample)
    {
        byte[] payload;
        try
        {
            payload = JsonSerializer.SerializeToUtf8Bytes(sample, TimeEntryPayload.JsonOptions);
        }
        catch (NotSupportedException)
        {
            return;
        }

        var millis = _clock().ToUnixTimeMilliseconds();
        var dst = Path.Combine(_directory, $"{millis}__{sample.Id}.json");
        var tmp = Path.Combine(_directory, $".tmp-{sample.Id}");
        try
        {
            File.WriteAllBytes(tmp, payload);
            File.Move(tmp, dst, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            TryDelete(tmp);
        }
    }

    /// <summary>FIFO (oldest first), up to <paramref name="limit"/>.</summary>
    public IReadOnlyList<ActivitySamplePayload> Take(int limit)
    {
        var result = new List<ActivitySamplePayload>();
        foreach (var rec in AllRecords())
        {
            if (result.Count >= limit)
            {
                break;
            }

            try
            {
                if (JsonSerializer.Deserialize<ActivitySamplePayload>(File.ReadAllBytes(rec.Path)) is { } sample)
                {
                    result.Add(sample);
                }
            }
            catch (Exception e) when (e is IOException or JsonException)
            {
                // Unreadable or corrupt mid-drain. Skipped, not deleted: Prune bounds the buffer,
                // and deleting on a read error would discard a record that a retry might recover.
            }
        }

        return result;
    }

    public void Remove(IEnumerable<string> ids)
    {
        var set = new HashSet<string>(ids, StringComparer.Ordinal);
        if (set.Count == 0)
        {
            return;
        }

        foreach (var rec in AllRecords())
        {
            if (set.Contains(rec.Id))
            {
                TryDelete(rec.Path);
            }
        }
    }

    /// <summary>Age-bound first (drop anything older than <paramref name="maxAge"/>), then
    /// count-bound (trim the oldest beyond <paramref name="maxCount"/>).</summary>
    public void Prune(TimeSpan maxAge, int maxCount)
    {
        var cutoff = _clock().Subtract(maxAge).ToUnixTimeMilliseconds();
        var surviving = new List<Record>();
        foreach (var rec in AllRecords())
        {
            if (rec.CreatedAtMillis < cutoff)
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

    public int PendingCount() => AllRecords().Count;

    private readonly record struct Record(string Path, long CreatedAtMillis, string Id);

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
        if (!name.EndsWith(".json", StringComparison.Ordinal))
        {
            return null;
        }

        var parts = name[..^5].Split("__");
        if (parts.Length != 2 ||
            !long.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var millis))
        {
            return null;
        }

        return new Record(path, millis, parts[1]);
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
            var byTime = a.CreatedAtMillis.CompareTo(b.CreatedAtMillis);
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
            // Another pass got there first, or the file is briefly locked. The next cycle retries;
            // a failed delete must never abort a drain.
        }
    }
}
