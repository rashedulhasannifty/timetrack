namespace NiftyTimer.Projects;

/// <summary>
/// The UI-free picker core (spec §3): Projects → Subprojects → Tasks as rows the popup renders.
/// A line-for-line port of the macOS client's PickerCore.swift — change both together.
/// </summary>
public sealed record PickerTask(string Id, string Name);

/// <summary>
/// One subproject bucket. A null <c>Id</c> is the implicit default of a project decoded from a
/// cache written before subprojects existed: the client sends <c>subprojectId: null</c> and the
/// server derives it.
/// </summary>
public sealed record PickerSubproject(string? Id, string Name, bool IsDefault, IReadOnlyList<PickerTask> Tasks);

public sealed record PickerProject(string Id, string Name, IReadOnlyList<PickerSubproject> Subprojects)
{
    /// <summary>Only the default is active: the subproject screen is skipped and search paths omit it.</summary>
    public bool SkipsSubprojectLevel => Subprojects.Count == 1 && Subprojects[0].IsDefault;

    public PickerSubproject? DefaultSubproject => Subprojects.FirstOrDefault(s => s.IsDefault);

    public PickerSubproject? FindSubproject(string? id) => Subprojects.FirstOrDefault(s => s.Id == id);
}

public static class PickerTree
{
    /// <summary>Name of the implicit default for a pre-subproject cache. Never displayed.</summary>
    public const string ImplicitDefaultName = "General";

    public static IReadOnlyList<PickerProject> Build(IReadOnlyList<Project> projects) =>
        projects.Where(p => !p.Archived).Select(Node).ToList();

    public static PickerProject Node(Project project)
    {
        var tasks = project.Tasks ?? [];
        var active = (project.Subprojects ?? []).Where(s => !s.Archived).ToList();
        if (active.Count == 0)
        {
            return new PickerProject(project.Id, project.Name,
                [new PickerSubproject(null, ImplicitDefaultName, true, Sorted(tasks))]);
        }

        var ordered = active
            .OrderByDescending(s => s.IsDefault)
            .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var defaultId = ordered.FirstOrDefault(s => s.IsDefault)?.Id;
        return new PickerProject(project.Id, project.Name, ordered
            .Select(s => new PickerSubproject(s.Id, s.Name, s.IsDefault,
                Sorted(tasks.Where(t => (t.SubprojectId ?? defaultId) == s.Id))))
            .ToList());
    }

    private static IReadOnlyList<PickerTask> Sorted(IEnumerable<ProjectTask> tasks) =>
        tasks.OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase).Select(t => new PickerTask(t.Id, t.Name)).ToList();
}

public abstract record PickerLevel
{
    private PickerLevel()
    {
    }

    public static PickerLevel Root { get; } = new RootLevel();

    public sealed record RootLevel : PickerLevel;

    public sealed record ProjectLevel(string ProjectId) : PickerLevel;

    public sealed record SubprojectLevel(string ProjectId, string? SubprojectId) : PickerLevel;
}

public enum PickerRowKind
{
    Open,
    Track,
}

/// <summary>
/// One picker row. <c>Target</c> is set for <see cref="PickerRowKind.Open"/>, <c>Selection</c> for
/// <see cref="PickerRowKind.Track"/>. <c>IsOnPath</c> tints a row on the way to the current
/// selection at every level; <c>IsCurrent</c> (the choice itself) also draws the checkmark. Both
/// are stamped by the view model — NOT <c>ListBoxItem.IsSelected</c>, which is the keyboard highlight.
/// </summary>
public sealed record PickerRow(
    string Id,
    string Title,
    PickerRowKind Kind,
    PickerLevel? Target,
    StoredSelection? Selection,
    bool IsCurrent = false,
    bool IsOnPath = false);

/// <summary>One step of the breadcrumb bar above the list. Every crumb but the last is a way back.</summary>
public sealed record PickerCrumb(string Title, PickerLevel Level);

/// <summary>
/// The "Working on" card: the project on its own line, then what is under it (subproject and/or
/// task), or null when the project is all there is to say.
/// </summary>
public sealed record PickerWorkingOn(string Project, string? Detail);

public static class PickerNavigation
{
    public const string Separator = " › ";
    public const string RootTitle = "All projects";

    /// <summary>
    /// A project whose lone default subproject has no tasks has nothing below it to choose: its
    /// root row selects it.
    /// </summary>
    public static bool IsLeaf(PickerProject project) =>
        project.SkipsSubprojectLevel && project.Subprojects[0].Tasks.Count == 0;

    public static PickerLevel Open(PickerProject project) =>
        project.SkipsSubprojectLevel
            ? new PickerLevel.SubprojectLevel(project.Id, project.Subprojects[0].Id)
            : new PickerLevel.ProjectLevel(project.Id);

