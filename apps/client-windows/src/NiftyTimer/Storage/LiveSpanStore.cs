using System.Text.Json;
using System.Text.Json.Serialization;
using NiftyTimer.Tracking;

namespace NiftyTimer.Storage;

/// <summary>
/// The persisted in-progress span. <c>Source</c> is the wire token ("MANUAL"/"AUTO");
/// <c>LastAlive</c> is bumped by the heartbeat; <c>UserId</c> is stamped so recovery can refuse a
/// span belonging to a different user.
/// </summary>
public sealed record LiveSpan
{
    [JsonPropertyName("entryId")]
    public required string EntryId { get; init; }

    [JsonPropertyName("startTime")]
    public required DateTimeOffset StartTime { get; init; }

    [JsonPropertyName("projectId")]
    public string? ProjectId { get; init; }

    [JsonPropertyName("taskId")]
    public string? TaskId { get; init; }

    [JsonPropertyName("source")]
    public required string Source { get; init; }

    [JsonPropertyName("lastAlive")]
    public required DateTimeOffset LastAlive { get; init; }

    [JsonPropertyName("userId")]
    public string? UserId { get; init; }
}

/// <summary>
/// The seam <see cref="TimeTracker"/> calls on open/close. <see cref="NoopLiveSpan"/> keeps the
/// existing pure-unit tests unchanged; <see cref="LiveSpanStore"/> is the real persister.
/// </summary>
public interface ILiveSpanRecorder
{
    void Begin(string entryId, DateTimeOffset startTime, TimeTracker.Selection selection, TimeTracker.EntrySource source);

    void Clear();
}

/// <summary>The default: record nothing. Used by tests and by any tracker with no store wired.</summary>
public sealed class NoopLiveSpan : ILiveSpanRecorder
{
    public void Begin(string entryId, DateTimeOffset startTime, TimeTracker.Selection selection, TimeTracker.EntrySource source)
    {
    }

    public void Clear()
    {
    }
}

/// <summary>
/// PRD §7.5 in spirit — persists the CURRENT in-progress span so a crash, a power loss, or a
/// quit-while-tracking doesn't lose it. One overwritten JSON file under <c>%LOCALAPPDATA%</c>; the
/// heartbeat keeps <c>LastAlive</c> current so recovery closes the span near its true end and never
/// counts downtime.
///
/// Deliberately NOT the durable buffer: this is one mutable row describing a span that has not
/// finished yet, whereas <see cref="BufferStore"/> holds immutable completed records. On recovery
/// the span becomes a completed record and moves into the buffer.
///
/// Not a capture path — no <see cref="Policy.AckGate"/>.
/// </summary>
public sealed class LiveSpanStore : ILiveSpanRecorder
{
    private readonly string _path;
    private readonly Func<string?> _currentUserId;

    public LiveSpanStore(string path, Func<string?> currentUserId)
    {
        _path = path;
        _currentUserId = currentUserId;
    }

    /// <summary>
    /// Recover only if the span belongs to the current user (or predates userId stamping).
    ///
    /// Cross-user integrity (CLAUDE.md §1): the buffer uploads by token, so replaying another
    /// user's span here would attribute their time to whoever is signed in now.
    /// </summary>
    public static bool ShouldRecover(LiveSpan span, string? currentUserId) =>
        span.UserId is null || span.UserId == currentUserId;

    public void Begin(
        string entryId,
        DateTimeOffset startTime,
        TimeTracker.Selection selection,
        TimeTracker.EntrySource source) =>
        Write(new LiveSpan
        {
            EntryId = entryId,
            StartTime = startTime,
            ProjectId = selection.ProjectId,
            TaskId = selection.TaskId,
            Source = TimeTracker.SourceToken(source),
            LastAlive = startTime,
            UserId = _currentUserId(),
        });

    public void Heartbeat(DateTimeOffset now)
    {
        if (Load() is { } span)
        {
            Write(span with { LastAlive = now });
        }
    }

    public LiveSpan? Load()
    {
        try
        {
            return JsonSerializer.Deserialize<LiveSpan>(File.ReadAllBytes(_path));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            // Absent (the common case: nothing was running), unreadable, or truncated by a crash
            // mid-write. All three mean "no span to recover", which is the fail-safe answer.
            return null;
        }
    }

    public void Clear()
    {
        try
        {
            File.Delete(_path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
        }
    }

    private void Write(LiveSpan span)
    {
        // Write-then-rename, like BufferStore: a crash mid-write must not leave a half-file that
        // reads as a span with a plausible-but-wrong end time.
        var tmp = _path + ".tmp";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            File.WriteAllBytes(tmp, JsonSerializer.SerializeToUtf8Bytes(span));
            File.Move(tmp, _path, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            try
            {
                File.Delete(tmp);
            }
            catch (Exception inner) when (inner is IOException or UnauthorizedAccessException)
            {
            }
        }
    }
}
