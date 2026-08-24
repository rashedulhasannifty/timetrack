using System.Globalization;

namespace NiftyTimer.Storage;

/// <summary>
/// The kind of a buffered record — used to route on drain (SyncEngine syncs each kind to its own
/// endpoint).
/// </summary>
public enum BufferKind
{
    TimeEntry,
    IdleEvent,
}

/// <summary>The buffer seam. Tests substitute a spy.</summary>
public interface ITimeEntryBuffer
{
    void Enqueue(string id, BufferKind kind, byte[] payload);
}

/// <summary>
/// PRD §7.5 — durable, file-backed offline write-buffer. One atomic file per record under
/// %LOCALAPPDATA%; the filename <c>&lt;createdAtMillis&gt;__&lt;kind&gt;__&lt;uuidv7&gt;.json</c>
/// carries FIFO order, routing, and identity, so listing the directory yields all three WITHOUT
/// reading contents. The file's content IS the raw payload the API upserts on (idempotent on the
/// UUIDv7). Hand-rolled — no SQLite dependency (CLAUDE.md §2); durability comes from
/// write-temp-then-rename plus a startup sweep of any <c>.tmp-*</c> left by a crash between write
/// and rename. File-per-record gives natural isolation: concurrent enqueue (UI thread) and
/// take/remove (sync task) touch different files.
/// </summary>
public sealed class BufferStore : ITimeEntryBuffer
{
    private readonly string _directory;
    private readonly Func<DateTimeOffset> _clock;

    public BufferStore(string directory, Func<DateTimeOffset>? clock = null)
    {
        _directory = directory;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        Directory.CreateDirectory(directory);
        SweepTemporaries();
    }

    /// <summary>Atomic enqueue: write to <c>.tmp-&lt;id&gt;</c>, then rename to the final name.</summary>
    public void Enqueue(string id, BufferKind kind, byte[] payload)
    {
        var millis = _clock().ToUnixTimeMilliseconds();
        var dst = Path.Combine(_directory, $"{millis}__{KindToken(kind)}__{id}.json");
        var tmp = Path.Combine(_directory, $".tmp-{id}");
        try
        {
            File.WriteAllBytes(tmp, payload);
            File.Move(tmp, dst, overwrite: true); // ids are unique; overwrite is defensive
        }
        catch (IOException)
        {
            TryDelete(tmp);
        }
        catch (UnauthorizedAccessException)
        {
            TryDelete(tmp);
        }
    }

    /// <summary>FIFO (createdAt asc) records of <paramref name="kind"/>, up to <paramref name="limit"/>.</summary>
    public IReadOnlyList<(string Id, byte[] Payload)> Take(BufferKind kind, int limit)
    {
        var token = KindToken(kind);
        var result = new List<(string, byte[])>();
        foreach (var rec in AllRecords())
        {
            if (result.Count >= limit)
            {
                break;
            }

            if (rec.Kind != token)
            {
                continue;
            }

            try
            {
                result.Add((rec.Id, File.ReadAllBytes(rec.Path)));
            }
            catch (IOException)
            {
                // Unreadable mid-drain (deleted by a concurrent pass): skip it.
            }
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
    /// Drops records created before <c>now - maxAge</c>, bounding the buffer against records that
    /// never deliver. Both kinds are drained and removed on 2xx, so only stuck records ever age
    /// out.
    /// </summary>
    public void Prune(TimeSpan maxAge)
    {
        var cutoff = _clock().Subtract(maxAge).ToUnixTimeMilliseconds();
        foreach (var rec in AllRecords())
        {
            if (rec.CreatedAtMillis < cutoff)
            {
                TryDelete(rec.Path);
            }
        }
    }

    public void Clear()
    {
        foreach (var rec in AllRecords())
        {
            TryDelete(rec.Path);
        }
    }

    /// <summary>
    /// How many records are still waiting to reach the server.
    ///
    /// Counted from the directory listing, not by reading any payload — the filename carries
    /// everything, which is the whole point of the naming scheme, and this runs on every menu
    /// open.
    /// </summary>
    public int PendingCount() => AllRecords().Count;

    internal static string KindToken(BufferKind kind) => kind switch
    {
        BufferKind.TimeEntry => "timeEntry",
        BufferKind.IdleEvent => "idleEvent",
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    private readonly record struct Record(string Path, long CreatedAtMillis, string Kind, string Id);

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
        if (parts.Length != 3 ||
            !long.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var millis))
        {
            return null;
        }

        return new Record(path, millis, parts[1], parts[2]);
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
        catch (IOException)
        {
            // Another pass got there first, or the file is momentarily locked. Either way the
            // next cycle retries; a failed delete must never abort a drain.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