    public static PickerLevel Back(PickerLevel level, IReadOnlyList<PickerProject> tree) =>
        Normalize(level, tree) is PickerLevel.SubprojectLevel sub
        && tree.FirstOrDefault(p => p.Id == sub.ProjectId) is { SkipsSubprojectLevel: false }
            ? new PickerLevel.ProjectLevel(sub.ProjectId)
            : PickerLevel.Root;

    /// <summary>A level a refresh removed falls back to a valid one (plan ruling 5).</summary>
    public static PickerLevel Normalize(PickerLevel level, IReadOnlyList<PickerProject> tree)
    {
        switch (level)
        {
            case PickerLevel.ProjectLevel p:
                return tree.FirstOrDefault(x => x.Id == p.ProjectId) is { } project ? Open(project) : PickerLevel.Root;
            case PickerLevel.SubprojectLevel s:
                if (tree.FirstOrDefault(x => x.Id == s.ProjectId) is not { } owner)
                {
                    return PickerLevel.Root;
                }

                return owner.Subprojects.Any(x => x.Id == s.SubprojectId) ? level : Open(owner);
            default:
                return PickerLevel.Root;
        }
    }

    public static IReadOnlyList<PickerRow> Rows(PickerLevel level, IReadOnlyList<PickerProject> tree)
    {
        switch (Normalize(level, tree))
        {
            case PickerLevel.ProjectLevel p when tree.FirstOrDefault(x => x.Id == p.ProjectId) is { } project:
                // A subproject with no tasks is the choice itself — one click, not a screen whose
                // only useful row is "(no task)".
                return project.Subprojects.Select(s => s.Tasks.Count == 0
                        ? new PickerRow($"s:{s.Id ?? project.Id}", s.Name, PickerRowKind.Track, null,
                            new StoredSelection(project.Id, null, s.Id))
                        : new PickerRow($"s:{s.Id ?? project.Id}", s.Name, PickerRowKind.Open,
                            new PickerLevel.SubprojectLevel(project.Id, s.Id), null))
                    .ToList();
            case PickerLevel.SubprojectLevel s
                when tree.FirstOrDefault(x => x.Id == s.ProjectId) is { } owner
                     && owner.FindSubproject(s.SubprojectId) is { } sub:
                var skipped = owner.SkipsSubprojectLevel;
                return
                [
                    new PickerRow($"n:{sub.Id ?? owner.Id}", (skipped ? owner.Name : sub.Name) + " (no task)",
                        PickerRowKind.Track, null, new StoredSelection(owner.Id, null, sub.Id)),
                    .. sub.Tasks.Select(t => new PickerRow($"t:{t.Id}", t.Name, PickerRowKind.Track, null,
                        new StoredSelection(owner.Id, t.Id, sub.Id))),
                ];
            default:
                return tree.Select(p => IsLeaf(p)
                        ? new PickerRow($"p:{p.Id}", p.Name, PickerRowKind.Track, null,
                            new StoredSelection(p.Id, null, p.Subprojects[0].Id))
                        : new PickerRow($"p:{p.Id}", p.Name, PickerRowKind.Open, Open(p), null))
                    .ToList();
        }
    }

    /// <summary>
    /// The bar above the list: "All projects / Acme / checkout". Empty at the root. A skipped
    /// subproject screen is titled with the project alone, matching <see cref="Back"/>.
    /// </summary>
    public static IReadOnlyList<PickerCrumb> Breadcrumb(PickerLevel level, IReadOnlyList<PickerProject> tree)
    {
        var root = new PickerCrumb(RootTitle, PickerLevel.Root);
        switch (Normalize(level, tree))
        {
            case PickerLevel.ProjectLevel p when tree.FirstOrDefault(x => x.Id == p.ProjectId) is { } project:
                return [root, new PickerCrumb(project.Name, p)];
            case PickerLevel.SubprojectLevel s
                when tree.FirstOrDefault(x => x.Id == s.ProjectId) is { } owner
                     && owner.FindSubproject(s.SubprojectId) is { } sub:
                if (owner.SkipsSubprojectLevel)
                {
                    return [root, new PickerCrumb(owner.Name, s)];
                }

                return [root, new PickerCrumb(owner.Name, new PickerLevel.ProjectLevel(owner.Id)), new PickerCrumb(sub.Name, s)];
            default:
                return [];
        }
    }

