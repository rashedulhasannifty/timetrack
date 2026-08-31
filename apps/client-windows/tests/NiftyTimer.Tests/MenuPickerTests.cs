using NiftyTimer.App;
using NiftyTimer.Projects;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The picker projection. macOS gets text search for free from SwiftUI; the Windows popup used to
/// get it from the stock ComboBox, and dropping that control means the filtering has to live
/// somewhere testable rather than inside the window.
/// </summary>
public class MenuPickerTests
{
    private static IReadOnlyList<Project> Sample() =>
    [
        new Project("p1", "t1", "Apollo", false,
        [
            new ProjectTask("t1a", "p1", "Design"),
            new ProjectTask("t1b", "p1", "Build"),
        ]),
        new Project("p2", "t1", "Borealis", false, null),
    ];

    [Fact]
    public void EveryProjectContributesARowAndEachTaskAddsOneBeneathIt()
    {
        var choices = MenuViewModel.BuildChoices(Sample());

        Assert.Equal(4, choices.Count);
        Assert.Equal(new PickerItem("Apollo", null, "p1", null), choices[0]);
        Assert.Equal(new PickerItem("Apollo", "Design", "p1", "t1a"), choices[1]);
        Assert.Equal(new PickerItem("Apollo", "Build", "p1", "t1b"), choices[2]);
        Assert.Equal(new PickerItem("Borealis", null, "p2", null), choices[3]);
    }

    [Fact]
    public void AProjectWithNoTasksStillGetsItsOwnRow()
    {
        var choices = MenuViewModel.BuildChoices(Sample());

        Assert.Contains(choices, c => c.ProjectId == "p2" && c.TaskName is null);
    }

    [Fact]
    public void AnEmptyQueryReturnsEverything()
    {
        var choices = MenuViewModel.BuildChoices(Sample());

        Assert.Equal(choices, MenuViewModel.Filter(choices, string.Empty));
        Assert.Equal(choices, MenuViewModel.Filter(choices, null));
        Assert.Equal(choices, MenuViewModel.Filter(choices, "   "));
    }

    [Fact]
    public void TheQueryMatchesProjectNames()
    {
        var choices = MenuViewModel.BuildChoices(Sample());

        var matched = MenuViewModel.Filter(choices, "borea");

        Assert.Single(matched);
        Assert.Equal("Borealis", matched[0].ProjectName);
    }

    [Fact]
    public void TheQueryAlsoMatchesTaskNames()
    {
        var choices = MenuViewModel.BuildChoices(Sample());

        var matched = MenuViewModel.Filter(choices, "design");

        Assert.Single(matched);
        Assert.Equal("Design", matched[0].TaskName);
    }

    [Fact]
    public void MatchingIsCaseInsensitive()
    {
        var choices = MenuViewModel.BuildChoices(Sample());

        Assert.Equal(3, MenuViewModel.Filter(choices, "APOLLO").Count);
    }

    [Fact]
    public void SurroundingWhitespaceIsIgnored()
    {
        var choices = MenuViewModel.BuildChoices(Sample());

        Assert.Single(MenuViewModel.Filter(choices, "  borealis  "));
    }

    [Fact]
    public void NoMatchReturnsEmptyRatherThanEverything()
    {
        var choices = MenuViewModel.BuildChoices(Sample());

        Assert.Empty(MenuViewModel.Filter(choices, "zzz"));
    }

    [Fact]
    public void SettingTheQueryRepublishesTheFilteredList()
    {
        var viewModel = TestMenu.Build();
        viewModel.Projects = Sample();
        var raised = new List<string>();
        viewModel.PropertyChanged += (_, e) => raised.Add(e.PropertyName!);

        viewModel.Query = "borea";

        Assert.Contains(nameof(MenuViewModel.FilteredChoices), raised);
        Assert.Single(viewModel.FilteredChoices);
    }

    [Fact]
    public void LoadingProjectsRepublishesTheFilteredList()
    {
        var viewModel = TestMenu.Build();
        var raised = new List<string>();
        viewModel.PropertyChanged += (_, e) => raised.Add(e.PropertyName!);

        viewModel.Projects = Sample();

        Assert.Contains(nameof(MenuViewModel.FilteredChoices), raised);
        Assert.Equal(4, viewModel.FilteredChoices.Count);
    }

    /// <summary>
    /// The checkmark reads from the FULL list, not the filtered one: a selection the current query
    /// hides is still the selection, and losing it here would let a keystroke in the search box
    /// look like the project had been silently deselected.
    /// </summary>
    [Fact]
    public void TheSelectedChoiceSurvivesAQueryThatFiltersItOut()
    {
        var viewModel = TestMenu.Build();
        viewModel.Projects = Sample();
        viewModel.SelectProject("p1", "t1a");

        viewModel.Query = "borealis";

        Assert.NotNull(viewModel.SelectedChoice);
        Assert.Equal("Design", viewModel.SelectedChoice!.TaskName);
        Assert.DoesNotContain(viewModel.FilteredChoices, c => c.TaskId == "t1a");
    }

    [Fact]
    public void NothingSelectedMeansNoSelectedChoice()
    {
        var viewModel = TestMenu.Build();
        viewModel.Projects = Sample();

        Assert.Null(viewModel.SelectedChoice);
    }
}
