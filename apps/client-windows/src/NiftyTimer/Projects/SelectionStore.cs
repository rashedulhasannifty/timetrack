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
/// A stored selection can go stale in three ways between launches: the project was archived, the
/// project was deleted, or the task was removed. Silently starting the clock against a project
/// that no longer exists produces entries nobody can find in the dashboard, so each case degrades
/// one step rather than being carried forward.
/// </summary>
public static class SelectionResolver
{
    public static StoredSelection? Resolve(StoredSelection? stored, IReadOnlyList<Project> projects)
    {
        if (stored is null)
        {
            return null;
        }

        var project = projects.FirstOrDefault(p => p.Id == stored.ProjectId && !p.Archived);
        if (project is null)
        {
            return null; // archived or gone — fall back to no selection
        }

        if (stored.TaskId is null)
        {
            return stored;
        }

        var taskStillExists = project.Tasks?.Any(t => t.Id == stored.TaskId) ?? false;

        // Keep the project, drop the task: the person's project choice is still valid and is the
        // part that determines where the time lands.
        return taskStillExists ? stored : new StoredSelection(stored.ProjectId, null);
    }
}
