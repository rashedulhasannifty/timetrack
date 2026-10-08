using NiftyTimer.Projects;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The UI-free picker core, ported from the macOS client's PickerCoreTests.swift: the same
/// fixtures, inputs and expected titles. The C# <see cref="StoredSelection"/> argument order is
/// (ProjectId, TaskId, SubprojectId), which differs from the Swift labels.
/// </summary>
public class PickerCoreTests
{
    // Acme: General + checkout (two subprojects, so the subproject level is shown).
    // Borealis: only General (skips the subproject level).
    // Legacy: a cache written before subprojects existed (implicit default, id null).
    internal static readonly IReadOnlyList<Project> Projects =
    [
        new Project("p1", "t", "Acme", false,
            [new ProjectTask("k2", "p1", "pay form", "s2"), new ProjectTask("k1", "p1", "Audit", "s1"), new ProjectTask("k3", "p1", "Cart", "s2")],
            [new Subproject("s2", "p1", "checkout", false, false), new Subproject("s1", "p1", "General", false, true)]),
        new Project("p2", "t", "Borealis", false,
            [new ProjectTask("k4", "p2", "Hero copy", "s3")],
            [new Subproject("s3", "p2", "General", false, true)]),
        new Project("p3", "t", "Legacy", false, [new ProjectTask("k5", "p3", "Old task")]),
    ];

    private static IReadOnlyList<PickerProject> Tree => PickerTree.Build(Projects);

    // tree

    [Fact]
    public void OrdersSubprojectsDefaultFirstThenByNameAndTasksByName()
    {
        var acme = Tree[0];
        Assert.Equal(["s1", "s2"], acme.Subprojects.Select(s => s.Id));
        Assert.Equal(["Cart", "pay form"], acme.Subprojects[1].Tasks.Select(t => t.Name));
        Assert.Equal(["k1"], acme.Subprojects[0].Tasks.Select(t => t.Id));
    }

    [Fact]
    public void SkipsTheSubprojectLevelOnlyWhenTheDefaultIsAlone()
    {
        Assert.False(Tree[0].SkipsSubprojectLevel);
        Assert.True(Tree[1].SkipsSubprojectLevel);
    }

    [Fact]
    public void ALegacyCacheProjectBecomesOneImplicitDefaultHoldingEveryTask()
    {
        var legacy = Tree[2];
        Assert.True(legacy.SkipsSubprojectLevel);
        Assert.Null(legacy.Subprojects[0].Id);
        Assert.Equal(["k5"], legacy.Subprojects[0].Tasks.Select(t => t.Id));
    }

    [Fact]
    public void ArchivedProjectsAndSubprojectsAreAbsentAndTheirTasksDropped()
    {
        IReadOnlyList<Project> withArchived =
        [
            new Project("px", "t", "Gone", true, null),
            new Project("p1", "t", "Acme", false,
                [new ProjectTask("k9", "p1", "Hidden", "s9")],
                [new Subproject("s1", "p1", "General", false, true), new Subproject("s9", "p1", "Old", true, false)]),
        ];
        var built = PickerTree.Build(withArchived);
        Assert.Equal(["p1"], built.Select(p => p.Id));
        Assert.Equal(["s1"], built[0].Subprojects.Select(s => s.Id));
        Assert.Empty(built[0].Subprojects[0].Tasks);
    }

    // navigation

    [Fact]
    public void RootRowsOpenEachProjectAtTheRightLevel()
    {
        var rows = PickerNavigation.Rows(PickerLevel.Root, Tree);
        Assert.Equal(["Acme", "Borealis", "Legacy"], rows.Select(r => r.Title));
        Assert.Equal(PickerRowKind.Open, rows[0].Kind);
        Assert.Equal(new PickerLevel.ProjectLevel("p1"), rows[0].Target);
        Assert.Equal(new PickerLevel.SubprojectLevel("p2", "s3"), rows[1].Target);
    }

    // Back is the breadcrumb bar now, not a row that looks like something to pick.
    [Fact]
    public void ProjectScreenListsOnlySubprojects()
    {
        var rows = PickerNavigation.Rows(new PickerLevel.ProjectLevel("p1"), Tree);
        Assert.Equal(["General", "checkout"], rows.Select(r => r.Title));
        Assert.Equal(PickerRowKind.Open, rows[1].Kind);
        Assert.Equal(new PickerLevel.SubprojectLevel("p1", "s2"), rows[1].Target);
    }

