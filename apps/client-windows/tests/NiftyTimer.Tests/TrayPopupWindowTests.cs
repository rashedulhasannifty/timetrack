using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using NiftyTimer.App;
using NiftyTimer.Projects;
using NiftyTimer.Storage;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using NiftyTimer.UI;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// Task 7 swapped <c>AllowsTransparency="True"</c> (window bounds == card bounds, by construction,
/// because a transparent window paints nothing of its own) for a real window frame that DWM rounds
/// via <c>DWMWA_WINDOW_CORNER_PREFERENCE</c>. <see cref="TrayPopupWindow.ShowNearTray"/>'s Left/Top
/// math — <c>SystemParameters.WorkArea</c> minus <c>Width</c>/<c>ActualHeight</c> — was written
/// against that transparent window, so this is the moment a shift would appear: if dropping
/// transparency had reintroduced any OS-drawn non-client frame, the card would sit inset from the
/// corner <c>ShowNearTray</c> targets even though the formula itself is untouched.
///
/// No agent in this session had display access to perform the brief's Step 3 by eye. This proves
/// the same code path headlessly: it runs the real <c>ShowNearTray</c> against the real (now
/// non-transparent) window and checks that the content <see cref="Border"/> still fills the
/// window's own layout bounds exactly, at the corner <c>ShowNearTray</c> computes. It does NOT
/// prove no OS-level non-client pixel was added outside WPF's own layout system (that class of
/// regression only shows up on screen) — Step 3's manual/visual check still stands as unperformed.
/// </summary>
[Collection("wpf")]
public class TrayPopupWindowPositionTests
{
    [Fact]
    public void ShowNearTrayAnchorsFlushToTheWorkAreaCornerWithNoLayoutGap()
    {
        var (left, top, windowWidth, windowHeight, borderWidth, borderHeight, work) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()));
            var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");

            try
            {
                window.ShowNearTray();

                // ShowNearTray queues a Loaded-priority callback to correct Top once
                // SizeToContent has actually measured the window. An empty Invoke at the same
                // priority runs behind it in FIFO order, so this returns only once that
                // correction has already happened.
                window.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);

                var border = (Border)window.Content;
                return (
                    window.Left,
                    window.Top,
                    window.ActualWidth,
                    window.ActualHeight,
                    border.ActualWidth,
                    border.ActualHeight,
                    SystemParameters.WorkArea);
            }
            finally
            {
                // OnClosing cancels every close unless this is set — without it the window leaks
                // into the shared "wpf" dispatcher for the rest of the test run.
                window.AllowClose = true;
                window.Close();
            }
        });

        // Width is fixed (SizeToContent="Height" only, per the brief); ActualHeight only settles
        // after the first layout pass, which is exactly why ShowNearTray corrects Top
        // asynchronously rather than trusting it immediately after Show(). The tolerance (rather
        // than exact equality) is for HWND placement snapping to the physical pixel grid at the
        // active DPI scale — that snapping happens on Left/Top regardless of AllowsTransparency,
        // so up to one device pixel of slack is expected and is not itself a regression.
        Assert.True(
            Math.Abs(work.Right - 340 - 12 - left) < 1.0,
            $"Left={left}, expected near {work.Right - 340 - 12}");
        Assert.True(
            Math.Abs(work.Bottom - windowHeight - 12 - top) < 1.0,
            $"Top={top}, expected near {work.Bottom - windowHeight - 12}");

        // The content Border still fills the window's own layout bounds exactly, i.e. WPF added
        // no margin/frame of its own between the window edge and the card that ShowNearTray's
        // formula assumes are the same rectangle.
        Assert.Equal(340d, windowWidth, precision: 3);
        Assert.Equal(windowWidth, borderWidth, precision: 3);
        Assert.Equal(windowHeight, borderHeight, precision: 3);
    }
}

