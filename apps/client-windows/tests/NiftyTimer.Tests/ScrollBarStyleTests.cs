using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The `ScrollBar` template in `Styles.xaml` is a single shared `ControlTemplate` covering both
/// orientations, so its horizontal-only corrections — `PART_Track`'s `IsDirectionReversed`, and
/// the thumb's margin axis and min-size floor — live behind `Setter.TargetName`, which
/// `dotnet build` compiles to BAML without validating against the template's namescope. A bad
/// `TargetName` only throws the first time a `ScrollBar` is realized at runtime (AckWindow's
/// policy text, in practice), and a trigger that silently never fires would leave horizontal
/// exactly as broken as before — either way with a fully green build and the rest of this suite,
/// since nothing else here realizes a `ScrollBar`. This exercises the real style from the real
/// merged `Styles.xaml` (via <see cref="Wpf"/>, the same fixture `TrayPopupWindowPositionTests`
/// and <c>ThemeTests</c> use) for both orientations.
/// </summary>
[Collection("wpf")]
public class ScrollBarStyleTests
{
    [Theory]
    [InlineData(Orientation.Vertical, true)]
    [InlineData(Orientation.Horizontal, false)]
    public void TrackDirectionMatchesOrientation(Orientation orientation, bool expectedReversed)
    {
        var reversed = Wpf.Run(() =>
        {
            var track = RealizeTrack(orientation);
            return track.IsDirectionReversed;
        });

        Assert.Equal(expectedReversed, reversed);
    }

    [Fact]
    public void HorizontalThumbGetsATopBottomInsetAndAWidthFloor()
    {
        var (margin, minWidth, minHeight) = Wpf.Run(() =>
        {
            var thumb = RealizeTrack(Orientation.Horizontal).Thumb;
            return (thumb.Margin, thumb.MinWidth, thumb.MinHeight);
        });

        Assert.Equal(new Thickness(0, 3, 0, 3), margin);
        Assert.Equal(24, minWidth);
        Assert.Equal(0, minHeight);
    }

    [Fact]
    public void VerticalThumbGetsALeftRightInsetAndAHeightFloor()
    {
        var (margin, minHeight) = Wpf.Run(() =>
        {
            var thumb = RealizeTrack(Orientation.Vertical).Thumb;
            return (thumb.Margin, thumb.MinHeight);
        });

        Assert.Equal(new Thickness(3, 0, 3, 0), margin);
        Assert.Equal(24, minHeight);
    }

    /// <summary>
    /// Builds and templates a real <see cref="ScrollBar"/> against the app's own implicit style,
    /// then hands back its <c>PART_Track</c> — must run on the WPF dispatcher thread.
    /// </summary>
    private static Track RealizeTrack(Orientation orientation)
    {
        var bar = new ScrollBar
        {
            Orientation = orientation,
            Style = (Style)Application.Current.FindResource(typeof(ScrollBar)),
        };

        bar.ApplyTemplate();

        return (Track)bar.Template.FindName("PART_Track", bar);
    }
}
