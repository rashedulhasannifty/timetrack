# Windows client visual pass — PR 2: `TrayPopupWindow` structural parity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the structure of the macOS menu-bar dropdown onto `TrayPopupWindow` — status dot, hero elapsed timer, captioned totals, a searchable two-line project list, glyph buttons and the brand mark — on top of PR 1's token and control layer.

**Architecture:** The window keeps its existing imperative `Render()` push; PR 2 is structural parity, not an MVVM migration. The picker's _data_ moves to `MenuViewModel` as a testable filtered projection, and the XAML swaps the stock `ComboBox` for a `TextBox` + `ListBox` with an `ItemTemplate`. Code-behind still assigns `ItemsSource` from the view model, matching how every other element in this file is already fed. The brand mark and the play/pause/stop glyphs are drawn as XAML geometry rather than loaded from the `.ico` or an icon font.

**Tech Stack:** C# 13 / .NET 9, WPF, xUnit. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-windows-client-visual-parity-design.md` (§ "PR 2 — `TrayPopupWindow` structural parity")

## Global Constraints

- **`NoticeLabel` stays visible.** The monitoring notice is never collapsible, never behind a disclosure, never truncated behind a tooltip (CLAUDE.md §1). Its existing `Visibility="Collapsed"` default is _content absence_ — there is nothing to say — not a dismiss affordance. Restructuring must not add one.
- **Unknown totals stay `"—"`.** `MenuViewModel.cs:176-180` returns an em dash rather than a confident zero. The spec says explicitly: already correct, do not "fix". Only the rendering changes.
- **Live-ticking totals are out of scope.** macOS adds elapsed-since-fetch on top of the server figure; Windows refreshes on menu open. That is a behavioural gap, not a visual one. `MenuViewModel.Tick()` raises `ElapsedLabel` and `Elapsed` only — do not add the totals to it.
- **No new dependency without asking** (CLAUDE.md §2).
- **`TreatWarningsAsErrors` is on** — `dotnet build NiftyTimer.sln -c Release` is also the lint gate. Zero warnings.
- **Themed brushes are reached with `{DynamicResource}`, never `{StaticResource}`.** `ThemeSweepTests` enforces this over the 16 roles in `Theme.Light.xaml`. Style keys (`CaptionText`, `ProminentButton`, …) are not themed roles and stay `{StaticResource}`.
- **Any new `.xaml` file under `UI/` must be added to `ThemeSweepTests`' `[InlineData]` list** in the same task that creates it.
- **Commits carry no AI attribution** — no co-author trailer, no generated-by footer, no mention of an assistant in the message or branch name (CLAUDE.md §0). Conventional Commits, scope `client`.

### Rulings made while writing this plan

| #   | Question the spec left open                                                                                    | Ruling                                                                                                                                                                                                | Cost if wrong                                                             |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| R1  | "The XAML binds a list rather than an items-source" — full `DataContext` binding, or keep the imperative push? | Keep the imperative push. `ListBox.ItemsSource` is assigned in `RenderPicker()` exactly as today; only the control and its `ItemTemplate` change.                                                     | A later MVVM migration touches this file again. Cheap — it is one method. |
| R2  | Where does the picker row type live, now that `MenuViewModel` must project it?                                 | Move `PickerItem` from `NiftyTimer.UI` (`TrayPopupWindow.xaml.cs:13`) to `NiftyTimer.App`, beside `MenuViewModel`, with separate `ProjectName` / `TaskName` fields.                                   | A namespace churn in one more file.                                       |
| R3  | Play/pause/stop glyphs — Segoe Fluent Icons / Segoe MDL2 Assets, or drawn?                                     | Drawn as XAML `Path` geometry. Windows 10 ships MDL2 and Windows 11 ships Fluent under different names, and a missing glyph renders as a box. Same reasoning the spec already applies to `BrandMark`. | Slightly more XAML than a font glyph.                                     |
| R4  | Popup width — macOS is 340, Windows is 320; the spec's table does not say.                                     | 340, for parity.                                                                                                                                                                                      | A 20px difference, trivially reversible.                                  |
| R5  | Status dot colour — `Accent` or `Recording`?                                                                   | `Recording`. It is the semantically correct role and exists in both themes.                                                                                                                           | None; identical to `Accent` in light.                                     |

---

## File Structure

| File                                              | Responsibility                                                                                         | Task |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---- |
| `src/NiftyTimer/App/PickerItem.cs`                | **Create.** One selectable project/task row. Moved out of the window so the view model can project it. | 1    |
| `src/NiftyTimer/App/MenuViewModel.cs`             | **Modify.** Adds `Query`, `Choices`, `FilteredChoices`, `SelectedChoice` and the two static helpers.   | 1    |
| `tests/NiftyTimer.Tests/MenuPickerTests.cs`       | **Create.** Unit tests for the projection and the filter.                                              | 1    |
| `src/NiftyTimer/UI/BrandMark.xaml` (+ `.xaml.cs`) | **Create.** The product ring, drawn.                                                                   | 2    |
| `tests/NiftyTimer.Tests/BrandMarkTests.cs`        | **Create.** Pins the load-bearing geometry constants.                                                  | 2    |
| `src/NiftyTimer/UI/TrayPopupWindow.xaml`          | **Modify.** Header, totals, controls, picker, footer.                                                  | 3–6  |
| `src/NiftyTimer/UI/TrayPopupWindow.xaml.cs`       | **Modify.** `Render()` feeds the new elements; `RenderPicker()` rewritten.                             | 3–6  |
| `tests/NiftyTimer.Tests/ThemeTests.cs`            | **Modify.** Adds `BrandMark.xaml` to the sweep.                                                        | 2    |

---

## Task 1: `MenuViewModel` picker projection

**Files:**

- Create: `apps/client-windows/src/NiftyTimer/App/PickerItem.cs`
- Modify: `apps/client-windows/src/NiftyTimer/App/MenuViewModel.cs`
- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs` (delete the old `PickerItem` record at lines 12-13)
- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml` (one attribute, temporary — Task 5 replaces the control)
- Test: `apps/client-windows/tests/NiftyTimer.Tests/MenuPickerTests.cs`

**Interfaces:**