    [Fact]
    public void TaskScreenOfAShownSubproject()
    {
        var rows = PickerNavigation.Rows(new PickerLevel.SubprojectLevel("p1", "s2"), Tree);
        Assert.Equal(["checkout (no task)", "Cart", "pay form"], rows.Select(r => r.Title));
        Assert.Equal(PickerRowKind.Track, rows[0].Kind);
        Assert.Equal(new StoredSelection("p1", null, "s2"), rows[0].Selection);
        Assert.Equal(new StoredSelection("p1", "k3", "s2"), rows[1].Selection);
    }

    [Fact]
    public void TaskScreenOfASkippedProjectIsTitledWithTheProject()
    {
        var rows = PickerNavigation.Rows(new PickerLevel.SubprojectLevel("p2", "s3"), Tree);
        Assert.Equal(["Borealis (no task)", "Hero copy"], rows.Select(r => r.Title));
    }

    [Fact]
    public void BackGoesUpOneLevelAndSkipsTheOmittedScreen()
    {
        Assert.Equal(new PickerLevel.ProjectLevel("p1"), PickerNavigation.Back(new PickerLevel.SubprojectLevel("p1", "s2"), Tree));
        Assert.Equal(PickerLevel.Root, PickerNavigation.Back(new PickerLevel.SubprojectLevel("p2", "s3"), Tree));
        Assert.Equal(PickerLevel.Root, PickerNavigation.Back(new PickerLevel.ProjectLevel("p1"), Tree));
        Assert.Equal(PickerLevel.Root, PickerNavigation.Back(PickerLevel.Root, Tree));
    }

    [Fact]
    public void ALevelARefreshRemovedFallsBackToAValidOne()
    {
        Assert.Equal(PickerLevel.Root, PickerNavigation.Normalize(new PickerLevel.ProjectLevel("gone"), Tree));
        Assert.Equal(
            new PickerLevel.ProjectLevel("p1"),
            PickerNavigation.Normalize(new PickerLevel.SubprojectLevel("p1", "gone"), Tree));
        Assert.Equal(
            new PickerLevel.SubprojectLevel("p2", "s3"),
            PickerNavigation.Normalize(new PickerLevel.ProjectLevel("p2"), Tree));
        Assert.Equal(
            ["Acme", "Borealis", "Legacy"],
            PickerNavigation.Rows(new PickerLevel.ProjectLevel("gone"), Tree).Select(r => r.Title));
    }

    // task-free projects (what production has: work types, no tasks)

    // Energy: two subprojects, no tasks. Solo: only its default, no tasks.
    private static readonly IReadOnlyList<Project> TaskFreeProjects =
    [
        new Project("e1", "t", "Energy", false, [],
            [new Subproject("d1", "e1", "General", false, true), new Subproject("d2", "e1", "Software", false, false)]),
        new Project("o1", "t", "Solo", false, [], [new Subproject("d3", "o1", "General", false, true)]),
    ];

    private static IReadOnlyList<PickerProject> FreeTree => PickerTree.Build(TaskFreeProjects);

    // A subproject with nothing under it is the choice itself: one click, not a screen whose only
    // useful row is "(no task)".
    [Fact]
    public void ASubprojectWithoutTasksIsPickedInOneClick()
    {
        var rows = PickerNavigation.Rows(new PickerLevel.ProjectLevel("e1"), FreeTree);
        Assert.Equal(["General", "Software"], rows.Select(r => r.Title));
        Assert.Equal(PickerRowKind.Track, rows[1].Kind);
        Assert.Equal(new StoredSelection("e1", null, "d2"), rows[1].Selection);
    }

    [Fact]
    public void AProjectWithOnlyItsDefaultAndNoTasksIsPickedFromTheRoot()
    {
        var rows = PickerNavigation.Rows(PickerLevel.Root, FreeTree);
        Assert.Equal(PickerRowKind.Open, rows[0].Kind);
        Assert.Equal(new PickerLevel.ProjectLevel("e1"), rows[0].Target);
        Assert.Equal(PickerRowKind.Track, rows[1].Kind);
        Assert.Equal(new StoredSelection("o1", null, "d3"), rows[1].Selection);
    }

    // breadcrumb

