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

    [Fact]
    public void ProjectScreenListsBackThenSubprojects()
    {
        var rows = PickerNavigation.Rows(new PickerLevel.ProjectLevel("p1"), Tree);
        Assert.Equal(["Acme", "General", "checkout"], rows.Select(r => r.Title));
        Assert.Equal(PickerRowKind.Back, rows[0].Kind);
        Assert.Equal(PickerRowKind.Open, rows[2].Kind);
        Assert.Equal(new PickerLevel.SubprojectLevel("p1", "s2"), rows[2].Target);
    }

    [Fact]
    public void TaskScreenOfAShownSubproject()
    {
        var rows = PickerNavigation.Rows(new PickerLevel.SubprojectLevel("p1", "s2"), Tree);
        Assert.Equal(["Acme › checkout", "checkout (no task)", "Cart", "pay form"], rows.Select(r => r.Title));
        Assert.Equal(PickerRowKind.Back, rows[0].Kind);
        Assert.Equal(PickerRowKind.Track, rows[1].Kind);
        Assert.Equal(new StoredSelection("p1", null, "s2"), rows[1].Selection);
        Assert.Equal(new StoredSelection("p1", "k3", "s2"), rows[2].Selection);
    }

    [Fact]
    public void TaskScreenOfASkippedProjectIsTitledWithTheProject()
    {
        var rows = PickerNavigation.Rows(new PickerLevel.SubprojectLevel("p2", "s3"), Tree);
        Assert.Equal(["Borealis", "Borealis (no task)", "Hero copy"], rows.Select(r => r.Title));
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

    [Fact]
    public void HeaderText()
    {
        Assert.Equal("No project", PickerNavigation.HeaderText(null, Tree));
        Assert.Equal("No project", PickerNavigation.HeaderText(new StoredSelection("gone", null), Tree));
        Assert.Equal("Acme › checkout › Cart", PickerNavigation.HeaderText(new StoredSelection("p1", "k3", "s2"), Tree));
        Assert.Equal("Acme › General", PickerNavigation.HeaderText(new StoredSelection("p1", null, "s1"), Tree));
        Assert.Equal("Borealis › Hero copy", PickerNavigation.HeaderText(new StoredSelection("p2", "k4", "s3"), Tree));
        Assert.Equal("Acme › checkout", PickerNavigation.HeaderText(new StoredSelection("p1", "gone", "s2"), Tree));
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
}
