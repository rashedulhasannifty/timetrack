using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// Headless stand-in for task-8's step 8 ("verify against both taskbars") — no agent in this
/// session had display access to actually look at a taskbar. This proves the artifact instead: it
/// decodes the real generated <c>.ico</c> bytes (the same files the csproj embeds and the app
/// loads) and asserts the fully-opaque pixel of each carries the exact colour
/// <c>generate-tray-icons.ps1</c> was told to draw, and that light-theme icons are dark enough —
/// and dark-theme icons light enough — to read against the taskbar they are meant for.
///
/// This narrows, but does not close, the un-performed manual check: it proves the generator wrote
/// the intended pixels, not that Explorer renders them legibly at 16x16 on a real display. A human
/// still needs to run task-8 brief Step 8.
/// </summary>
public class TrayIconGenerationTests
{
    private const int Size = 16;

    /// <summary>
    /// The exact layout <c>generate-tray-icons.ps1</c> writes: a 6-byte ICONDIR, one 16-byte
    /// ICONDIRENTRY (offset field always 22, matching 6 + 16), then a 40-byte BITMAPINFOHEADER
    /// starting at 22, so the XOR pixel data — 32bpp BGRA, bottom-up — starts at byte 62.
    /// </summary>
    private const int XorOffset = 22 + 40;