    [Fact]
    public void BreadcrumbNamesEachLevelAndSkipsTheOmittedScreen()
    {
        var root = new PickerCrumb("All projects", PickerLevel.Root);
        Assert.Empty(PickerNavigation.Breadcrumb(PickerLevel.Root, Tree));
        Assert.Equal(
            [root, new PickerCrumb("Acme", new PickerLevel.ProjectLevel("p1"))],
            PickerNavigation.Breadcrumb(new PickerLevel.ProjectLevel("p1"), Tree));
        Assert.Equal(
            [root, new PickerCrumb("Acme", new PickerLevel.ProjectLevel("p1")),
                new PickerCrumb("checkout", new PickerLevel.SubprojectLevel("p1", "s2"))],
            PickerNavigation.Breadcrumb(new PickerLevel.SubprojectLevel("p1", "s2"), Tree));
        Assert.Equal(
            [root, new PickerCrumb("Borealis", new PickerLevel.SubprojectLevel("p2", "s3"))],
            PickerNavigation.Breadcrumb(new PickerLevel.SubprojectLevel("p2", "s3"), Tree));
    }

    // where you are

    [Fact]
    public void TheCurrentPathIsMarkedAtEveryLevel()
    {
        var sel = new StoredSelection("e1", null, "d2");
        var root = PickerNavigation.Rows(PickerLevel.Root, FreeTree);
        Assert.Equal([true, false], root.Select(r => PickerNavigation.IsOnCurrentPath(r, sel, FreeTree)));
        var subs = PickerNavigation.Rows(new PickerLevel.ProjectLevel("e1"), FreeTree);
        Assert.Equal([false, true], subs.Select(r => PickerNavigation.IsOnCurrentPath(r, sel, FreeTree)));
        Assert.False(PickerNavigation.IsOnCurrentPath(root[0], null, FreeTree));
    }

    // A task sits under its subproject: that subproject row (which opens the tasks) is on the path.
    [Fact]
    public void ATaskSelectionMarksItsSubprojectAndTheTask()
    {
        var sel = new StoredSelection("p1", "k3", "s2");
        var subs = PickerNavigation.Rows(new PickerLevel.ProjectLevel("p1"), Tree);
        Assert.Equal([false, true], subs.Select(r => PickerNavigation.IsOnCurrentPath(r, sel, Tree)));
        var tasks = PickerNavigation.Rows(new PickerLevel.SubprojectLevel("p1", "s2"), Tree);
        Assert.Equal([false, true, false], tasks.Select(r => PickerNavigation.IsOnCurrentPath(r, sel, Tree)));
    }

    // A selection stored without a subproject means the project's default.
    [Fact]
    public void ASelectionWithoutASubprojectMeansTheDefault()
    {
        var sel = new StoredSelection("e1", null);
        var subs = PickerNavigation.Rows(new PickerLevel.ProjectLevel("e1"), FreeTree);
        Assert.Equal([true, false], subs.Select(r => PickerNavigation.IsOnCurrentPath(r, sel, FreeTree)));
    }

    [Fact]
    public void ThePickerOpensWhereTheSelectionIs()
    {
        Assert.Equal(PickerLevel.Root, PickerNavigation.Home(null, Tree));
        Assert.Equal(PickerLevel.Root, PickerNavigation.Home(new StoredSelection("gone", null), Tree));
        Assert.Equal(new PickerLevel.ProjectLevel("e1"), PickerNavigation.Home(new StoredSelection("e1", null, "d2"), FreeTree));
        // Nothing to show below a lone-default project without tasks: the root is where it is picked.
        Assert.Equal(PickerLevel.Root, PickerNavigation.Home(new StoredSelection("o1", null, "d3"), FreeTree));
        Assert.Equal(
            new PickerLevel.SubprojectLevel("p1", "s2"),
            PickerNavigation.Home(new StoredSelection("p1", "k3", "s2"), Tree));
    }

    [Fact]
    public void WorkingOnSplitsTheProjectFromWhatIsUnderIt()
    {
        Assert.Null(PickerNavigation.WorkingOn(null, Tree));
        Assert.Null(PickerNavigation.WorkingOn(new StoredSelection("gone", null), Tree));
        Assert.Equal(new PickerWorkingOn("Energy", "Software"),
            PickerNavigation.WorkingOn(new StoredSelection("e1", null, "d2"), FreeTree));
        Assert.Equal(new PickerWorkingOn("Acme", "checkout › Cart"),
            PickerNavigation.WorkingOn(new StoredSelection("p1", "k3", "s2"), Tree));
        Assert.Equal(new PickerWorkingOn("Solo", null),
            PickerNavigation.WorkingOn(new StoredSelection("o1", null, "d3"), FreeTree));
        // A task deleted since it was picked: the subproject still names the place.
        Assert.Equal(new PickerWorkingOn("Acme", "checkout"),
            PickerNavigation.WorkingOn(new StoredSelection("p1", "gone", "s2"), Tree));
    }