- Consumes: `Project(string Id, string TeamId, string Name, bool Archived, IReadOnlyList<ProjectTask>? Tasks)` and `ProjectTask(string Id, string ProjectId, string Name)` from `NiftyTimer.Projects`.
- Produces, all on `MenuViewModel`:
  - `string Query { get; set; }`
  - `IReadOnlyList<PickerItem> Choices { get; }`
  - `IReadOnlyList<PickerItem> FilteredChoices { get; }`
  - `PickerItem? SelectedChoice { get; }`
  - `internal static IReadOnlyList<PickerItem> BuildChoices(IReadOnlyList<Project> projects)`
  - `internal static IReadOnlyList<PickerItem> Filter(IReadOnlyList<PickerItem> choices, string? query)`
  - and the record `NiftyTimer.App.PickerItem(string ProjectName, string? TaskName, string ProjectId, string? TaskId)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/client-windows/tests/NiftyTimer.Tests/MenuPickerTests.cs`:

```csharp
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
```

`TestMenu.Build()` constructs a `MenuViewModel` over real collaborators and a throwaway directory.
**Check `apps/client-windows/tests/NiftyTimer.Tests/Support/` first** — if an equivalent factory
already exists, use it and drop this snippet. Otherwise create `Support/TestMenu.cs`:

```csharp
using NiftyTimer.App;
using NiftyTimer.Projects;
using NiftyTimer.Tracking;

namespace NiftyTimer.Tests;

/// <summary>A MenuViewModel wired to real collaborators over a throwaway directory.</summary>
internal static class TestMenu
{
    public static MenuViewModel Build()
    {
        var root = Path.Combine(Path.GetTempPath(), "niftytimer-tests", Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(root);
        return new MenuViewModel(new TimeTracker(), new SelectionStore(root));
    }
}
```

Read the real constructors of `TimeTracker` and `SelectionStore` before using this — if either takes
different arguments, match them rather than changing the production types.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/client-windows && dotnet test NiftyTimer.sln -c Release --filter "FullyQualifiedName~MenuPickerTests"
```

Expected: compile failure — `PickerItem`'s new shape, `BuildChoices`, `Filter`, `Query`,
`FilteredChoices` and `SelectedChoice` do not exist yet.

- [ ] **Step 3: Create the row type**

Create `apps/client-windows/src/NiftyTimer/App/PickerItem.cs`:

```csharp
namespace NiftyTimer.App;

/// <summary>
/// One selectable row in the project picker.
///
/// Project and task names are separate fields rather than one pre-joined label because the row is
/// two-line — project on top, task beneath in the secondary colour — and because the search matches
/// them independently. A project row carries a null <c>TaskName</c>.
/// </summary>
public sealed record PickerItem(string ProjectName, string? TaskName, string ProjectId, string? TaskId);
```

- [ ] **Step 4: Delete the old record from the window and keep the build green**

In `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs`, delete lines 12-13:

```csharp
/// <summary>One row in the project/task picker.</summary>
public sealed record PickerItem(string Label, string ProjectId, string? TaskId);
```

The file already has `using NiftyTimer.App;`, so the moved type resolves. Update the two
construction sites in `RenderPicker()` to the new shape:

```csharp
                items.Add(new PickerItem(project.Name, null, project.Id, null));
                // ...
                items.Add(new PickerItem(project.Name, task.Name, project.Id, task.Id));
```

and in `TrayPopupWindow.xaml` change the `ComboBox`'s `DisplayMemberPath="Label"` to
`DisplayMemberPath="ProjectName"`. Both are temporary — Task 5 replaces the control outright — but
the build must be green at the end of every task.

- [ ] **Step 5: Add the projection to the view model**

In `apps/client-windows/src/NiftyTimer/App/MenuViewModel.cs`, add the backing field beside the
others near line 30:

```csharp
    private string _query = string.Empty;
```

Change `Projects` so loading projects republishes the derived lists:

```csharp
    public IReadOnlyList<Project> Projects
    {
        get => _projects;
        set => Set(ref _projects, value, [nameof(Choices), nameof(FilteredChoices), nameof(SelectedChoice)]);
    }
```

Change `Selection` so the checkmark follows it:

```csharp
    public StoredSelection? Selection
    {
        get => _selection;
        private set => Set(ref _selection, value, [nameof(SelectionLabel), nameof(SelectedChoice)]);
    }
```

Add the new members immediately after `SelectionLabel`:

```csharp
    /// <summary>
    /// What the search box holds. macOS gets this from SwiftUI's <c>query</c>; the Windows popup
    /// used to get text search for free from the stock ComboBox, which PR 2 replaces.
    /// </summary>
    public string Query
    {
        get => _query;
        set => Set(ref _query, value, [nameof(FilteredChoices)]);
    }

    /// <summary>Every project, each followed by its own tasks. Flat, because the list renders flat.</summary>
    public IReadOnlyList<PickerItem> Choices => BuildChoices(_projects);

    /// <summary>What the list actually shows, narrowed by <see cref="Query"/>.</summary>
    public IReadOnlyList<PickerItem> FilteredChoices => Filter(Choices, _query);

    /// <summary>
    /// The row that carries the checkmark. Resolved against the FULL list rather than the filtered
    /// one: a selection the current query happens to hide is still the selection.
    /// </summary>
    public PickerItem? SelectedChoice =>
        _selection is null
            ? null
            : Choices.FirstOrDefault(c => c.ProjectId == _selection.ProjectId && c.TaskId == _selection.TaskId);

    /// <summary>
    /// Flatten projects into rows. A project always contributes its own row — selecting a project
    /// without a task is a valid selection, and a project with no tasks would otherwise vanish.
    /// </summary>
    internal static IReadOnlyList<PickerItem> BuildChoices(IReadOnlyList<Project> projects)
    {
        var items = new List<PickerItem>();
        foreach (var project in projects)
        {
            items.Add(new PickerItem(project.Name, null, project.Id, null));
            foreach (var task in project.Tasks ?? [])
            {
                items.Add(new PickerItem(project.Name, task.Name, project.Id, task.Id));
            }
        }

        return items;
    }

    /// <summary>
    /// Narrow by substring on either name. OrdinalIgnoreCase rather than the current culture: the
    /// result must not depend on the machine's locale, or the same query returns different rows on
    /// two employees' laptops.
    /// </summary>
    internal static IReadOnlyList<PickerItem> Filter(IReadOnlyList<PickerItem> choices, string? query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return choices;
        }

        var trimmed = query.Trim();
        return choices
            .Where(c =>
                c.ProjectName.Contains(trimmed, StringComparison.OrdinalIgnoreCase) ||
                (c.TaskName?.Contains(trimmed, StringComparison.OrdinalIgnoreCase) ?? false))
            .ToList();
    }
```

In `Reset()`, clear the query alongside everything else user-specific — add `Query = string.Empty;`
beside the existing `Note = string.Empty;`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd apps/client-windows && dotnet test NiftyTimer.sln -c Release --filter "FullyQualifiedName~MenuPickerTests"
```

