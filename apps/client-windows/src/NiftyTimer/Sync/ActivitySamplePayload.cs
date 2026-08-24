using System.Text.Json;
using System.Text.Json.Serialization;

namespace NiftyTimer.Sync;

/// <summary>
/// Mirrors <c>ActivitySampleSchema</c> in @timetrack/contracts. The client cannot import the TS
/// contract, so this is kept in sync by hand and by <c>WireContractTests</c>.
///
/// The null rules are not cosmetic. <c>windowTitle</c> is <c>.nullable()</c> but NOT
/// <c>.optional()</c>: the key must be PRESENT and explicitly null when there is no title, or the
/// strict-mode Zod pipe answers 422. <c>bundleId</c> is <c>.nullable().optional()</c>, so an
/// explicit null is also accepted and is what we send — same shape as the Mac client, so the two
/// platforms produce byte-identical bodies for the same observation.
///
/// System.Text.Json writes nulls by default, so the hazard here is the inverse of the Swift
/// client's: adding a blanket <c>DefaultIgnoreCondition = WhenWritingNull</c> would start
/// omitting <c>windowTitle</c> and 422 every batch. <see cref="TimeEntryPayload.JsonOptions"/>
/// pins it at <c>Never</c> for exactly that reason and is reused here.
///
/// Nothing else may be added. Bodies parse in strict mode, so a helpful <c>platform</c> or
/// <c>deviceId</c> field is a 422 — and a 422 classifies as permanent, so the batch is dropped
/// rather than retried. There is deliberately no URL or host field: those never leave the device.
/// </summary>
public sealed record ActivitySamplePayload
{
    /// <summary>Client-minted UUIDv7 — the server upserts on it, so a retried batch is a no-op.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>ISO-8601 instant: the END of the measurement window.</summary>
    [JsonPropertyName("timestamp")]
    public required string Timestamp { get; init; }

    [JsonPropertyName("appName")]
    public required string AppName { get; init; }

    [JsonPropertyName("bundleId")]
    public string? BundleId { get; init; }

    [JsonPropertyName("windowTitle")]
    public string? WindowTitle { get; init; }

    [JsonPropertyName("activityPct")]
    public required int ActivityPct { get; init; }

    /// <summary>A <see cref="Policy.Categories.Token"/> value — uppercase on the wire.</summary>
    [JsonPropertyName("category")]
    public required string Category { get; init; }
}

/// <summary>
/// The batch body for <c>POST /v1/activity-samples/batch</c>: <c>{ "samples": [...] }</c>, 1–500
/// samples. A separate type rather than an anonymous object so the property name is pinned by the
/// contract test rather than by a serializer's naming policy.
/// </summary>
public sealed record ActivityBatchPayload
{
    [JsonPropertyName("samples")]
    public required IReadOnlyList<ActivitySamplePayload> Samples { get; init; }

    public byte[] ToJsonUtf8() =>
        JsonSerializer.SerializeToUtf8Bytes(this, TimeEntryPayload.JsonOptions);
}
