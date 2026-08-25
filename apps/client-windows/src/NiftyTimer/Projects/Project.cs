using System.Text.Json.Serialization;

namespace NiftyTimer.Projects;

/// <summary>Client-side mirror of <c>ProjectSchema</c> in @timetrack/contracts.</summary>
public sealed record Project(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("teamId")] string TeamId,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("archived")] bool Archived,
    [property: JsonPropertyName("tasks")] IReadOnlyList<ProjectTask>? Tasks);

/// <summary>Client-side mirror of <c>TaskSchema</c> in @timetrack/contracts.</summary>
public sealed record ProjectTask(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("projectId")] string ProjectId,
    [property: JsonPropertyName("name")] string Name);

/// <summary>The picker selection worth remembering across launches. Ids only — never names.</summary>
public sealed record StoredSelection(
    [property: JsonPropertyName("projectId")] string ProjectId,
    [property: JsonPropertyName("taskId")] string? TaskId);