Expected: PASS, 12 tests.

- [ ] **Step 7: Run the whole suite**

```bash
cd apps/client-windows && dotnet test NiftyTimer.sln -c Release
```

Expected: all green. Release matters — a Debug build can be blocked by a running `NiftyTimer.exe`
holding a file lock on the output.

- [ ] **Step 8: Commit**

```bash
git add apps/client-windows/src/NiftyTimer/App/PickerItem.cs \
        apps/client-windows/src/NiftyTimer/App/MenuViewModel.cs \
        apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs \
        apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml \
        apps/client-windows/tests/NiftyTimer.Tests/MenuPickerTests.cs
git commit -m "feat(client): filtered project picker projection on MenuViewModel"
```

Add `apps/client-windows/tests/NiftyTimer.Tests/Support/TestMenu.cs` to the `git add` list if you
created it.

---

## Task 2: `BrandMark`

**Files:**

- Create: `apps/client-windows/src/NiftyTimer/UI/BrandMark.xaml`
- Create: `apps/client-windows/src/NiftyTimer/UI/BrandMark.xaml.cs`
- Modify: `apps/client-windows/tests/NiftyTimer.Tests/ThemeTests.cs`
- Test: `apps/client-windows/tests/NiftyTimer.Tests/BrandMarkTests.cs`

**Interfaces:**

- Produces: `NiftyTimer.UI.BrandMark`, a `UserControl` with no public members, used from XAML as `<local:BrandMark Width="18" Height="18" />`.

Ported from `apps/client-macos/Sources/TimeTrack/UI/BrandMark.swift`, which mirrors the dashboard
exactly. The constants are load-bearing — the spec calls out that reading the centre as `(12, 12)`
instead of `(12, 12.5)` puts the arcs 4° apart and shows as a visible seam.

Endpoints are solved here so no trigonometry is needed at runtime:

| Angle                 | Point        | Where it comes from                |
| --------------------- | ------------ | ---------------------------------- |
| −90° (twelve o'clock) | `12,5.2`     | centre `(12, 12.5)`, r `7.3`       |
| 161.97° (handover)    | `5.06,14.76` | the dashboard's own `M 5.06,14.76` |
| 270° (six o'clock)    | `12,19.8`    | closes the ring                    |

The elapsed arc sweeps 251.97° — more than a half turn, so `IsLargeArc="True"`. The remaining arc
sweeps 108.03°, so `IsLargeArc="False"`. Both run clockwise in WPF's y-down space, the same
direction SwiftUI uses.

- [ ] **Step 1: Write the failing test**

Create `apps/client-windows/tests/NiftyTimer.Tests/BrandMarkTests.cs`:

```csharp
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The mark's geometry mirrors the dashboard and the macOS client exactly so the three cannot
/// drift. Text assertions over the XAML rather than a rendered-pixel comparison: the failure this
/// guards against is someone "tidying" a constant, and a wrong constant is legible in the source
/// long before it is legible on screen.
/// </summary>
public class BrandMarkTests
{
    private static string Markup() =>
        File.ReadAllText(Path.Combine(ThemeTestPaths.UiDirectory(), "BrandMark.xaml"));

    [Theory]
    // Centre (12, 12.5) with r=7.3 puts twelve o'clock here. Reading the centre as (12,12) -- the
    // documented trap -- would make this 5.0 and open a 4-degree seam at the handover.
    [InlineData("12,5.2")]
    // The handover, 161.97 degrees round. Taken from the dashboard's own path data.
    [InlineData("5.06,14.76")]
    // Six o'clock, closing the ring.
    [InlineData("12,19.8")]
    [InlineData("7.3,7.3")]
    public void TheArcGeometryMatchesTheDashboard(string fragment)
    {
        Assert.Contains(fragment, Markup(), StringComparison.Ordinal);
    }

    [Fact]
    public void TheElapsedArcTakesTheLongWayRound()
    {
        // 251.97 degrees is more than a half turn, so the large-arc flag is what makes this the
        // elapsed sweep rather than its 108-degree complement.
        Assert.Contains("IsLargeArc=\"True\"", Markup(), StringComparison.Ordinal);
    }

    [Fact]
    public void TheStrokeIsTheDashboardsWidthWithButtCaps()
    {
        var markup = Markup();

        Assert.Contains("StrokeThickness=\"3.4\"", markup, StringComparison.Ordinal);
        // Butt caps, not round: at 18px a round cap reads as a bulge and the two arcs stop meeting
        // flush.
        Assert.Contains("StrokeStartLineCap=\"Flat\"", markup, StringComparison.Ordinal);
        Assert.Contains("StrokeEndLineCap=\"Flat\"", markup, StringComparison.Ordinal);
    }

    [Fact]
    public void TheTwoArcsUseTheThemeInvariantMarkRoles()
    {
        var markup = Markup();

        Assert.Contains("{DynamicResource MarkElapsed}", markup, StringComparison.Ordinal);
        Assert.Contains("{DynamicResource MarkRemaining}", markup, StringComparison.Ordinal);
    }

    [Fact]
    public void TheDrawingBoxIsTwentyFourSquareSoTheConstantsMeanWhatTheySay()
    {
        var markup = Markup();

        Assert.Contains("Width=\"24\"", markup, StringComparison.Ordinal);
        Assert.Contains("Height=\"24\"", markup, StringComparison.Ordinal);
    }
}
```

`ThemeTestPaths.UiDirectory()` is the helper `ThemeTests.cs` already uses to locate
`src/NiftyTimer/UI`. **Read `ThemeTests.cs` and reuse it by its real name.** If it is a private
method on a test class rather than a shared helper, promote it to an
`internal static class ThemeTestPaths` in that same file and update its existing callers.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/client-windows && dotnet test NiftyTimer.sln -c Release --filter "FullyQualifiedName~BrandMarkTests"
```

Expected: FAIL — `BrandMark.xaml` does not exist.

- [ ] **Step 3: Draw the mark**

Create `apps/client-windows/src/NiftyTimer/UI/BrandMark.xaml`:

```xml
<UserControl x:Class="NiftyTimer.UI.BrandMark"
             xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">

    <!-- The elapsed-time ring, the same one the dashboard and the app icon wear.

         Drawn rather than loaded from the .ico: that artwork is 1024px with its own ground and
         reads as mud at 18px. The geometry mirrors the dashboard exactly (24x24 box, r=7.3,
         stroke 3.4, centre 12,12.5) so the two cannot drift. See BrandMarkTests, and the note in
         BrandMark.swift about the centre sitting half a unit BELOW the box centre to leave room
         for the crown tick. -->
    <Viewbox Stretch="Uniform">
        <Canvas Width="24" Height="24">

            <!-- Elapsed: twelve o'clock (12,5.2) round to the handover at 161.97deg. That is
                 251.97deg, so IsLargeArc. -->
            <Path Stroke="{DynamicResource MarkElapsed}"
                  StrokeThickness="3.4"
                  StrokeStartLineCap="Flat"
                  StrokeEndLineCap="Flat">
                <Path.Data>
                    <PathGeometry>
                        <PathFigure StartPoint="12,5.2">
                            <ArcSegment Point="5.06,14.76"
                                        Size="7.3,7.3"
                                        IsLargeArc="True"
                                        SweepDirection="Clockwise" />
                        </PathFigure>
                    </PathGeometry>
                </Path.Data>
            </Path>

            <!-- Remaining: the handover round to six o'clock. 108.03deg, so no large-arc flag.
                 Butt caps on both mean the two meet flush, with no gap and no bulge. -->
            <Path Stroke="{DynamicResource MarkRemaining}"
                  StrokeThickness="3.4"
                  StrokeStartLineCap="Flat"
                  StrokeEndLineCap="Flat">
                <Path.Data>
                    <PathGeometry>
                        <PathFigure StartPoint="5.06,14.76">
                            <ArcSegment Point="12,19.8"
                                        Size="7.3,7.3"
                                        IsLargeArc="False"
                                        SweepDirection="Clockwise" />
                        </PathFigure>
                    </PathGeometry>
                </Path.Data>
            </Path>

            <!-- Crown tick. Overlaps the ring so the two never separate when scaled. -->
            <Rectangle Canvas.Left="11.1"
                       Canvas.Top="1.7"
                       Width="1.8"
                       Height="3.4"
                       RadiusX="0.9"
                       RadiusY="0.9"
                       Fill="{DynamicResource Text}" />

        </Canvas>
    </Viewbox>
</UserControl>
```

Create `apps/client-windows/src/NiftyTimer/UI/BrandMark.xaml.cs`:

```csharp
using System.Windows.Controls;

namespace NiftyTimer.UI;

/// <summary>
/// The product mark. All geometry lives in the XAML, where BrandMarkTests can read it; this file
/// exists only because a WPF UserControl needs its generated partner.
///
/// Note that NiftyTimer.csproj removes the System.Windows.Shapes implicit using so System.IO.Path
/// wins the name collision. That affects C# only — the XAML above resolves its Path elements
/// through the presentation xmlns and is unaffected.
/// </summary>
public partial class BrandMark : UserControl
{
    public BrandMark() => InitializeComponent();
}
```

- [ ] **Step 4: Add the new file to the theme sweep**

In `apps/client-windows/tests/NiftyTimer.Tests/ThemeTests.cs`, add one case to
`ThemeSweepTests.NoThemedBrushIsBoundWithStaticResource`, after `[InlineData("Styles.xaml")]`:

```csharp
    [InlineData("BrandMark.xaml")]
```

While in that method, delete the now-stale `File.Exists` early-return and the two comments about
"Added by Task 3, which creates this file" — `Styles.xaml` has existed since PR 1 merged, so the
guard now only hides a genuinely missing file. Replace it with an assertion:

```csharp
        var path = Path.Combine(UiDirectory(), file);
        Assert.True(File.Exists(path), $"{file} is missing from src/NiftyTimer/UI.");
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd apps/client-windows && dotnet test NiftyTimer.sln -c Release --filter "FullyQualifiedName~BrandMarkTests|FullyQualifiedName~ThemeSweepTests"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client-windows/src/NiftyTimer/UI/BrandMark.xaml \
        apps/client-windows/src/NiftyTimer/UI/BrandMark.xaml.cs \
        apps/client-windows/tests/NiftyTimer.Tests/BrandMarkTests.cs \
        apps/client-windows/tests/NiftyTimer.Tests/ThemeTests.cs
git commit -m "feat(client): draw the brand mark for the Windows popup"
```

---

## Task 3: Header — status dot, hero elapsed, captioned totals

**Files:**

- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml`
- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs`

**Interfaces:**

- Consumes: `MenuViewModel.IsReady`, `.IsTracking`, `.IsPaused`, `.ElapsedLabel`, `.TodayLabel`, `.WeekLabel`, `.MonthLabel`, `.SelectionLabel`.
- Produces: named elements `StatusDot` (`Ellipse`), `StatusLabel` (`TextBlock`), `ElapsedLabel` (`TextBlock`) that Task 4 and Task 6 leave alone.

macOS shows `● Recording` / `● Paused` in the accent colour, or `Idle · Not tracking` in secondary,
and hides the hero timer entirely when idle. The Windows popup currently shows a bare
`Tracking · <project>` line and always renders the timer.

The selection moves off the status line: the picker below now shows it with a checkmark, and
repeating it here was compensating for a picker that could not.

- [ ] **Step 1: Replace the header markup**

In `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml`, set the window width for parity
with macOS (Ruling R4):

```xml
        Width="340"
```

Replace the three header lines — the `Nifty Timer` caption, `ElapsedLabel` and `StatusLabel` — with:

```xml
            <!-- Status: a dot plus the phase, mirroring the macOS dropdown. The dot is the fastest
                 read in the window; PRD 4.2 wants the recording state disclosed, not inferred. -->
            <StackPanel Orientation="Horizontal" Margin="0,0,0,2">
                <Ellipse x:Name="StatusDot"
                         Width="7"
                         Height="7"
                         VerticalAlignment="Center"
                         Fill="{DynamicResource TextSecondary}" />
                <TextBlock x:Name="StatusLabel"
                           Style="{StaticResource LabelText}"
                           Margin="6,0,0,0"
                           VerticalAlignment="Center" />
            </StackPanel>

            <!-- The hero timer. Collapsed when idle: a stopped 00:00:00 is a large, prominent
                 number that says nothing. -->
            <TextBlock x:Name="ElapsedLabel"
                       Style="{StaticResource ElapsedText}"
                       Visibility="Collapsed"
                       Margin="0,2,0,0" />
```

Replace the totals `Border` — the three-column `Grid` near the bottom — with a captioned version
carrying 1px dividers. Note it moves **up**, directly beneath the timer, matching macOS:

```xml
            <Grid Margin="0,10,0,12">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*" />
                    <ColumnDefinition Width="Auto" />
                    <ColumnDefinition Width="*" />
                    <ColumnDefinition Width="Auto" />
                    <ColumnDefinition Width="*" />
                </Grid.ColumnDefinitions>

                <StackPanel Grid.Column="0">
                    <TextBlock Text="TODAY" Style="{StaticResource MicroText}" />
                    <TextBlock x:Name="TodayLabel" Style="{StaticResource NumericText}" FontSize="15" />
                </StackPanel>

                <Rectangle Grid.Column="1" Width="1" Height="22"
                           Fill="{DynamicResource Separator}" VerticalAlignment="Center" />

                <StackPanel Grid.Column="2">
                    <TextBlock Text="THIS WEEK" Style="{StaticResource MicroText}" />
                    <TextBlock x:Name="WeekLabel" Style="{StaticResource NumericText}" FontSize="15" />
                </StackPanel>

                <Rectangle Grid.Column="3" Width="1" Height="22"
                           Fill="{DynamicResource Separator}" VerticalAlignment="Center" />

                <StackPanel Grid.Column="4">
                    <TextBlock Text="THIS MONTH" Style="{StaticResource MicroText}" />
                    <TextBlock x:Name="MonthLabel" Style="{StaticResource NumericText}" FontSize="15" />
                </StackPanel>
            </Grid>
```

The captions are literal uppercase strings, not a `CharacterCasing` transform — WPF has no
text-transform for a `TextBlock`, and a converter for three constants would be ceremony.

- [ ] **Step 2: Drive the new elements from `Render()`**

In `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs`, replace the first two lines of
`Render()`:

```csharp
            ElapsedLabel.Text = _viewModel.ElapsedLabel;
            StatusLabel.Text = StatusText();
```

with:

```csharp
            RenderStatus();
```

and replace the whole `StatusText()` method with:

```csharp
    /// <summary>
    /// The status line and the hero timer.
    ///
    /// The timer is hidden when there is nothing running: a large 00:00:00 reads as a clock that
    /// has stopped rather than one that was never started, which is the wrong thing to say to
    /// someone who has not begun their day.
    ///
    /// The selection is deliberately NOT repeated here — the picker below carries it with a
    /// checkmark, and this line was only doing that job when the picker could not.
    /// </summary>
    private void RenderStatus()
    {
        var tracking = _viewModel.IsTracking;
        var paused = _viewModel.IsPaused;

        StatusLabel.Text = (tracking, paused, _viewModel.IsReady) switch
        {
            (true, _, _) => "Recording",
            (_, true, _) => "Paused",
            (_, _, false) => "Not ready",
            _ => "Idle · Not tracking",
        };

        var active = tracking || paused;

        // Recording rather than Accent: it is the role that means "the clock is running", and it
        // is what a later status colour change would want to move.
        StatusDot.Fill = active
            ? (Brush)FindResource("Recording")
            : (Brush)FindResource("TextSecondary");

        StatusLabel.Foreground = active
            ? (Brush)FindResource("Recording")
            : (Brush)FindResource("TextSecondary");

        ElapsedLabel.Text = _viewModel.ElapsedLabel;
        ElapsedLabel.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
    }
```

`FindResource` walks to the application dictionary, so it picks up whichever theme is currently
merged — but it resolves **once, at call time**, unlike a `{DynamicResource}` in markup. That is
correct here only because `Render()` re-runs on every view-model change; a theme swap while the
popup is open must also repaint these two brushes. Add that to `OnIsVisibleChanged`'s visible
branch and to the theme path by calling `Render()` from a public method:

```csharp
    /// <summary>
    /// Repaint after a theme swap. The status brushes are assigned in code rather than bound, so
    /// unlike everything else in this window they do not re-resolve on their own when the merged
    /// dictionary changes.
    /// </summary>
    public void RefreshTheme() => Render();
```

Add `using System.Windows.Media;` to the file's usings for `Brush`.

- [ ] **Step 3: Call `RefreshTheme` when the theme changes**

Find where `ThemeWatcher`'s callback reaches the popup — `App.AppDelegate.ApplyTheme(AppTheme)` in
`apps/client-windows/src/NiftyTimer/App/AppDelegate.cs`, which already sets
`TrayIconController.Theme`. Add the popup call beside it:

```csharp
        _popup?.RefreshTheme();
```

Read `AppDelegate.ApplyTheme` first and match the field's real name — it may be `_popupWindow` or
similar.

- [ ] **Step 4: Build and run the suite**

```bash
cd apps/client-windows && dotnet build NiftyTimer.sln -c Release && dotnet test NiftyTimer.sln -c Release
```

Expected: 0 warnings, 0 errors, all tests green. `ThemeSweepTests` must still pass — the new markup
uses `{DynamicResource}` for `Separator`, `TextSecondary` and the mark roles.

- [ ] **Step 5: Commit**

```bash
git add apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml \
        apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs \
        apps/client-windows/src/NiftyTimer/App/AppDelegate.cs
git commit -m "feat(client): status dot, hero timer and captioned totals in the popup"
```

---

## Task 4: Controls — phase-driven buttons with drawn glyphs

**Files:**

- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml`
- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs`
- Modify: `apps/client-windows/src/NiftyTimer/UI/Styles.xaml`

**Interfaces:**

- Consumes: `MenuViewModel.IsReady`, `.IsTracking`, `.IsPaused`, `.CanStart`, `.CanStop`; the `ProminentButton` and `BorderedButton` styles from PR 1.
- Produces: named elements `PrimaryButton`, `SecondaryButton`, and the three glyph resources `PlayGlyph`, `PauseGlyph`, `StopGlyph` in `Styles.xaml`.

macOS switches which button is prominent by phase: idle shows one prominent **Start**; tracking
shows bordered **Pause** + prominent **Stop**; paused shows prominent **Resume** + bordered **Stop**.
Windows currently shows two fixed 92px buttons whose labels change.

Glyphs are drawn, not font glyphs (Ruling R3).

- [ ] **Step 1: Add the glyph geometries**

In `apps/client-windows/src/NiftyTimer/UI/Styles.xaml`, add three geometries near the top, after the
`AccentFocusVisual` style:

```xml
    <!-- Transport glyphs, drawn rather than taken from an icon font. Windows 10 ships Segoe MDL2
         Assets and Windows 11 ships Segoe Fluent Icons under different names, and a glyph missing
         from the installed font renders as a box on the one control the person needs most. Same
         reasoning as BrandMark. Each is authored in a 10x10 box. -->
    <Geometry x:Key="PlayGlyph">M 1,0 L 9,5 L 1,10 Z</Geometry>
    <Geometry x:Key="PauseGlyph">M 1,0 H 4 V 10 H 1 Z M 6,0 H 9 V 10 H 6 Z</Geometry>
    <Geometry x:Key="StopGlyph">M 1,1 H 9 V 9 H 1 Z</Geometry>
```

- [ ] **Step 2: Replace the button row**

In `TrayPopupWindow.xaml`, replace the horizontal `StackPanel` holding `StartStopButton` and
`PauseResumeButton` with a two-column grid — equal widths, so the pair fills the popup like macOS's
`maxWidth: .infinity` rather than sitting at a fixed 92px:

```xml
            <Grid Margin="0,0,0,12">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*" />
                    <ColumnDefinition Width="8" />
                    <ColumnDefinition Width="*" />
                </Grid.ColumnDefinitions>

                <Button x:Name="PrimaryButton" Grid.Column="0" Click="OnPrimary">
                    <StackPanel Orientation="Horizontal" HorizontalAlignment="Center">
                        <Path x:Name="PrimaryGlyph"
                              Width="10" Height="10"
                              Stretch="Uniform"
                              VerticalAlignment="Center"
                              Fill="{Binding Foreground, RelativeSource={RelativeSource AncestorType=Button}}" />
                        <TextBlock x:Name="PrimaryLabel" Margin="7,0,0,0" VerticalAlignment="Center" />
                    </StackPanel>
                </Button>

                <Button x:Name="SecondaryButton" Grid.Column="2" Click="OnSecondary">
                    <StackPanel Orientation="Horizontal" HorizontalAlignment="Center">
                        <Path x:Name="SecondaryGlyph"
                              Width="10" Height="10"
                              Stretch="Uniform"
                              VerticalAlignment="Center"
                              Fill="{Binding Foreground, RelativeSource={RelativeSource AncestorType=Button}}" />
                        <TextBlock x:Name="SecondaryLabel" Margin="7,0,0,0" VerticalAlignment="Center" />
                    </StackPanel>
                </Button>
            </Grid>
```

The glyph inherits the button's `Foreground` through a `RelativeSource` binding rather than a fixed
brush, so it turns white on the prominent button and accent-coloured on the bordered one without a
second code path — and it follows a theme swap for free.

- [ ] **Step 3: Drive the pair from the phase**

In `TrayPopupWindow.xaml.cs`, replace the four `StartStopButton` / `PauseResumeButton` lines in
`Render()` with:

```csharp
            RenderControls();
```

Replace `OnStartStop` and `OnPauseResume` with:

```csharp
    /// <summary>
    /// Which two buttons the phase calls for, and which of them is the prominent one.
    ///
    /// Idle offers only Start — there is nothing to stop or pause, and a disabled second button is
    /// noise. Tracking makes Stop prominent and Pause secondary; paused inverts that, because the
    /// obvious next action is to carry on.
    /// </summary>
    private void RenderControls()
    {
        var prominent = (Style)FindResource("ProminentButton");
        var bordered = (Style)FindResource("BorderedButton");

        if (_viewModel.IsPaused)
        {
            Apply(PrimaryButton, PrimaryGlyph, PrimaryLabel, prominent, "PlayGlyph", "Resume", _viewModel.IsReady);
            Apply(SecondaryButton, SecondaryGlyph, SecondaryLabel, bordered, "StopGlyph", "Stop", _viewModel.CanStop);
            SecondaryButton.Visibility = Visibility.Visible;
            return;
        }

        if (_viewModel.IsTracking)
        {
            Apply(PrimaryButton, PrimaryGlyph, PrimaryLabel, bordered, "PauseGlyph", "Pause", true);
            Apply(SecondaryButton, SecondaryGlyph, SecondaryLabel, prominent, "StopGlyph", "Stop", _viewModel.CanStop);
            SecondaryButton.Visibility = Visibility.Visible;
            return;
        }

        Apply(PrimaryButton, PrimaryGlyph, PrimaryLabel, prominent, "PlayGlyph", "Start", _viewModel.CanStart);
        SecondaryButton.Visibility = Visibility.Collapsed;

        // The tooltip is the only place the ack gate explains itself on this surface. Without it a
        // disabled Start is indistinguishable from a broken one.
        PrimaryButton.ToolTip = _viewModel.IsReady
            ? "Start tracking"
            : "Acknowledge the monitoring policy to begin";
    }

    private void Apply(
        Button button,
        System.Windows.Shapes.Path glyph,
        TextBlock label,
        Style style,
        string glyphKey,
        string text,
        bool enabled)
    {
        button.Style = style;
        button.IsEnabled = enabled;
        glyph.Data = (Geometry)FindResource(glyphKey);
        label.Text = text;
    }

    private void OnPrimary(object sender, RoutedEventArgs e)
    {
        if (_viewModel.IsPaused)
        {
            _viewModel.Resume();
        }
        else if (_viewModel.IsTracking)
        {
            _viewModel.Pause();
        }
        else
        {
            _viewModel.Start();
        }
    }

    private void OnSecondary(object sender, RoutedEventArgs e) => _viewModel.Stop();
```

`System.Windows.Shapes.Path` is written out in full because `NiftyTimer.csproj` removes that
implicit using so `System.IO.Path` wins the name collision — do not "simplify" it to `Path`, and do
not add the using back.

Add `using System.Windows.Media;` if Task 3 did not already.

- [ ] **Step 4: Build and run the suite**

```bash
cd apps/client-windows && dotnet build NiftyTimer.sln -c Release && dotnet test NiftyTimer.sln -c Release
```

Expected: 0 warnings, all green.

- [ ] **Step 5: Commit**

```bash
git add apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml \
        apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs \
        apps/client-windows/src/NiftyTimer/UI/Styles.xaml
git commit -m "feat(client): phase-driven transport buttons with drawn glyphs"
```

---

## Task 5: Project picker — search field and two-line list

**Files:**

- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml`
- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs`

**Interfaces:**

- Consumes: `MenuViewModel.Query`, `.FilteredChoices`, `.SelectedChoice`, `.SelectProject(string, string?)`, and `PickerItem(string ProjectName, string? TaskName, string ProjectId, string? TaskId)` — all from Task 1.
- Produces: named elements `SearchBox` (`TextBox`) and `ProjectList` (`ListBox`); the old `ProjectPicker` `ComboBox` is gone.

This is the one genuine rewrite in PR 2. The stock `ComboBox` supplied text search for free; a
`ListBox` does not, which is why Task 1 exists.

- [ ] **Step 1: Replace the picker markup**

In `TrayPopupWindow.xaml`, replace the `Project` caption and the `ProjectPicker` `ComboBox` with:

```xml
            <TextBlock Text="SWITCH PROJECT" Style="{StaticResource MicroText}" Margin="0,0,0,4" />

            <TextBox x:Name="SearchBox"
                     Style="{StaticResource FieldChrome}"
                     TextChanged="OnSearchChanged"
                     Margin="0,0,0,6" />

            <!-- A DEFINITE height, not MaxHeight. The window is SizeToContent="Height", so a list
                 that sizes to its content makes the whole popup jump every time a keystroke
                 narrows the results — and grow without bound on a long project list. 220px is
                 about six rows; past that it scrolls. -->
            <ListBox x:Name="ProjectList"
                     Height="220"
                     Background="Transparent"
                     BorderThickness="0"
                     ScrollViewer.HorizontalScrollBarVisibility="Disabled"
                     SelectionChanged="OnProjectSelected"
                     Margin="0,0,0,12">
                <ListBox.ItemContainerStyle>
                    <Style TargetType="ListBoxItem">
                        <Setter Property="Padding" Value="8,7" />
                        <Setter Property="HorizontalContentAlignment" Value="Stretch" />
                        <Setter Property="Template">
                            <Setter.Value>
                                <ControlTemplate TargetType="ListBoxItem">
                                    <Border x:Name="Chrome"
                                            Background="Transparent"
                                            CornerRadius="{StaticResource RadiusSm}"
                                            Padding="{TemplateBinding Padding}">
                                        <ContentPresenter />
                                    </Border>
                                    <ControlTemplate.Triggers>
                                        <Trigger Property="IsMouseOver" Value="True">
                                            <Setter TargetName="Chrome" Property="Background"
                                                    Value="{DynamicResource Surface}" />
                                        </Trigger>
                                        <Trigger Property="IsSelected" Value="True">
                                            <Setter TargetName="Chrome" Property="Background"
                                                    Value="{DynamicResource Tint}" />
                                        </Trigger>
                                    </ControlTemplate.Triggers>
                                </ControlTemplate>
                            </Setter.Value>
                        </Setter>
                    </Style>
                </ListBox.ItemContainerStyle>

                <ListBox.ItemTemplate>
                    <DataTemplate>
                        <Grid>
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="*" />
                                <ColumnDefinition Width="Auto" />
                            </Grid.ColumnDefinitions>

                            <StackPanel Grid.Column="0">
                                <TextBlock Text="{Binding ProjectName}" Style="{StaticResource LabelText}" />
                                <!-- Collapsed for a project row, where TaskName is null, so the row
                                     stays single-line instead of reserving an empty second line. -->
                                <TextBlock Text="{Binding TaskName}"
                                           Style="{StaticResource CaptionText}"
                                           Margin="0,1,0,0">
                                    <TextBlock.Style>
                                        <Style TargetType="TextBlock" BasedOn="{StaticResource CaptionText}">
                                            <Style.Triggers>
                                                <DataTrigger Binding="{Binding TaskName}" Value="{x:Null}">
                                                    <Setter Property="Visibility" Value="Collapsed" />
                                                </DataTrigger>
                                            </Style.Triggers>
                                        </Style>
                                    </TextBlock.Style>
                                </TextBlock>
                            </StackPanel>

                            <Path Grid.Column="1"
                                  Width="11" Height="9"
                                  Stretch="Uniform"
                                  VerticalAlignment="Center"
                                  Data="M 0,5 L 4,9 L 11,1"
                                  Stroke="{DynamicResource Accent}"
                                  StrokeThickness="1.8"
                                  StrokeStartLineCap="Round"
                                  StrokeEndLineCap="Round"
                                  Visibility="{Binding IsSelected,
                                      RelativeSource={RelativeSource AncestorType=ListBoxItem},
                                      Converter={StaticResource BoolToVisibility}}" />
                        </Grid>
                    </DataTemplate>
                </ListBox.ItemTemplate>
            </ListBox>
```

`BoolToVisibility` is WPF's stock `BooleanToVisibilityConverter`. Declare it once in `Styles.xaml`
beside the geometries:

```xml
    <BooleanToVisibilityConverter x:Key="BoolToVisibility" />
```

Note the `TextBlock` sets `Text` and then a `Style` — set the `Text` attribute and the `TextBlock.Style`
element as shown, not a `Setter` for `Text`, or the trigger and the binding fight.

- [ ] **Step 2: Rewrite `RenderPicker` and its handlers**

In `TrayPopupWindow.xaml.cs`, replace `RenderPicker()` and `OnProjectSelected` with:

```csharp
    /// <summary>
    /// Refill the list from the view model's filtered projection.
    ///
    /// Reassigning ItemsSource on every Render is cheap at this size and keeps the window's single
    /// imperative-push model intact (PR 2 is structural parity, not an MVVM migration). The
    /// selection is restored by VALUE rather than by reference, because the projection rebuilds its
    /// records on every read and the old instance is never the new one.
    /// </summary>
    private void RenderPicker()
    {
        var choices = _viewModel.FilteredChoices;
        ProjectList.ItemsSource = choices;

        var selected = _viewModel.SelectedChoice;
        ProjectList.SelectedItem = selected is null
            ? null
            : choices.FirstOrDefault(c => c.ProjectId == selected.ProjectId && c.TaskId == selected.TaskId);

        if (SearchBox.Text != _viewModel.Query)
        {
            SearchBox.Text = _viewModel.Query;
        }
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppressCallbacks)
        {
            _viewModel.Query = SearchBox.Text;
        }
    }

    private void OnProjectSelected(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressCallbacks || ProjectList.SelectedItem is not PickerItem item)
        {
            return;
        }

        _viewModel.SelectProject(item.ProjectId, item.TaskId);
    }