    // search

    [Fact]
    public void SearchListsFullPathsAndOmitsALoneDefault()
    {
        var titles = PickerSearch.Results("o", Tree).Select(r => r.Title).ToList();
        Assert.Contains("Acme › checkout", titles);
        Assert.Contains("Acme › checkout › Cart", titles);
        Assert.Contains("Borealis", titles);
        Assert.Contains("Borealis › Hero copy", titles);
        Assert.DoesNotContain(titles, t => t.Contains("Borealis › General"));
    }

    [Fact]
    public void SearchIsCaseInsensitiveTrimmedAndMatchesAnyComponent()
    {
        var rows = PickerSearch.Results("  PAY ", Tree);
        Assert.Equal(["Acme › checkout › pay form"], rows.Select(r => r.Title));
        Assert.Equal(PickerRowKind.Track, rows[0].Kind);
        Assert.Equal(new StoredSelection("p1", "k2", "s2"), rows[0].Selection);
        Assert.Equal(
            ["Acme › checkout", "Acme › checkout › Cart", "Acme › checkout › pay form"],
            PickerSearch.Results("checkout", Tree).Select(r => r.Title));
    }

    [Fact]
    public void ABlankQueryIsNotSearching()
    {
        Assert.False(PickerSearch.IsSearching("   "));
        Assert.False(PickerSearch.IsSearching(null));
        Assert.Empty(PickerSearch.Results(" ", Tree));
        Assert.True(PickerSearch.IsSearching("a"));
    }

    [Fact]
    public void ALegacyProjectSearchResultSendsANullSubproject()
    {
        var rows = PickerSearch.Results("old task", Tree);
        Assert.Equal(["Legacy › Old task"], rows.Select(r => r.Title));
        Assert.Equal(new StoredSelection("p3", "k5", null), rows[0].Selection);
    }
}

/// <summary>The unified stale-resolution table (spec §4), ported from SelectionResolverTests.swift.</summary>
public class SelectionResolverTableTests
{
    private static readonly IReadOnlyList<Project> Projects =
    [
        new Project("p1", "t", "Acme", false,
            [new ProjectTask("k1", "p1", "Build", "s2")],
            [
                new Subproject("s1", "p1", "General", false, true),
                new Subproject("s2", "p1", "Checkout", false, false),
                new Subproject("s3", "p1", "Other", false, false),
            ]),
        new Project("p2", "t", "Archived", true, null),
        new Project("p3", "t", "Legacy", false, null),
    ];

    private static StoredSelection? Resolve(StoredSelection? selection) => SelectionResolver.Resolve(selection, Projects);

    [Fact]
    public void NothingDisappearedKeepsTheSelection()
    {
        Assert.Equal(new StoredSelection("p1", "k1", "s2"), Resolve(new StoredSelection("p1", "k1", "s2")));
        Assert.Equal(new StoredSelection("p1", null, "s3"), Resolve(new StoredSelection("p1", null, "s3")));
    }

    [Fact]
    public void TaskGoneKeepsTheSubproject() =>
        Assert.Equal(new StoredSelection("p1", null, "s3"), Resolve(new StoredSelection("p1", "gone", "s3")));

    [Fact]
    public void SubprojectGoneFallsBackToTheDefault() =>
        Assert.Equal(new StoredSelection("p1", null, "s1"), Resolve(new StoredSelection("p1", null, "gone")));

    [Fact]
    public void ProjectGoneOrArchivedClearsTheSelection()
    {
        Assert.Null(Resolve(new StoredSelection("gone", null)));
        Assert.Null(Resolve(new StoredSelection("p2", null)));
        Assert.Null(Resolve(null));
    }

    /// <summary>Upgrade rule: a 0.2.x selection has no subprojectId.</summary>
    [Fact]
    public void UpgradesAnOldSelectionFromItsTaskOrTheDefault()
    {
        Assert.Equal(new StoredSelection("p1", "k1", "s2"), Resolve(new StoredSelection("p1", "k1")));
        Assert.Equal(new StoredSelection("p1", null, "s1"), Resolve(new StoredSelection("p1", null)));
    }

