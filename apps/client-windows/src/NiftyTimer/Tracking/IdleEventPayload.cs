using System.Text.Json;
using System.Text.Json.Serialization;
using NiftyTimer.Storage;
using NiftyTimer.Sync;

namespace NiftyTimer.Tracking;

/// <summary>
/// PRD §6.1/§6.4 — mirrors <c>ResolvedAction</c> in @timetrack/contracts. KEPT counts the away
/// time (a bridge TimeEntry covers it); DISCARDED drops it; UNRESOLVED is emitted when the app
/// tears down mid-away — the fail-safe, idle not counted.
/// </summary>
public enum ResolvedAction
{
    Kept,
    Discarded,
    Unresolved,
}

/// <summary>
/// Mirrors <c>IdleEventSchema</c> in @timetrack/contracts. All four fields are required and
/// non-nullable there, so there is no null/omit asymmetry to get wrong — unlike
/// <see cref="TimeEntryPayload"/>. Bodies are still parsed in Zod strict mode, so nothing may be
/// added here.
/// </summary>
public sealed record IdleEventPayload
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("startTime")]
    public required string StartTime { get; init; }

    [JsonPropertyName("endTime")]
    public required string EndTime { get; init; }

    /// <summary>
    /// The wire token, not the enum: <c>System.Text.Json</c> would otherwise write
    /// <c>"Kept"</c>, and the server's <c>z.enum(['KEPT', …])</c> answers 422 — which the uploader
    /// classifies as permanent, so the record would be silently dropped rather than retried.
    /// </summary>
    [JsonPropertyName("resolvedAction")]
    public required string ResolvedAction { get; init; }

    public static string Token(ResolvedAction action) => action switch
    {
        Tracking.ResolvedAction.Kept => "KEPT",
        Tracking.ResolvedAction.Discarded => "DISCARDED",
        Tracking.ResolvedAction.Unresolved => "UNRESOLVED",
        _ => throw new ArgumentOutOfRangeException(nameof(action)),
    };

    public byte[] ToJsonUtf8() => JsonSerializer.SerializeToUtf8Bytes(this, TimeEntryPayload.JsonOptions);
}

/// <summary>
/// Builds, encodes, and buffers one <see cref="IdleEventPayload"/>. Shared by the auto and manual
/// idle coordinators so the ISO formatting and the buffer kind live in exactly one place.
/// <c>id</c> is the caller's client-minted UUIDv7 (the idempotency key).
/// </summary>
public static class IdleEventEnqueuer
{
    public static void Enqueue(
        ITimeEntryBuffer buffer,
        string id,
        DateTimeOffset from,
        DateTimeOffset to,
        ResolvedAction action)
    {
        // Never emit an inverted window, for the same reason TimeTracker clamps its spans: a
        // backwards clock step would produce a 422, which is classified permanent and dropped.
        var safeTo = to < from ? from : to;

        var payload = new IdleEventPayload
        {
            Id = id,
            StartTime = UuidV7.Iso(from),
            EndTime = UuidV7.Iso(safeTo),
            ResolvedAction = IdleEventPayload.Token(action),
        };

        buffer.Enqueue(id, BufferKind.IdleEvent, payload.ToJsonUtf8());
    }
}