```

`_suppressCallbacks` already guards `Render()`; both handlers respect it, so restoring the selection
and the query text does not loop back into the view model.

- [ ] **Step 3: Build and run the suite**

```bash
cd apps/client-windows && dotnet build NiftyTimer.sln -c Release && dotnet test NiftyTimer.sln -c Release
```

Expected: 0 warnings, all green.

- [ ] **Step 4: Verify the picker by hand**

`dotnet build` is not verification for this work — the spec says so explicitly. Run the app and
check, at minimum:

1. Typing in the search box narrows the list on each keystroke, matching both project and task names.
2. Clearing the box restores every row.
3. The checkmark sits on the selected row, and survives a query that filters that row out and back in.
4. Selecting a row while tracking re-attributes the running span (the status line and tray tooltip follow).
5. The list does not resize the popup as results narrow.

- [ ] **Step 5: Commit**

```bash
git add apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml \
        apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml.cs \
        apps/client-windows/src/NiftyTimer/UI/Styles.xaml
git commit -m "feat(client): searchable two-line project picker in the popup"
```

---

## Task 6: Footer, update row and brand mark

**Files:**

- Modify: `apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml`

**Interfaces:**

- Consumes: `NiftyTimer.UI.BrandMark` from Task 2; the `LinkButton` style from PR 1.
- Produces: nothing later tasks depend on — this is the last task.

The footer buttons are already `LinkButton`. What is missing is the brand mark, and a footer that
does not run four items into one crowded row.

- [ ] **Step 1: Add the mark to the header**

In `TrayPopupWindow.xaml`, add the local xmlns to the `Window` element if it is not already there:

```xml
        xmlns:ui="clr-namespace:NiftyTimer.UI"
