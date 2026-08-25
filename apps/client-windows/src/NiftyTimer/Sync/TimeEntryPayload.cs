using System.Text.Json;
using System.Text.Json.Serialization;

namespace NiftyTimer.Sync;

/// <summary>
/// Matches <c>CreateTimeEntrySchema</c> in @timetrack/contracts.
///
/// <c>projectId</c>/<c>taskId</c>/<c>endTime</c> are <c>.nullable()</c> on the server (present,
/// may be null), so a null MUST be written as an explicit JSON null — omitting the key makes the
/// strict-mode Zod pipe answer 422. <c>note</c> is <c>.optional()</c>, so a null is omitted
/// instead. That asymmetry is the whole reason this type spells out its serializer options
/// rather than setting a blanket <c>DefaultIgnoreCondition</c>.
///
/// A null <c>endTime</c> means the entry is still RUNNING. Only the direct live-entry publish
/// sends that; buffered records are always closed.
///
/// Nothing else may be added here. Request bodies are parsed in Zod strict mode, so an extra
/// field — a helpful <c>platform</c>, <c>deviceId</c> or <c>clientVersion</c> — is rejected 422.
/// </summary>
public sealed record TimeEntryPayload
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("projectId")]
    public string? ProjectId { get; init; }

    [JsonPropertyName("taskId")]
    public string? TaskId { get; init; }

    [JsonPropertyName("startTime")]
    public required string StartTime { get; init; }

    [JsonPropertyName("endTime")]
    public string? EndTime { get; init; }

    [JsonPropertyName("source")]
    public required string Source { get; init; }

    [JsonPropertyName("note")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Note { get; init; }

    /// <summary>
    /// Serializer options for every client → server body. <c>DefaultIgnoreCondition</c> stays at
    /// <c>Never</c> so nullable fields emit explicit nulls; only members carrying an explicit
    /// <c>[JsonIgnore(WhenWritingNull)]</c> are omitted.
    /// </summary>
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public byte[] ToJsonUtf8() => JsonSerializer.SerializeToUtf8Bytes(this, JsonOptions);
}
