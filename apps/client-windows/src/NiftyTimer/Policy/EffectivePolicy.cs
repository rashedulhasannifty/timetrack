using System.Text.Json.Serialization;

namespace NiftyTimer.Policy;

/// <summary>
/// Mirrors <c>EffectivePolicySchema</c> in @timetrack/contracts. <c>AckRequired</c> is the gate:
/// while true, the client MUST NOT capture (PRD §4.1). Enforced server-side too.
/// </summary>
public sealed record EffectivePolicy
{
    [JsonPropertyName("ackRequired")]
    public required bool AckRequired { get; init; }

    [JsonPropertyName("policyVersion")]
    public required string PolicyVersion { get; init; }

    [JsonPropertyName("policyText")]
    public string PolicyText { get; init; } = string.Empty;

    [JsonPropertyName("settings")]
    public required PolicySettings Settings { get; init; }
}

/// <summary>
/// The subset of @timetrack/contracts <c>TeamSettingsSchema</c> the client acts on. Unknown keys
/// in the JSON are ignored by the deserializer — which is exactly how
/// <c>distractionAlertsEnabled</c> went unread for a whole release on macOS, so
/// <c>PolicySettingsDecodeTests</c> asserts every field here against a full server body.
///
/// Optional fields carry the server's own defaults (contracts/team-settings.ts) so a legacy or
/// partial policy body still decodes into something safe. Note in particular that distraction
/// alerts are OPT-IN: an absent key means OFF, because a policy that never mentions the switch
/// must not nudge.
/// </summary>
public sealed record PolicySettings
{
    [JsonPropertyName("idleThresholdMinutes")]
    public int IdleThresholdMinutes { get; init; } = 5;

    [JsonPropertyName("autoStartOnLogin")]
    public bool AutoStartOnLogin { get; init; }

    [JsonPropertyName("screenshotsEnabled")]
    public bool ScreenshotsEnabled { get; init; }

    [JsonPropertyName("screenshotIntervalMinutes")]
    public int ScreenshotIntervalMinutes { get; init; } = 10;

    [JsonPropertyName("captureWindowTitles")]
    public bool CaptureWindowTitles { get; init; } = true;

    [JsonPropertyName("distractionAlertsEnabled")]
    public bool DistractionAlertsEnabled { get; init; }

    [JsonPropertyName("distractionThresholdMinutes")]
    public int DistractionThresholdMinutes { get; init; } = 10;

    [JsonPropertyName("distractionRepeatMinutes")]
    public int DistractionRepeatMinutes { get; init; } = 5;

    [JsonPropertyName("productiveApps")]
    public IReadOnlyList<string> ProductiveApps { get; init; } = [];

    [JsonPropertyName("unproductiveApps")]
    public IReadOnlyList<string> UnproductiveApps { get; init; } = [];

    [JsonPropertyName("productiveSites")]
    public IReadOnlyList<string> ProductiveSites { get; init; } = [];

    [JsonPropertyName("unproductiveSites")]
    public IReadOnlyList<string> UnproductiveSites { get; init; } = [];
}