```

Put the mark beside the status line by wrapping Task 3's status `StackPanel` — replace its opening
tag and add the mark as the first child:

```xml
            <StackPanel Orientation="Horizontal" Margin="0,0,0,2">
                <ui:BrandMark Width="18" Height="18" VerticalAlignment="Center" Margin="0,0,8,0" />
                <Ellipse x:Name="StatusDot"
```

- [ ] **Step 2: Give the footer two rows**

Replace the footer `Border`'s inner horizontal `StackPanel` with a grid that pushes the build stamp
to the far edge, so it reads as reference information rather than a fourth action:

```xml
                <Grid>
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="Auto" />
                        <ColumnDefinition Width="Auto" />
                        <ColumnDefinition Width="Auto" />
                        <ColumnDefinition Width="*" />
                    </Grid.ColumnDefinitions>

                    <Button Grid.Column="0" Content="My data" Style="{StaticResource LinkButton}"
                            Click="OnOpenMyData"
                            ToolTip="Opens everything recorded about you in the dashboard" />
                    <Button Grid.Column="1" Content="Sign out" Style="{StaticResource LinkButton}"
                            Margin="12,0,0,0" Click="OnSignOut" />
                    <Button Grid.Column="2" Content="Quit" Style="{StaticResource LinkButton}"
                            Margin="12,0,0,0" Click="OnQuit" />

                    <!-- Selectable so it can be pasted into a support message rather than
                         transcribed by hand. -->
                    <TextBox Grid.Column="3"
                             x:Name="BuildLabel"
                             Style="{StaticResource MicroText}"
                             IsReadOnly="True"
                             BorderThickness="0"
                             Background="Transparent"
                             HorizontalAlignment="Right"
                             VerticalAlignment="Center" />
                </Grid>
