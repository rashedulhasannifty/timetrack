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
        File.ReadAllText(Path.Combine(ThemeSweepTests.UiDirectory(), "BrandMark.xaml"));

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