/// <summary>
/// The fix for the popup growing past its own anchor when the phase changes while it is open.
/// <see cref="TrayPopupWindow.ShowNearTray"/> anchors the window's bottom edge 12px above the work
/// area, but the window is <c>SizeToContent="Height"</c>: <see cref="TrayPopupWindow"/>'s private
/// <c>RenderStatus</c> reveals <c>ElapsedLabel</c> (the hero timer) when tracking starts, growing
/// the window downward. Without a handler re-anchoring on that size change, <c>Top</c> stays at the
/// value <c>ShowNearTray</c> computed for the shorter, idle content, and the popup's new bottom
/// edge overlaps the taskbar instead of clearing it.
/// </summary>
[Collection("wpf")]
public class TrayPopupWindowReanchorTests
{
    [Fact]
    public void StartingWhileOpenGrowsTheWindowAndReanchorsTopSoTheBottomEdgeStaysFixed()
    {
        var (topBefore, topAfter, heightBefore, heightAfter, work) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()));
            var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");

            try
            {
                viewModel.IsReady = true;

                window.ShowNearTray();
                window.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);

                var topBeforeStart = window.Top;
                var heightBeforeStart = window.ActualHeight;

                // Reveals ElapsedLabel -- the hero timer plus its margin -- growing the window's
                // SizeToContent height while it is already open and visible. This is the exact
                // "opens idle, presses Start" sequence the fix addresses.
                viewModel.Start();

                // Flush the dispatcher so the layout pass Start's PropertyChanged triggers (and the
                // SizeChanged handler it drives) has actually completed before asserting.
                window.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);

                return (
                    topBeforeStart,
                    window.Top,
                    heightBeforeStart,
                    window.ActualHeight,
                    SystemParameters.WorkArea);
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });

        // The content actually grew -- otherwise this would not be exercising the bug at all.
        Assert.True(
            heightAfter > heightBefore,
            $"Expected the window to grow: before={heightBefore}, after={heightAfter}");

        // Without the fix, Top never moves and the bottom edge drifts past the anchor as the
        // window grows. With the fix, Top re-anchors so the bottom edge stays 12px above the work
        // area's bottom, same as ShowNearTray's own formula.
        Assert.True(
            Math.Abs(work.Bottom - heightAfter - 12 - topAfter) < 1.0,
            $"Top={topAfter}, expected near {work.Bottom - heightAfter - 12}");

        Assert.NotEqual(topBefore, topAfter);
    }
}

/// <summary>
/// Task 4's <c>RenderControls()</c> resolves <c>"PlayGlyph"</c>/<c>"PauseGlyph"</c>/<c>"StopGlyph"</c>
/// and <c>"ProminentButton"</c>/<c>"BorderedButton"</c> by string key via <c>FindResource</c>. The
/// idle branch already runs at construction (every other test in this file exercises it as a side
/// effect), so a misspelled idle key was already caught. The tracking and paused branches were not:
/// nothing else in the suite drives the tracker into either state, so <c>FindResource("PauseGlyph")</c>
/// and <c>FindResource("StopGlyph")</c> were unresolved by any test — a typo there throws
/// <see cref="ResourceReferenceKeyNotFoundException"/> at the exact moment a real user starts
/// tracking, and no build or test would have caught it.
///
/// This drives one real <see cref="MenuViewModel"/>/<see cref="TrayPopupWindow"/> pair through all
/// three phases and asserts the concrete style, glyph and label each button ends up with, plus the
/// idle full-row span fixed in the same change — a test that only checked "did not throw" would not
/// fail if a style or glyph key were swapped for the wrong one.
/// </summary>
[Collection("wpf")]
public class TrayPopupWindowControlsTests
{
    private readonly record struct ButtonState(
        Style Style,
        Geometry Glyph,
        string Label,
        bool Enabled,
        Visibility Visibility,
        int ColumnSpan,
        object? ToolTip);

    private readonly record struct PairState(ButtonState Primary, ButtonState Secondary);