```

`BuildLabel` changes from a `TextBlock` to a read-only `TextBox` so the stamp can be selected and
copied, matching macOS's `.textSelection(.enabled)`. `Render()` already assigns `BuildLabel.Text`,
and `TextBox` has the same property, so the code-behind needs no change.

**`MicroText` targets `TextBlock`**, so it will not apply to a `TextBox`. Either add a
`MicroFieldText` style targeting `TextBox` in `Tokens.xaml` with the same three setters, or set
`FontFamily`, `FontSize` and `Foreground` inline. Prefer the named style — an inline triple is
exactly the drift the token layer exists to prevent:

```xml
    <Style x:Key="MicroFieldText" TargetType="TextBox">
        <Setter Property="FontFamily" Value="{StaticResource UiFont}" />
        <Setter Property="FontSize" Value="11" />
        <Setter Property="Foreground" Value="{DynamicResource TextSecondary}" />
    </Style>
```

- [ ] **Step 3: Build and run the full suite**

```bash
cd apps/client-windows && dotnet build NiftyTimer.sln -c Release && dotnet test NiftyTimer.sln -c Release
```

Expected: 0 warnings, 0 errors, all green.

- [ ] **Step 4: Verify by running the app**

The whole deliverable is how it looks. With the app running, check:

1. The mark renders as a ring with a crown tick — not a blob, and with no seam where the two arcs meet.
2. Idle hides the hero timer; starting shows it and turns the dot and label the recording colour.
3. Totals read `—` before the first successful fetch, not `0m`.
4. The monitoring notice appears when there is something to say and cannot be dismissed.
5. **With the popup open**, switch Windows between light and dark. Everything re-themes in place, including the status dot, the button glyphs and the mark.
6. Buttons: idle shows one full-width Start; tracking shows Pause + prominent Stop; paused shows prominent Resume + Stop.

- [ ] **Step 5: Commit**

```bash
git add apps/client-windows/src/NiftyTimer/UI/TrayPopupWindow.xaml \
        apps/client-windows/src/NiftyTimer/UI/Tokens.xaml
