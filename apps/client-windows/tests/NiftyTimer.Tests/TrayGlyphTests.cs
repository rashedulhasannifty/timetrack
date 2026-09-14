using NiftyTimer.App;
using NiftyTimer.UI;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// Which icon the tray draws. The controller itself needs a real shell to construct, so the
/// decision is a pure function and is pinned here.
/// </summary>
public class TrayGlyphTests
{
    /// <summary>The capture flash shows over either state — the Mac flashes over both too.</summary>
    [Fact]
    public void TheFlashWinsOverEitherState()
    {
        Assert.Equal(TrayGlyph.Capturing, TrayIconController.GlyphFor(TrayState.Tracking, capturing: true));
        Assert.Equal(TrayGlyph.Capturing, TrayIconController.GlyphFor(TrayState.Idle, capturing: true));
    }

    [Fact]
    public void WithoutAFlashTheGlyphIsTheState()
    {
        Assert.Equal(TrayGlyph.Tracking, TrayIconController.GlyphFor(TrayState.Tracking, capturing: false));
        Assert.Equal(TrayGlyph.Idle, TrayIconController.GlyphFor(TrayState.Idle, capturing: false));
    }

    /// <summary>The badge rides on the tracking state rather than replacing it.</summary>
    [Fact]
    public void TheBadgeSitsOnIdleAndTracking()
    {
        Assert.Equal((TrayGlyph.Tracking, true), TrayIconController.IconFor(TrayState.Tracking, capturing: false, warning: true));
        Assert.Equal((TrayGlyph.Idle, true), TrayIconController.IconFor(TrayState.Idle, capturing: false, warning: true));
        Assert.Equal((TrayGlyph.Tracking, false), TrayIconController.IconFor(TrayState.Tracking, capturing: false, warning: false));
    }

    /// <summary>The flash shows nothing else, and there is no badged lens to show.</summary>
    [Fact]
    public void TheFlashShowsNoBadge()
    {
        Assert.Equal((TrayGlyph.Capturing, false), TrayIconController.IconFor(TrayState.Tracking, capturing: true, warning: true));
        Assert.DoesNotContain((TrayGlyph.Capturing, true), TrayIconController.Marks());
    }

    [Fact]
    public void FileNamesMatchTheGenerator()
    {
        Assert.Equal("tray-capturing-dark.ico", TrayIconController.FileName(TrayGlyph.Capturing, warning: false, AppTheme.Dark));
        Assert.Equal("tray-tracking-light.ico", TrayIconController.FileName(TrayGlyph.Tracking, warning: false, AppTheme.Light));
        Assert.Equal("tray-idle-warning-light.ico", TrayIconController.FileName(TrayGlyph.Idle, warning: true, AppTheme.Light));
        Assert.Equal("tray-tracking-warning-dark.ico", TrayIconController.FileName(TrayGlyph.Tracking, warning: true, AppTheme.Dark));
    }

    /// <summary>
    /// The controller loads every mark at construction and throws on a missing file, so a name the
    /// generator does not write would stop the app starting. Checked here, headlessly.
    /// </summary>
    [Fact]
    public void EveryIconTheControllerLoadsExistsOnDisk()
    {
        var resources = Path.Combine(Path.GetDirectoryName(ThemeSweepTests.UiDirectory())!, "Resources");

        foreach (var (glyph, warning) in TrayIconController.Marks())
        {
            foreach (var theme in new[] { AppTheme.Light, AppTheme.Dark })
            {
                var file = TrayIconController.FileName(glyph, warning, theme);
                Assert.True(File.Exists(Path.Combine(resources, file)), $"{file} is missing.");
            }
        }
    }

    [Fact]
    public void EveryGlyphHasAMark()
    {
        foreach (var glyph in Enum.GetValues<TrayGlyph>())
        {
            Assert.Contains((glyph, false), TrayIconController.Marks());
        }
    }
}

/// <summary>The AppDelegate half, pinned with the shared IL scanner.</summary>
public class TrayMarkerWiringTests
{
    [Fact]
    public void TheSchedulerReportsCapturesToTheFlash() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("InstallScreenshotCapture"), nameof(AppDelegate), "OnScreenshotCaptured"),
            "AppDelegate.InstallScreenshotCapture no longer hands OnScreenshotCaptured to the scheduler.");

    [Fact]
    public void ACaptureHopsToTheUiThreadBeforeFlashing() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("OnScreenshotCaptured"), nameof(AppDelegate), "ShowScreenshotTaken"),
            "AppDelegate.OnScreenshotCaptured no longer marshals to ShowScreenshotTaken.");

    [Fact]
    public void ACaptureFlashesTheTray() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("ShowScreenshotTaken"), nameof(TrayIconController), nameof(TrayIconController.FlashCapturing)),
            "AppDelegate.ShowScreenshotTaken no longer flashes the tray icon.");

    [Fact]
    public void TheTrayRefreshSetsTheWarningBadge() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("UpdateTray"), nameof(TrayIconController), "set_Warning"),
            "AppDelegate.UpdateTray no longer sets the tray's warning badge.");
}