    [Fact]
    public void ThePrimarySecondaryPairMatchesEachPhaseAndIdleFillsTheRow()
    {
        var (idle, tracking, paused, prominent, bordered, playGlyph, pauseGlyph, stopGlyph) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()));
            var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");

            try
            {
                window.ShowNearTray();

                // Same synchronisation as TrayPopupWindowPositionTests: waits out ShowNearTray's
                // queued Loaded-priority Top correction so the window has been through a real
                // layout pass before anything is asserted.
                window.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);

                var prominentStyle = (Style)window.FindResource("ProminentButton");
                var borderedStyle = (Style)window.FindResource("BorderedButton");
                var play = (Geometry)window.FindResource("PlayGlyph");
                var pause = (Geometry)window.FindResource("PauseGlyph");
                var stop = (Geometry)window.FindResource("StopGlyph");

                PairState Capture() => new(
                    new ButtonState(
                        window.PrimaryButton.Style,
                        window.PrimaryGlyph.Data,
                        window.PrimaryLabel.Text,
                        window.PrimaryButton.IsEnabled,
                        window.PrimaryButton.Visibility,
                        Grid.GetColumnSpan(window.PrimaryButton),
                        window.PrimaryButton.ToolTip),
                    new ButtonState(
                        window.SecondaryButton.Style,
                        window.SecondaryGlyph.Data,
                        window.SecondaryLabel.Text,
                        window.SecondaryButton.IsEnabled,
                        window.SecondaryButton.Visibility,
                        Grid.GetColumnSpan(window.SecondaryButton),
                        window.SecondaryButton.ToolTip));

                // Idle: not ready yet, matching a fresh sign-in. CanStart is false, so this also
                // covers the disabled/ack-gate tooltip path.
                var idleState = Capture();

                viewModel.IsReady = true;
                viewModel.Start();
                var trackingState = Capture();

                viewModel.Pause();
                var pausedState = Capture();

                return (
                    idleState,
                    trackingState,
                    pausedState,
                    prominentStyle,
                    borderedStyle,
                    play,
                    pause,
                    stop);
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });

        // Idle: only Start, spanning the full row (the item 1 fix — SecondaryButton is collapsed
        // but its column would otherwise still be reserved, leaving Start at half width).
        Assert.Same(prominent, idle.Primary.Style);
        Assert.Same(playGlyph, idle.Primary.Glyph);
        Assert.Equal("Start", idle.Primary.Label);
        Assert.False(idle.Primary.Enabled);
        Assert.Equal(3, idle.Primary.ColumnSpan);
        Assert.Equal("Acknowledge the monitoring policy to begin", idle.Primary.ToolTip);
        Assert.Equal(Visibility.Collapsed, idle.Secondary.Visibility);

        // Tracking: bordered Pause primary, prominent Stop secondary, both enabled, no stale
        // ack-gate tooltip on either.
        Assert.Same(bordered, tracking.Primary.Style);
        Assert.Same(pauseGlyph, tracking.Primary.Glyph);
        Assert.Equal("Pause", tracking.Primary.Label);
        Assert.True(tracking.Primary.Enabled);
        Assert.Equal(1, tracking.Primary.ColumnSpan);
        Assert.Null(tracking.Primary.ToolTip);

        Assert.Same(prominent, tracking.Secondary.Style);
        Assert.Same(stopGlyph, tracking.Secondary.Glyph);
        Assert.Equal("Stop", tracking.Secondary.Label);
        Assert.True(tracking.Secondary.Enabled);
        Assert.Equal(Visibility.Visible, tracking.Secondary.Visibility);
        Assert.Null(tracking.Secondary.ToolTip);

        // Paused: prominent Resume primary, bordered Stop secondary — the inverse of tracking.
        Assert.Same(prominent, paused.Primary.Style);
        Assert.Same(playGlyph, paused.Primary.Glyph);
        Assert.Equal("Resume", paused.Primary.Label);
        Assert.True(paused.Primary.Enabled);
        Assert.Equal(1, paused.Primary.ColumnSpan);
        Assert.Null(paused.Primary.ToolTip);

        Assert.Same(bordered, paused.Secondary.Style);
        Assert.Same(stopGlyph, paused.Secondary.Glyph);
        Assert.Equal("Stop", paused.Secondary.Label);
        Assert.True(paused.Secondary.Enabled);
        Assert.Equal(Visibility.Visible, paused.Secondary.Visibility);
        Assert.Null(paused.Secondary.ToolTip);
    }
}