git commit -m "feat(client): brand mark and two-column popup footer"
```

---

## Plan self-review

**Spec coverage.** Every row of the spec's PR 2 table maps to a task: status → 3, elapsed → 3,
totals → 3, project picker → 1 + 5, buttons → 4, footer → 6, brand → 2 + 6. The `MenuViewModel`
filtered projection with unit tests (spec, "the picker is the only genuine rewrite") is Task 1. The
`BrandMark` geometry constants and the `System.Windows.Shapes` collision note are both carried into
Task 2. "Already correct, do not fix" (`"—"` totals) and the deferred live-ticking totals are in
Global Constraints.

**Type consistency.** `PickerItem(ProjectName, TaskName, ProjectId, TaskId)` is defined in Task 1 and
consumed unchanged in Task 5. `RenderStatus`, `RenderControls`, `RenderPicker` and `RefreshTheme` are
each defined once. `PrimaryButton` / `SecondaryButton` (Task 4) do not collide with `SearchBox` /
`ProjectList` (Task 5) or `StatusDot` / `StatusLabel` / `ElapsedLabel` (Task 3).

**Known soft spots**, flagged rather than hidden:

- **Task 3's `FindResource` brushes are assigned, not bound.** That is why `RefreshTheme()` exists.
  If the reviewer prefers, the cleaner fix is a `DataTrigger` in markup — but the window has no
  `DataContext`, so that would mean the MVVM migration R1 rules out. Revisit in PR 3 if the theme
  swap misses anything.
- **Task 5's 220px list height is a judgement call**, not a spec value. macOS computes
  `min(rows * 36, 300)`; a fixed height is the Windows equivalent given `SizeToContent="Height"`, and
  it is the number most likely to need adjusting after the first look at the running app.
- **`ThemeSweepTests` is a text scan.** It catches `{StaticResource Accent}` but not a brush assigned
  in code-behind — exactly what Task 3 introduces. `RefreshTheme()` is the compensating control, and
  it has no automated test. Verification step 5 in Task 6 is the check that matters.