    private static string ResourcesDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "src")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "src", "NiftyTimer", "Resources");
    }

    private static byte[] ReadXorBitmap(string file)
    {
        var path = Path.Combine(ResourcesDirectory(), file);
        Assert.True(File.Exists(path), $"{file} is missing — did generate-tray-icons.ps1 run?");

        var bytes = File.ReadAllBytes(path);
        var xorLength = Size * Size * 4;
        var xor = new byte[xorLength];
        Array.Copy(bytes, XorOffset, xor, 0, xorLength);
        return xor;
    }

    /// <summary>
    /// Every icon the generator draws — hollow ring or filled disc — has at least one fully-opaque
    /// pixel at its own body, regardless of where the antialiased rim falls, so this does not need
    /// to know which pixel that is.
    /// </summary>
    private static (byte R, byte G, byte B) FindOpaquePixelColor(byte[] xor)
    {
        for (var i = 0; i < xor.Length; i += 4)
        {
            if (xor[i + 3] == 255)
            {
                // Stored BGRA.
                return (xor[i + 2], xor[i + 1], xor[i + 0]);
            }
        }

        throw new InvalidOperationException("No fully-opaque pixel found in the icon.");
    }

    /// <summary>One pixel, by image coordinates (y down), from the bottom-up BGRA bitmap.</summary>
    private static (byte R, byte G, byte B, byte A) PixelAt(byte[] xor, int x, int y)
    {
        var row = Size - 1 - y;
        var i = ((row * Size) + x) * 4;
        return (xor[i + 2], xor[i + 1], xor[i + 0], xor[i + 3]);
    }

    private static readonly string[] AllIcons =
    [
        "tray-idle-light.ico", "tray-idle-dark.ico",
        "tray-tracking-light.ico", "tray-tracking-dark.ico",
        "tray-capturing-light.ico", "tray-capturing-dark.ico",
        "tray-idle-warning-light.ico", "tray-idle-warning-dark.ico",
        "tray-tracking-warning-light.ico", "tray-tracking-warning-dark.ico",
    ];

    [Theory]
    [InlineData("tray-idle-light.ico", 0x73, 0x72, 0x6C)]
    [InlineData("tray-tracking-light.ico", 0x0F, 0x76, 0x6E)]
    [InlineData("tray-capturing-light.ico", 0x0F, 0x76, 0x6E)]
    [InlineData("tray-idle-dark.ico", 0x9D, 0x9D, 0x97)]
    [InlineData("tray-tracking-dark.ico", 0x43, 0xC0, 0xAF)]
    [InlineData("tray-capturing-dark.ico", 0x43, 0xC0, 0xAF)]
    public void GeneratedIconCarriesTheColourTheGeneratorWasToldToDraw(
        string file, byte r, byte g, byte b)
    {
        var (actualR, actualG, actualB) = FindOpaquePixelColor(ReadXorBitmap(file));

        Assert.Equal(r, actualR);
        Assert.Equal(g, actualG);
        Assert.Equal(b, actualB);
    }

    /// <summary>
    /// The requirement itself, not just the means to it: a light taskbar needs a dark mark. Uses
    /// perceptual (luma-weighted) brightness rather than a flat channel average, since the eye
    /// weights green far more than blue.
    /// </summary>
    [Theory]
    [InlineData("tray-idle-light.ico")]
    [InlineData("tray-tracking-light.ico")]
    [InlineData("tray-capturing-light.ico")]
    public void LightThemeIconsAreDarkEnoughToReadOnALightTaskbar(string file)
    {
        var (r, g, b) = FindOpaquePixelColor(ReadXorBitmap(file));
        var luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);

        Assert.True(luminance < 128, $"{file} is too light ({luminance:F0}/255) for a light taskbar.");
    }

    [Theory]
    [InlineData("tray-idle-dark.ico")]
    [InlineData("tray-tracking-dark.ico")]
    [InlineData("tray-capturing-dark.ico")]
    public void DarkThemeIconsAreLightEnoughToReadOnADarkTaskbar(string file)
    {
        var (r, g, b) = FindOpaquePixelColor(ReadXorBitmap(file));
        var luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);

        Assert.True(luminance > 128, $"{file} is too dark ({luminance:F0}/255) for a dark taskbar.");
    }

    /// <summary>
    /// The capture flash must differ from tracking by SHAPE, not only colour — it is the same
    /// colour on purpose. A clear ring around a solid centre, where tracking is solid throughout.
    /// </summary>
    [Theory]
    [InlineData("tray-capturing-light.ico", "tray-tracking-light.ico")]
    [InlineData("tray-capturing-dark.ico", "tray-tracking-dark.ico")]
    public void TheCaptureFlashIsALensNotADisc(string capturing, string tracking)
    {
        var lens = ReadXorBitmap(capturing);
        var disc = ReadXorBitmap(tracking);

        Assert.Equal(255, PixelAt(lens, 7, 7).A); // the centre dot
        Assert.Equal(0, PixelAt(lens, 5, 7).A); // the clear ring
        Assert.Equal(255, PixelAt(disc, 5, 7).A); // where tracking is solid
    }

    /// <summary>The warning is the palette's amber, dark on a light taskbar and light on a dark one.</summary>
    [Theory]
    [InlineData("tray-idle-warning-light.ico", 0xB4, 0x53, 0x09)]
    [InlineData("tray-tracking-warning-light.ico", 0xB4, 0x53, 0x09)]
    [InlineData("tray-idle-warning-dark.ico", 0xFB, 0xBF, 0x24)]
    [InlineData("tray-tracking-warning-dark.ico", 0xFB, 0xBF, 0x24)]
    public void WarningIconsCarryAnAmberBadgeInTheCorner(string file, byte r, byte g, byte b) =>
        Assert.Equal((r, g, b, (byte)255), PixelAt(ReadXorBitmap(file), 12, 12));

    /// <summary>
    /// The badge sits apart from the mark behind a clear gap, and adding it leaves the rest of the
    /// mark exactly as it was — a warning must never make the tracking state harder to read.
    /// </summary>
    [Theory]
    [InlineData("tray-idle-warning-light.ico", "tray-idle-light.ico")]
    [InlineData("tray-tracking-warning-light.ico", "tray-tracking-light.ico")]
    [InlineData("tray-idle-warning-dark.ico", "tray-idle-dark.ico")]
    [InlineData("tray-tracking-warning-dark.ico", "tray-tracking-dark.ico")]
    public void TheBadgeIsSeparatedFromAnOtherwiseUnchangedMark(string warning, string plain)
    {
        var badged = ReadXorBitmap(warning);
        var mark = ReadXorBitmap(plain);

        Assert.Equal(0, PixelAt(badged, 10, 10).A); // the gap
        Assert.Equal(PixelAt(mark, 2, 7), PixelAt(badged, 2, 7)); // the far side of the mark
        Assert.Equal(PixelAt(mark, 7, 2), PixelAt(badged, 7, 2));
    }

    /// <summary>A file on disk is not enough: the project copies icons by explicit name.</summary>
    [Fact]
    public void EveryIconIsCopiedByTheProjectFile()
    {
        var csproj = File.ReadAllText(Path.Combine(ResourcesDirectory(), "..", "NiftyTimer.csproj"));

        foreach (var icon in AllIcons)
        {
            Assert.True(File.Exists(Path.Combine(ResourcesDirectory(), icon)), $"{icon} is missing.");
            Assert.Contains($@"Resources\{icon}", csproj, StringComparison.Ordinal);
        }
    }
}
