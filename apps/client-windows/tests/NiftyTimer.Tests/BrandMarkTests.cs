using System.Xml.Linq;
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

    private static XDocument XamlDoc() =>
        XDocument.Parse(Markup());

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
        // elapsed sweep rather than its 108-degree complement. Exactly one True, exactly one False.
        var markup = Markup();
        Assert.Equal(1, Count(markup, "IsLargeArc=\"True\""));
        Assert.Equal(1, Count(markup, "IsLargeArc=\"False\""));
    }

    [Fact]
    public void BothArcsUseClockwiseSweepDirection()
    {
        // Both arcs must run the same direction, and it must be Clockwise to match the dashboard.
        var markup = Markup();
        Assert.Equal(2, Count(markup, "SweepDirection=\"Clockwise\""));
    }

    [Fact]
    public void TheStrokeIsTheDashboardsWidthWithButtCaps()
    {
        var markup = Markup();

        // Each of the two arcs must have these attributes. Butt caps, not round: at 18px a round
        // cap reads as a bulge and the two arcs stop meeting flush.
        Assert.Equal(2, Count(markup, "StrokeThickness=\"3.4\""));
        Assert.Equal(2, Count(markup, "StrokeStartLineCap=\"Flat\""));
        Assert.Equal(2, Count(markup, "StrokeEndLineCap=\"Flat\""));
    }

    [Fact]
    public void TheArcSizeIsConsistentOnBothArcs()
    {
        // Both arcs use the same radius (7.3, 7.3) to draw concentric rings.
        var markup = Markup();
        Assert.Equal(2, Count(markup, "Size=\"7.3,7.3\""));
    }

    [Fact]
    public void TheFirstArcCarriesMarkElapsedAndTheSecondCarriesMarkRemaining()
    {
        var doc = XamlDoc();
        var ns = XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml/presentation");

        // There are exactly two Path elements; the first uses MarkElapsed, the second MarkRemaining.
        var paths = doc.Descendants(ns + "Path").ToList();
        Assert.Equal(2, paths.Count);

        Assert.Contains("MarkElapsed", paths[0].Attribute("Stroke")?.Value ?? "");
        Assert.Contains("MarkRemaining", paths[1].Attribute("Stroke")?.Value ?? "");
    }

    [Fact]
    public void EachArcCarriesItsOwnStrokeProperties()
    {
        var doc = XamlDoc();
        var ns = XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml/presentation");

        var paths = doc.Descendants(ns + "Path").ToList();
        Assert.Equal(2, paths.Count);

        foreach (var path in paths)
        {
            Assert.NotNull(path.Attribute("StrokeThickness"));
            Assert.NotNull(path.Attribute("StrokeStartLineCap"));
            Assert.NotNull(path.Attribute("StrokeEndLineCap"));
            Assert.Equal("3.4", path.Attribute("StrokeThickness")?.Value);
            Assert.Equal("Flat", path.Attribute("StrokeStartLineCap")?.Value);
            Assert.Equal("Flat", path.Attribute("StrokeEndLineCap")?.Value);
        }
    }

    [Fact]
    public void TheCanvasElementIsTwentyFourSquare()
    {
        var doc = XamlDoc();
        var ns = XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml/presentation");

        var canvas = doc.Descendants(ns + "Canvas").FirstOrDefault();
        Assert.NotNull(canvas);
        Assert.Equal("24", canvas.Attribute("Width")?.Value);
        Assert.Equal("24", canvas.Attribute("Height")?.Value);
    }

    [Fact]
    public void TheCrownTickIsPositionedAndDimensionedCorrectly()
    {
        var doc = XamlDoc();
        var ns = XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml/presentation");

        var rectangle = doc.Descendants(ns + "Rectangle").FirstOrDefault();
        Assert.NotNull(rectangle);

        // Position
        Assert.Equal("11.1", rectangle.Attribute(XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml") + "Left")?.Value ??
                           rectangle.Attribute(XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml") + "Left")?.Value ??
                           rectangle.Attribute("Canvas.Left")?.Value);
        Assert.Equal("1.7", rectangle.Attribute(XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml") + "Top")?.Value ??
                          rectangle.Attribute(XNamespace.Get("http://schemas.microsoft.com/winfx/2006/xaml") + "Top")?.Value ??
                          rectangle.Attribute("Canvas.Top")?.Value);

        // Dimensions
        Assert.Equal("1.8", rectangle.Attribute("Width")?.Value);
        Assert.Equal("3.4", rectangle.Attribute("Height")?.Value);
        Assert.Equal("0.9", rectangle.Attribute("RadiusX")?.Value);
        Assert.Equal("0.9", rectangle.Attribute("RadiusY")?.Value);

        // Fill
        Assert.Contains("Text", rectangle.Attribute("Fill")?.Value ?? "");
    }

    private static int Count(string text, string substring)
    {
        var count = 0;
        var index = 0;
        while ((index = text.IndexOf(substring, index, StringComparison.Ordinal)) != -1)
        {
            count++;
            index += substring.Length;
        }

        return count;
    }
}
