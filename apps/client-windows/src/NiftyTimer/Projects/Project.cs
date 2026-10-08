using System.Text.Json.Serialization;

namespace NiftyTimer.Projects;

/// <summary>Client-side mirror of <c>ProjectSchema</c> in @timetrack/contracts.</summary>
public sealed record Project(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("teamId")] string TeamId,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("archived")] bool Archived,
    [property: JsonPropertyName("tasks")] IReadOnlyList<ProjectTask>? Tasks,
    // Optional so a projects.json cached by 0.2.x, which has no subprojects, still loads.
    [property: JsonPropertyName("subprojects")] IReadOnlyList<Subproject>? Subprojects = null,
    // Optional: an admin's picker groups by them; a cache or API from before 2026-10 has neither.
    [property: JsonPropertyName("teamName")] string? TeamName = null,
    [property: JsonPropertyName("teamIds")] IReadOnlyList<string>? TeamIds = null);

/// <summary>Client-side mirror of <c>SubprojectSchema</c> in @timetrack/contracts.</summary>
public sealed record Subproject(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("projectId")] string ProjectId,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("archived")] bool Archived,
    [property: JsonPropertyName("isDefault")] bool IsDefault);

/// <summary>Client-side mirror of <c>TaskSchema</c> in @timetrack/contracts.</summary>
public sealed record ProjectTask(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("projectId")] string ProjectId,
    [property: JsonPropertyName("name")] string Name,
    // Optional so a projects.json cached by 0.2.x, which has no subprojectId, still loads.
    [property: JsonPropertyName("subprojectId")] string? SubprojectId = null);

/// <summary>The picker selection worth remembering across launches. Ids only — never names.</summary>
public sealed record StoredSelection(
    [property: JsonPropertyName("projectId")] string ProjectId,
    [property: JsonPropertyName("taskId")] string? TaskId,
    // Optional so a selection stored by 0.2.x, which has no subprojectId, still loads.
    [property: JsonPropertyName("subprojectId")] string? SubprojectId = null);