/// <summary>
/// Task 5 picker rewrite. <see cref="TrayPopupWindow.RenderPicker"/> reassigns
/// <c>ProjectList.ItemsSource</c> from <see cref="MenuViewModel.FilteredChoices"/>, which
/// allocates a fresh <c>List&lt;PickerItem&gt;</c> on every read, and <see cref="MenuViewModel.Tick"/>
/// drives <c>Render()</c> once a second while the popup is visible, regardless of tracking state
/// (it raises <c>ElapsedLabel</c> unconditionally). An unconditional reassignment there would hand
/// the ListBox a brand-new collection every second: reassigning <c>ItemsSource</c> regenerates the
/// item containers and resets the scroll offset to the top, so anyone scrolled into a long project
/// list would be snapped back to row one once a second while the popup just sits open. The guard,
/// a <c>SequenceEqual</c> against the previous source (<c>PickerItem</c> is a record, so this
/// compares by value), exists to prevent exactly that, and is the fix this class covers.
/// </summary>
[Collection("wpf")]
public class TrayPopupWindowPickerTests
{
    private static (MenuViewModel ViewModel, TrayPopupWindow Window) Build(TimeTracker tracker)
    {
        var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()));
        var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");

        viewModel.IsReady = true;
        viewModel.Projects =
        [
            new Project("p1", "team", "Acme Website", false, [new ProjectTask("t1", "p1", "Redesign")]),
            new Project("p2", "team", "Internal Tools", false, []),
            new Project("p3", "team", "Zephyr Migration", false, [new ProjectTask("t3", "p3", "Planning")]),
        ];

        window.ShowNearTray();
        window.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);
        return (viewModel, window);
    }

    /// <summary>
    /// The fix itself: a Render() pass that leaves the filtered projection unchanged must not hand
    /// the ListBox a new ItemsSource. Without the guard in RenderPicker this fails, because
    /// FilteredChoices allocates a fresh list on every read even when its contents are identical.
    /// </summary>
    [Fact]
    public void TickDoesNotReassignItemsSourceWhenTheFilteredProjectionIsUnchanged()
    {
        var (before, after) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var (viewModel, window) = Build(tracker);

            try
            {
                var beforeSource = window.ProjectList.ItemsSource;

                // Tick() raises PropertyChanged(ElapsedLabel) unconditionally while the popup is
                // visible, which drives Render() then RenderPicker() with no change to Projects or
                // Query -- the exact per-second path that reset the ListBox scroll position before
                // the guard existed.
                viewModel.Tick();
                viewModel.Tick();

                var afterSource = window.ProjectList.ItemsSource;
                return (beforeSource, afterSource);
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });

        Assert.Same(before, after);
    }

    /// <summary>
    /// When the guard above blocks reassignment, ProjectList.ItemsSource still holds the OLD
    /// FilteredChoices list, but RenderPicker resolves SelectedItem from a FRESH read of
    /// SelectedChoice against Choices -- an instance allocated on this Render pass, not
    /// necessarily the same object already sitting in Items. The checkmark itself is driven off
    /// the ListBoxItem container's own IsSelected (the ControlTemplate.Trigger in
    /// TrayPopupWindow.xaml), not off object identity, so the real assertion worth making is that
    /// the container the guard left untouched actually reports selected -- proving the value-based
    /// resolution in RenderPicker reaches the visible checkmark, not just the SelectedItem field.
    /// </summary>
    [Fact]
    public void SelectedItemResolvesByValueWhenItemsSourceReassignmentIsGuarded()
    {
        var (sourceUnchanged, selectedProjectId, containerIsSelected) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var (viewModel, window) = Build(tracker);

            try
            {
                viewModel.Start();

                var beforeSource = window.ProjectList.ItemsSource;
                var target = (PickerItem)window.ProjectList.Items[2]!; // "Internal Tools", p2
                Assert.Equal("Internal Tools", target.ProjectName);

                // A real WPF selection change, the same path a click drives, through the actual
                // ListBox, with the query untouched since the last render, so RenderPicker's guard
                // is active for the Render() this selection triggers (via SelectProject then
                // RaiseTrackingState then PropertyChanged).
                window.ProjectList.SelectedItem = target;
                window.UpdateLayout();

                var afterSource = window.ProjectList.ItemsSource;
                var selected = (PickerItem)window.ProjectList.SelectedItem!;
                var container = (ListBoxItem?)window.ProjectList.ItemContainerGenerator.ContainerFromIndex(2);

                return (
                    ReferenceEquals(beforeSource, afterSource),
                    selected.ProjectId,
                    container?.IsSelected ?? false);
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });

        // The guard actually held for this selection -- otherwise this test would not be
        // exercising the case it claims to.
        Assert.True(sourceUnchanged, "Precondition failed: ItemsSource was reassigned, so the guard was not active for this selection.");

        Assert.Equal("p2", selectedProjectId);
        Assert.True(containerIsSelected, "The Internal Tools row's container never reported IsSelected -- the checkmark would not have shown.");
    }

    /// <summary>
    /// A user selection must reach <see cref="MenuViewModel.SelectProject"/> exactly once: not
    /// zero (the picker would silently ignore clicks), and not twice (SelectProject closes and
    /// reopens a running entry, so a second call would re-attribute a running span a second time
    /// for one click). RenderPicker's own SelectedItem assignment runs inside Render's
    /// <c>_suppressCallbacks = true</c> block specifically to prevent that second call; this proves
    /// it holds through the real handler, not just by inspection.
    /// </summary>
    [Fact]
    public void SelectingARowCallsSelectProjectExactlyOnce()
    {
        var (callCount, finalProjectId) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var (viewModel, window) = Build(tracker);

            try
            {
                viewModel.Start();

                // TrackingStarted fires once per SelectProject call that finds the tracker already
                // tracking (SelectProject closes and reopens the span). Subscribed only after the
                // initial Start() above, so it counts exclusively what the selection itself causes.
                var count = 0;
                viewModel.TrackingStarted += () => count++;

                var target = (PickerItem)window.ProjectList.Items[2]!; // "Internal Tools", p2
                window.ProjectList.SelectedItem = target;

                var state = Assert.IsType<TrackerState.Tracking>(tracker.State);
                return (count, state.Selection.ProjectId);
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });

        Assert.Equal(1, callCount);
        Assert.Equal("p2", finalProjectId);
    }

    /// <summary>
    /// End to end through the real window: typing into SearchBox reaches
    /// MenuViewModel.Query via OnSearchChanged, and the rendered ListBox narrows and restores
    /// through RenderPicker -- the whole path a person driving the popup actually exercises, not
    /// just Filter() exercised on the view model in isolation.
    /// </summary>
    [Fact]
    public void TypingInTheSearchBoxNarrowsTheRenderedListThroughTheRealHandler()
    {
        var (fullCount, narrowedCount, clearedCount) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var (_, window) = Build(tracker);

            try
            {
                // 3 projects, 2 of which carry one task each: 5 rows in all.
                var full = window.ProjectList.Items.Count;

                // "zephyr" matches ProjectName on both of p3's rows (the project row and its own
                // task row both carry the project name).
                window.SearchBox.Text = "zephyr";
                var narrowed = window.ProjectList.Items.Count;

                window.SearchBox.Text = string.Empty;
                var cleared = window.ProjectList.Items.Count;

                return (full, narrowed, cleared);
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });

        Assert.Equal(5, fullCount);
        Assert.Equal(2, narrowedCount);
        Assert.Equal(5, clearedCount);
    }
}