    /// <summary>
    /// The selection placed in the tree: its project, the subproject it belongs to (a task's own
    /// subproject wins; a missing id means the default) and its task, if still present.
    /// </summary>
    private static (PickerProject Project, PickerSubproject? Sub, PickerTask? Task)? Place(
        StoredSelection? selection, IReadOnlyList<PickerProject> tree)
    {
        if (selection is null || tree.FirstOrDefault(p => p.Id == selection.ProjectId) is not { } project)
        {
            return null;
        }

        var taskHome = selection.TaskId is null
            ? null
            : project.Subprojects.FirstOrDefault(s => s.Tasks.Any(t => t.Id == selection.TaskId));
        var sub = taskHome
                  ?? project.FindSubproject(selection.SubprojectId)
                  ?? (selection.SubprojectId is null ? project.DefaultSubproject : null);
        var task = taskHome?.Tasks.FirstOrDefault(t => t.Id == selection.TaskId);
        return (project, sub, task);
    }

    /// <summary>
    /// Whether a row lies on the path to the current selection — the project, then the subproject,
    /// then the exact choice — so every level shows where you are.
    /// </summary>
    public static bool IsOnCurrentPath(PickerRow row, StoredSelection? selection, IReadOnlyList<PickerProject> tree)
    {
        if (Place(selection, tree) is not { } placed)
        {
            return false;
        }

        return row switch
        {
            { Kind: PickerRowKind.Open, Target: PickerLevel.ProjectLevel p } => p.ProjectId == placed.Project.Id,
            // A skipped screen is opened from the project's root row: that row is the project.
            { Kind: PickerRowKind.Open, Target: PickerLevel.SubprojectLevel s } =>
                s.ProjectId == placed.Project.Id
                && (placed.Project.SkipsSubprojectLevel || s.SubprojectId == placed.Sub?.Id),
            { Kind: PickerRowKind.Track, Selection: { } target } =>
                target.ProjectId == placed.Project.Id
                && target.SubprojectId == placed.Sub?.Id
                && target.TaskId == placed.Task?.Id,
            _ => false,
        };
    }

    /// <summary>
    /// Where the picker opens: the level holding the current choice, so the first thing shown is
    /// where you are rather than the top of the list.
    /// </summary>
    public static PickerLevel Home(StoredSelection? selection, IReadOnlyList<PickerProject> tree)
    {
        if (Place(selection, tree) is not { } placed)
        {
            return PickerLevel.Root;
        }

        if (placed.Task is not null && placed.Sub is { } sub)
        {
            return Normalize(new PickerLevel.SubprojectLevel(placed.Project.Id, sub.Id), tree);
        }

        return IsLeaf(placed.Project) ? PickerLevel.Root : Open(placed.Project);
    }

    /// <summary>The "Working on" card's text. Null when there is no (resolvable) selection.</summary>
    public static PickerWorkingOn? WorkingOn(StoredSelection? selection, IReadOnlyList<PickerProject> tree)
    {
        if (Place(selection, tree) is not { } placed)
        {
            return null;
        }

        var detail = new List<string>();
        if (placed.Sub is not null && !placed.Project.SkipsSubprojectLevel)
        {
            detail.Add(placed.Sub.Name);
        }

        if (placed.Task is not null)
        {
            detail.Add(placed.Task.Name);
        }

        return new PickerWorkingOn(placed.Project.Name, detail.Count == 0 ? null : string.Join(Separator, detail));
    }
}

public static class PickerSearch
{
    public static bool IsSearching(string? query) => !string.IsNullOrWhiteSpace(query);

    /// <summary>Flat full-path results across every level (spec §2). A lone default is omitted from paths.</summary>
    public static IReadOnlyList<PickerRow> Results(string? query, IReadOnlyList<PickerProject> tree)
    {
        if (!IsSearching(query))
        {
            return [];
        }

        var q = query!.Trim();
        var rows = new List<PickerRow>();
        foreach (var project in tree)
        {
            foreach (var sub in project.Subprojects)
            {
                string[] path = project.SkipsSubprojectLevel ? [project.Name] : [project.Name, sub.Name];
                if (Matches(path, q))
                {
                    rows.Add(new PickerRow($"n:{sub.Id ?? project.Id}", string.Join(PickerNavigation.Separator, path),
                        PickerRowKind.Track, null, new StoredSelection(project.Id, null, sub.Id)));
                }

                foreach (var task in sub.Tasks)
                {
                    string[] full = [.. path, task.Name];
                    if (Matches(full, q))
                    {
                        rows.Add(new PickerRow($"t:{task.Id}", string.Join(PickerNavigation.Separator, full),
                            PickerRowKind.Track, null, new StoredSelection(project.Id, task.Id, sub.Id)));
                    }
                }
            }
        }

        return rows;
    }

    private static bool Matches(IEnumerable<string> parts, string query) =>
        parts.Any(p => p.Contains(query, StringComparison.OrdinalIgnoreCase));
}
