using System.Text.Json;
using NiftyTimer.Storage;

namespace NiftyTimer.Projects;

/// <summary>
/// Persists the last picker selection so the employee doesn't re-pick their project every day.
///
/// Keyed by userId. The view model clears the in-memory selection on sign-out so a different user
/// cannot inherit a stale, wrong-team selection (CLAUDE.md §1); namespacing the persisted value
/// per user is what lets it survive a relaunch without reopening that hole. Not a capture path.
/// </summary>
public sealed class SelectionStore
{
    private readonly IUserSettings _settings;

    public SelectionStore(IUserSettings settings) => _settings = settings;

    public void Save(StoredSelection selection, string userId) =>
        _settings.SetString(Key(userId), JsonSerializer.Serialize(selection));

    public StoredSelection? Load(string userId)
    {
        var raw = _settings.GetString(Key(userId));
        if (raw is null)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<StoredSelection>(raw);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public void Clear(string userId) => _settings.Remove(Key(userId));

    private static string Key(string userId) => $"NiftyTimer.lastSelection.{userId}";
}

/// <summary>
/// Decides which selection the picker should open on, given what was stored and what the team's
/// project list actually contains now.
///
/// A stored selection can go stale in four ways between launches: the project was archived or
/// deleted, the task was removed or moved to another subproject, or the subproject was archived.
/// Silently starting the clock against something that no longer exists produces entries nobody
/// can find in the dashboard, so each case degrades one step rather than being carried forward.
///
/// The table is identical on macOS (SelectionResolver.swift), and a task that still exists wins:
/// a moved task resolves to its CURRENT subproject, never a mismatched pair. The same rule
/// upgrades a selection stored by 0.2.x, which has no subprojectId.
/// </summary>
public static class SelectionResolver
{
    public static StoredSelection? Resolve(StoredSelection? stored, IReadOnlyList<Project> projects)
    {
        if (stored is null || projects.FirstOrDefault(p => p.Id == stored.ProjectId && !p.Archived) is not { } project)
        {
            return null; // gone or archived — no selection
        }

        var node = PickerTree.Node(project);
        if (stored.TaskId is { } taskId && node.Subprojects.FirstOrDefault(s => s.Tasks.Any(t => t.Id == taskId)) is { } home)
        {
            return new StoredSelection(project.Id, taskId, home.Id);
        }

        if (stored.SubprojectId is { } subprojectId && node.FindSubproject(subprojectId) is not null)
        {
            return new StoredSelection(project.Id, null, subprojectId);
        }

        return new StoredSelection(project.Id, null, node.DefaultSubproject?.Id);
    }
}