/// <summary>
/// <see cref="TrayPopupWindow.RefreshTheme"/> exists because the status dot and label are the only
/// two brushes assigned from C# anywhere in this window (<c>RenderStatus</c>) rather than bound
/// with <c>{DynamicResource}</c> in XAML, so unlike everything else they do not re-resolve on their
/// own when <see cref="ThemeWatcher.ApplyToApplication"/> swaps the merged dictionary.
///
/// <see cref="ThemeSweepTests"/> is a text scan over XAML and structurally cannot see that: it would
/// stay green even if a later change moved the <c>StatusDot.Fill</c>/<c>StatusLabel.Foreground</c>
/// assignment out of <c>Render()</c> into somewhere that never re-runs on a theme swap (the
/// constructor, say), which would leave the status dot silently stuck on the outgoing theme's
/// colour on a live swap. This drives a real window through both themes and asserts the brush by
/// identity against <c>FindResource</c>, so it names the invariant rather than hard-coding a hex
/// value, and it is the fence for that gap: with the assignment out of <c>Render()</c>/
/// <c>RenderStatus()</c> this fails.
///
/// Both roles RenderStatus can pick are covered, since they are different branches of its
/// <c>active ? Recording : TextSecondary</c> switch: the idle test below leaves the view model at
/// its constructed defaults (not tracking, not paused), and the active test drives a real Start().
/// </summary>
[Collection("wpf")]
public class TrayPopupWindowThemeRefreshTests
{
    [Fact]
    public void RefreshThemeRepaintsTheIdleStatusBrushesToTheNewThemesTextSecondary()
    {
        var (darkDot, darkLabel, darkExpected, lightDot, lightLabel, lightExpected) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()));
            var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");

            try
            {
                // Idle by construction: IsReady defaults to false, so neither tracking nor paused --
                // the TextSecondary branch of RenderStatus's role switch.
                window.ShowNearTray();
                window.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);

                ThemeWatcher.ApplyToApplication(AppTheme.Dark);
                window.RefreshTheme();
                var darkExpectedBrush = (Brush)window.FindResource("TextSecondary");
                var darkDotBrush = window.StatusDot.Fill;
                var darkLabelBrush = window.StatusLabel.Foreground;

                ThemeWatcher.ApplyToApplication(AppTheme.Light);
                window.RefreshTheme();
                var lightExpectedBrush = (Brush)window.FindResource("TextSecondary");
                var lightDotBrush = window.StatusDot.Fill;
                var lightLabelBrush = window.StatusLabel.Foreground;

                return (
                    darkDotBrush,
                    darkLabelBrush,
                    darkExpectedBrush,
                    lightDotBrush,
                    lightLabelBrush,
                    lightExpectedBrush);
            }
            finally
            {
                // Leave the shared, process-wide Application resources back the way every other
                // test in the "wpf" collection expects them.
                ThemeWatcher.ApplyToApplication(AppTheme.Light);
                window.AllowClose = true;
                window.Close();
            }
        });

        Assert.Same(darkExpected, darkDot);
        Assert.Same(darkExpected, darkLabel);
        Assert.Same(lightExpected, lightDot);
        Assert.Same(lightExpected, lightLabel);
    }

    [Fact]
    public void RefreshThemeRepaintsTheActiveStatusBrushesToTheNewThemesRecording()
    {
        var (darkDot, darkLabel, darkExpected, lightDot, lightLabel, lightExpected) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()));
            var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");

            try
            {
                // A real Start(), not a flag flip, so this exercises the same active branch of
                // RenderStatus's role switch a person tracking time actually reaches.
                viewModel.IsReady = true;
                viewModel.Start();

                window.ShowNearTray();
                window.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);

                ThemeWatcher.ApplyToApplication(AppTheme.Dark);
                window.RefreshTheme();
                var darkExpectedBrush = (Brush)window.FindResource("Recording");
                var darkDotBrush = window.StatusDot.Fill;
                var darkLabelBrush = window.StatusLabel.Foreground;

                ThemeWatcher.ApplyToApplication(AppTheme.Light);
                window.RefreshTheme();
                var lightExpectedBrush = (Brush)window.FindResource("Recording");
                var lightDotBrush = window.StatusDot.Fill;
                var lightLabelBrush = window.StatusLabel.Foreground;

                return (
                    darkDotBrush,
                    darkLabelBrush,
                    darkExpectedBrush,
                    lightDotBrush,
                    lightLabelBrush,
                    lightExpectedBrush);
            }
            finally
            {
                ThemeWatcher.ApplyToApplication(AppTheme.Light);
                window.AllowClose = true;
                window.Close();
            }
        });

        Assert.Same(darkExpected, darkDot);
        Assert.Same(darkExpected, darkLabel);
        Assert.Same(lightExpected, lightDot);
        Assert.Same(lightExpected, lightLabel);
    }
}
