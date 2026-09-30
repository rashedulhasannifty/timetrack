using System.Text.Json;
using NiftyTimer.App;
using NiftyTimer.Projects;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The picker as the view model drives it: drill-down, search, and what each selection sends.
/// Ported from the macOS MenuViewModelTests; the pure rows and titles are covered by
/// <see cref="PickerCoreTests"/>. Every pass-through test uses a NON-default subproject with no
/// task, the one case the server cannot re-derive from a task.
/// </summary>
public class MenuPickerTests
{
    // Acme has a second subproject (subproject screen shown); Beta has only its default (skipped).
    private static readonly IReadOnlyList<Project> Tree =
    [
        new Project("p1", "t1", "Acme", false,
            [new ProjectTask("k1", "p1", "Cart", "s2")],
            [new Subproject("s1", "p1", "General", false, true), new Subproject("s2", "p1", "Checkout", false, false)]),
        new Project("p2", "t1", "Beta", false, null, [new Subproject("s3", "p2", "General", false, true)]),
    ];

    private static MenuViewModel NewViewModel(out BufferSpy buffer, SelectionStore? store = null)
    {
        buffer = new BufferSpy();
        var tracker = new TimeTracker(buffer, () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
        return new MenuViewModel(tracker, store ?? new SelectionStore(new InMemoryUserSettings()));
    }

    private static TimeEntryPayload Decode(BufferSpy buffer, int index) =>
        JsonSerializer.Deserialize<TimeEntryPayload>(buffer.Entries[index].Payload)!;

    [Fact]
    public void DrillingDownAndTrackingASubprojectWithNoTask()
    {
        var vm = NewViewModel(out var buffer);
        vm.IsReady = true;
        vm.Projects = Tree;
        vm.Activate(vm.PickerRows[0]); // Acme → subproject screen
        Assert.Equal(new PickerLevel.ProjectLevel("p1"), vm.Level);
        vm.Activate(vm.PickerRows.First(r => r.Title == "Checkout")); // has a task → opens
        Assert.Equal(["Checkout (no task)", "Cart"], vm.PickerRows.Select(r => r.Title));
        Assert.Equal(["All projects", "Acme", "Checkout"], vm.Breadcrumb.Select(c => c.Title));
        vm.Activate(vm.PickerRows[0]); // track Checkout, no task

        Assert.Equal(new StoredSelection("p1", null, "s2"), vm.Selection);
        Assert.True(vm.PickerRows[0].IsCurrent);
        Assert.Equal(new PickerWorkingOn("Acme", "Checkout"), vm.WorkingOn);

        vm.Start();
        vm.Stop();
        var payload = Decode(buffer, 0);
        Assert.Equal("s2", payload.SubprojectId);
        Assert.Null(payload.TaskId);
    }

    [Fact]
    public void AProjectWithOnlyGeneralAndNoTasksIsPickedFromTheRoot()
    {
        var vm = NewViewModel(out _);
        vm.Projects = Tree;
        vm.Activate(vm.PickerRows[1]); // Beta — nothing below it
        Assert.Equal(PickerLevel.Root, vm.Level);
        Assert.Equal(new StoredSelection("p2", null, "s3"), vm.Selection);
        Assert.Equal(new PickerWorkingOn("Beta", null), vm.WorkingOn);
    }

    [Fact]
    public void TheBreadcrumbAndBackGoUp()
    {
        var vm = NewViewModel(out _);
        vm.Projects = Tree;
        vm.Activate(vm.PickerRows[0]); // Acme
        vm.Activate(vm.PickerRows.First(r => r.Title == "Checkout"));
        vm.Navigate(vm.Breadcrumb[1].Level); // "Acme"
        Assert.Equal(new PickerLevel.ProjectLevel("p1"), vm.Level);
        Assert.True(vm.Back());
        Assert.Equal(PickerLevel.Root, vm.Level);
        Assert.Empty(vm.Breadcrumb);
    }

    [Fact]
    public void RowsOnTheCurrentPathAreMarkedAndOnlyTheChoiceIsChecked()
    {
        var vm = NewViewModel(out _);
        vm.Projects = Tree;
        vm.SelectProject(new StoredSelection("p1", null, "s1"));
        Assert.Equal(["Acme"], vm.PickerRows.Where(r => r.IsOnPath).Select(r => r.Title));
        Assert.DoesNotContain(vm.PickerRows, r => r.IsCurrent); // Acme opens a level: no checkmark
        vm.Activate(vm.PickerRows[0]);
        Assert.Equal(["General"], vm.PickerRows.Where(r => r.IsCurrent).Select(r => r.Title));
    }

    [Fact]
    public void SearchTracksAResultImmediatelyAndClearingRestoresTheLevel()
    {
        var vm = NewViewModel(out _);
        vm.Projects = Tree;
        vm.Activate(vm.PickerRows[0]); // at Acme's subproject screen
        vm.Query = "cart";
        Assert.Equal(["Acme › Checkout › Cart"], vm.PickerRows.Select(r => r.Title));
        vm.Activate(vm.PickerRows[0]);
        Assert.Equal(new StoredSelection("p1", "k1", "s2"), vm.Selection);
        vm.Query = string.Empty;
        Assert.Equal(new PickerLevel.ProjectLevel("p1"), vm.Level);
    }

    [Fact]
    public void SwitchingWhileTrackingRefilesUnderTheNewSubproject()
    {
        var vm = NewViewModel(out var buffer);
        vm.IsReady = true;
        vm.Projects = Tree;
        vm.SelectProject(new StoredSelection("p1", null, "s1"));
        vm.Start();
        vm.SelectProject(new StoredSelection("p1", null, "s2"));
        vm.Stop();

        Assert.Equal("s1", Decode(buffer, 0).SubprojectId);
        Assert.Equal("s2", Decode(buffer, 1).SubprojectId);
    }

    [Fact]
    public void SwitchingWhilePausedResumesUnderTheNewSubproject()
    {
        var vm = NewViewModel(out var buffer);
        vm.IsReady = true;
        vm.Projects = Tree;
        vm.SelectProject(new StoredSelection("p1", null, "s1"));
        vm.Start();
        vm.Pause();
        vm.SelectProject(new StoredSelection("p1", null, "s2"));
        vm.Resume();
        vm.Stop();

        Assert.Equal("s2", Decode(buffer, 1).SubprojectId);
    }

    [Fact]
    public void AutoSelectionCarriesTheSubproject()
    {
        var vm = NewViewModel(out _);
        vm.SelectProject(new StoredSelection("p1", null, "s2"));

        Assert.Equal(new TimeTracker.Selection("p1", null, SubprojectId: "s2"), vm.SelectionForAuto);
    }

    [Fact]
    public void ReopeningShowsWhereTheSelectionIsAndSignOutClearsTheLevel()
    {
        var vm = NewViewModel(out _);
        vm.Projects = Tree;
        vm.Activate(vm.PickerRows[0]);
        vm.ResetPicker();
        Assert.Equal(PickerLevel.Root, vm.Level); // nothing selected yet: the top of the list
        vm.SelectProject(new StoredSelection("p1", null, "s2"));
        vm.Navigate(PickerLevel.Root);
        vm.ResetPicker();
        Assert.Equal(new PickerLevel.ProjectLevel("p1"), vm.Level); // opens at the chosen project
        vm.Activate(vm.PickerRows[0]);
        vm.Reset();
        Assert.Equal(PickerLevel.Root, vm.Level);
        Assert.Null(vm.Selection);
    }

    [Fact]
    public void RestoreUpgradesAnOldStoredSelectionToTheDefaultSubproject()
    {
        var store = new SelectionStore(new InMemoryUserSettings());
        store.Save(new StoredSelection("p1", null), "u1");
        var vm = NewViewModel(out _, store);
        vm.Projects = Tree;

        vm.RestoreSelection("u1");

        Assert.Equal(new StoredSelection("p1", null, "s1"), vm.Selection);
    }

    [Fact]
    public void BackAtTheRootReportsThatThereIsNowhereToGo()
    {
        var vm = new MenuViewModel(new TimeTracker(new BufferSpy()), new SelectionStore(new InMemoryUserSettings()));
        Assert.False(vm.Back());
    }

    [Fact]
    public void DrillingRaisesPickerRowsSoThePopupRerenders()
    {
        var vm = new MenuViewModel(new TimeTracker(new BufferSpy()), new SelectionStore(new InMemoryUserSettings()))
        {
            Projects = PickerCoreTests.Projects,
        };
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);
        vm.Activate(vm.PickerRows[0]);
        Assert.Contains(nameof(MenuViewModel.PickerRows), raised);
    }

    [Fact]
    public void OnlyTheCurrentTrackRowIsMarkedCurrent()
    {
        var vm = new MenuViewModel(new TimeTracker(new BufferSpy()), new SelectionStore(new InMemoryUserSettings()))
        {
            Projects = PickerCoreTests.Projects,
        };
        vm.SelectProject(new StoredSelection("p2", null, "s3"));
        vm.Activate(vm.PickerRows[1]); // Borealis → its tasks
        Assert.Equal(["Borealis (no task)"], vm.PickerRows.Where(r => r.IsCurrent).Select(r => r.Title));
    }
}
