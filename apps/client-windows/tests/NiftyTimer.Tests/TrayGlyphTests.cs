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

    [Fact]
    public void FileNamesMatchTheGenerator()
    {
        Assert.Equal("tray-capturing-dark.ico", TrayIconController.FileName(TrayGlyph.Capturing, AppTheme.Dark));
        Assert.Equal("tray-tracking-light.ico", TrayIconController.FileName(TrayGlyph.Tracking, AppTheme.Light));
        Assert.Equal("tray-idle-light.ico", TrayIconController.FileName(TrayGlyph.Idle, AppTheme.Light));
    }

    /// <summary>
    /// The controller loads every glyph at construction and throws on a missing file, so a name
    /// the generator does not write would stop the app starting. Checked here, headlessly.
    /// </summary>
    [Fact]
    public void EveryGlyphTheControllerLoadsExistsOnDisk()
    {
        var resources = Path.Combine(Path.GetDirectoryName(ThemeSweepTests.UiDirectory())!, "Resources");

        foreach (var glyph in Enum.GetValues<TrayGlyph>())
        {
            foreach (var theme in new[] { AppTheme.Light, AppTheme.Dark })
            {
                var file = TrayIconController.FileName(glyph, theme);
                Assert.True(File.Exists(Path.Combine(resources, file)), $"{file} is missing.");
            }
        }
    }
}

/// <summary>The screenshot → flash path, pinned with the shared IL scanner.</summary>
public class CaptureFlashWiringTests
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
}
