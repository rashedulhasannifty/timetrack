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

    [Theory]
    [InlineData("tray-idle-light.ico", 0x73, 0x72, 0x6C)]
    [InlineData("tray-tracking-light.ico", 0x0F, 0x76, 0x6E)]
    [InlineData("tray-idle-dark.ico", 0x9D, 0x9D, 0x97)]
    [InlineData("tray-tracking-dark.ico", 0x43, 0xC0, 0xAF)]
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
    public void LightThemeIconsAreDarkEnoughToReadOnALightTaskbar(string file)
    {
        var (r, g, b) = FindOpaquePixelColor(ReadXorBitmap(file));
        var luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);

        Assert.True(luminance < 128, $"{file} is too light ({luminance:F0}/255) for a light taskbar.");
    }

    [Theory]
    [InlineData("tray-idle-dark.ico")]
    [InlineData("tray-tracking-dark.ico")]
    public void DarkThemeIconsAreLightEnoughToReadOnADarkTaskbar(string file)
    {
        var (r, g, b) = FindOpaquePixelColor(ReadXorBitmap(file));
        var luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);

        Assert.True(luminance > 128, $"{file} is too dark ({luminance:F0}/255) for a dark taskbar.");
    }
}