    /// <summary>Ruling 1: the task's CURRENT subproject wins over a stale stored one.</summary>
    [Fact]
    public void AMovedTaskResolvesToItsNewSubproject() =>
        Assert.Equal(new StoredSelection("p1", "k1", "s2"), Resolve(new StoredSelection("p1", "k1", "s3")));

    [Fact]
    public void ALegacyCacheProjectResolvesWithANullSubproject() =>
        Assert.Equal(new StoredSelection("p3", null, null), Resolve(new StoredSelection("p3", null, "s9")));

    // admin team grouping

    // Own team t1 ("Design"): Acme (home), Shared (home t3, shared into t1).
    // Others: Initech (t2 "Engineering"), Umbrella (t3 "Accounts"), Zed (t2).
    private static readonly IReadOnlyList<Project> TeamProjects =
    [
        new Project("a", "t1", "Acme", false, null, null, "Design", ["t1"]),
        new Project("i", "t2", "Initech", false, null, null, "Engineering", ["t2"]),
        new Project("s", "t3", "Shared", false, null, null, "Accounts", ["t3", "t1"]),
        new Project("u", "t3", "Umbrella", false, null, null, "Accounts", ["t3"]),
        new Project("z", "t2", "Zed", false, null, null, "Engineering", ["t2"]),
    ];

    private static readonly PickerViewer Admin = new("ADMIN", "t1");

    private static IReadOnlyList<PickerRow> GroupedRoot(IReadOnlyList<Project> projects, PickerViewer? viewer) =>
        PickerTeams.Group(PickerNavigation.Rows(PickerLevel.Root, PickerTree.Build(projects)),
            PickerTeams.Sections(projects, viewer));

    [Fact]
    public void AnAdminSeesOwnTeamFirstIncludingSharedInThenOtherTeamsAToZ()
    {
        var rows = GroupedRoot(TeamProjects, Admin);
        Assert.Equal(["Acme", "Shared", "Umbrella", "Initech", "Zed"], rows.Select(r => r.Title));
        Assert.Equal(
            ["My team (Design)", "My team (Design)", "Accounts", "Engineering", "Engineering"],
            rows.Select(r => r.Section));
    }

    [Fact]
    public void AClientSharedBetweenTwoOtherTeamsAppearsOnceUnderItsHomeTeam()
    {
        IReadOnlyList<Project> projects = [new Project("x", "t2", "X", false, null, null, "Engineering", ["t2", "t3"])];
        Assert.Equal(["Engineering"], GroupedRoot(projects, Admin).Select(r => r.Section));
    }

    [Fact]
    public void NonAdminsGetTheUnchangedFlatList()
    {
        foreach (var viewer in new PickerViewer?[] { new("EMPLOYEE", "t1"), new("MANAGER", "t1"), null })
        {
            var rows = GroupedRoot(TeamProjects, viewer);
            Assert.Equal(PickerNavigation.Rows(PickerLevel.Root, PickerTree.Build(TeamProjects)), rows);
            Assert.All(rows, r => Assert.Null(r.Section));
        }
    }

    [Fact]
    public void MissingTeamNamesAndTeamIdsFallBack()
    {
        // An old cache or an API without teamName/teamIds.
        IReadOnlyList<Project> projects =
        [
            new Project("a", "t1", "Acme", false, null),
            new Project("i", "t2", "Initech", false, null),
        ];
        Assert.Equal(["My team", "Other team"], GroupedRoot(projects, Admin).Select(r => r.Section));
    }

    [Fact]
    public void SearchResultsAreGroupedTheSameWay()
    {
        var tree = PickerTree.Build(TeamProjects);
        var rows = PickerTeams.Group(PickerSearch.Results("a", tree), PickerTeams.Sections(TeamProjects, Admin));
        // "a" matches Acme, Shared, Umbrella; Initech and Zed don't, so Engineering has no header.
        Assert.Equal(["Acme", "Shared", "Umbrella"], rows.Select(r => r.Title));
        Assert.Equal(["My team (Design)", "My team (Design)", "Accounts"], rows.Select(r => r.Section));
    }

    [Fact]
    public void AHeaderStartsWhereTheSectionChanges()
    {
        var rows = GroupedRoot(TeamProjects, Admin);
        Assert.Equal(
            [true, false, true, true, false],
            Enumerable.Range(0, rows.Count).Select(i => PickerTeams.StartsSection(rows, i)));
        var flat = GroupedRoot(TeamProjects, null);
        Assert.DoesNotContain(Enumerable.Range(0, flat.Count), i => PickerTeams.StartsSection(flat, i));
    }
}
