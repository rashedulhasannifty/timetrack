using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// Headless stand-in for task-8's step 8 ("verify against both taskbars") — no agent in this
/// session had display access to actually look at a taskbar. This proves the artifact instead: it
/// decodes the real generated <c>.ico</c> bytes (the same files the csproj embeds and the app
/// loads) and asserts each frame carries the colours and shapes <c>generate-tray-icons.ps1</c> was
/// told to draw, and that every solid pixel of a light-theme icon is dark enough — and of a
/// dark-theme icon light enough — to read against the taskbar it is meant for.
///
/// This narrows, but does not close, the un-performed manual check: it proves the generator wrote
/// the intended pixels, not that Explorer renders them legibly on a real display. A human still
/// needs to run task-8 brief Step 8.
/// </summary>
public class TrayIconGenerationTests
{
    /// <summary>The frame the pixel-level assertions read: the notification area at 100%.</summary>
    private const int SmallestSize = 16;

    /// <summary>The notification area's size at 100%, 125%, 150% and 200% display scaling.</summary>
    private static readonly int[] FrameSizes = [16, 20, 24, 32];

    private static readonly string[] AllIcons =
    [
        "tray-idle-light.ico", "tray-idle-dark.ico",
        "tray-tracking-light.ico", "tray-tracking-dark.ico",
        "tray-capturing-light.ico", "tray-capturing-dark.ico",
        "tray-idle-warning-light.ico", "tray-idle-warning-dark.ico",
        "tray-tracking-warning-light.ico", "tray-tracking-warning-dark.ico",
    ];

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

    private static byte[] ReadIcon(string file)
    {
        var path = Path.Combine(ResourcesDirectory(), file);
        Assert.True(File.Exists(path), $"{file} is missing — did generate-tray-icons.ps1 run?");
        return File.ReadAllBytes(path);
    }

    /// <summary>The frame sizes an .ico's directory lists, in order.</summary>
    private static List<int> ListFrameSizes(byte[] icon)
    {
        var count = BitConverter.ToUInt16(icon, 4);
        var sizes = new List<int>();
        for (var i = 0; i < count; i++)
        {
            var width = icon[6 + (16 * i)];
            sizes.Add(width == 0 ? 256 : width);
        }

        return sizes;
    }

    /// <summary>
    /// One frame's XOR pixel data — 32bpp BGRA, bottom-up — found through the ICONDIR entry for its
    /// size, then past that image's 40-byte BITMAPINFOHEADER.
    /// </summary>
    private static byte[] ReadFrame(string file, int size)
    {
        var icon = ReadIcon(file);
        var sizes = ListFrameSizes(icon);
        var index = sizes.IndexOf(size);
        Assert.True(index >= 0, $"{file} has no {size}px frame.");

        var offset = (int)BitConverter.ToUInt32(icon, 6 + (16 * index) + 12);
        var xor = new byte[size * size * 4];
        Array.Copy(icon, offset + 40, xor, 0, xor.Length);
        return xor;
    }

    /// <summary>One pixel, by image coordinates (y down), from a 16px frame.</summary>
    private static (byte R, byte G, byte B, byte A) PixelAt(byte[] xor, int x, int y)
    {
        var row = SmallestSize - 1 - y;
        var i = ((row * SmallestSize) + x) * 4;
        return (xor[i + 2], xor[i + 1], xor[i + 0], xor[i + 3]);
    }

    private static byte[] Frame16(string file) => ReadFrame(file, SmallestSize);

    /// <summary>
    /// Every icon carries a drawn frame for each scaling, so the shell never stretches a 16px image
    /// — the blur that made the old mark fainter than it was drawn.
    /// </summary>
    [Fact]
    public void EveryIconCarriesAFrameForEachDisplayScaling()
    {
        foreach (var file in AllIcons)
        {
            Assert.Equal(FrameSizes, ListFrameSizes(ReadIcon(file)));
        }
    }

    /// <summary>
    /// The mark is the brand's two-tone ring: elapsed time round the right-hand side, remaining time
    /// up the left, each the exact colour the generator was told to draw for that taskbar.
    /// </summary>
    [Theory]
    [InlineData("tray-idle-light.ico", 0x1C, 0x1C, 0x19, 0x5E, 0x5D, 0x57)]
    [InlineData("tray-tracking-light.ico", 0x0F, 0x76, 0x6E, 0x3E, 0x86, 0x7D)]
    [InlineData("tray-capturing-light.ico", 0x0F, 0x76, 0x6E, 0x3E, 0x86, 0x7D)]
    [InlineData("tray-idle-dark.ico", 0xF4, 0xF4, 0xF0, 0xAE, 0xAE, 0xA8)]
    [InlineData("tray-tracking-dark.ico", 0x7F, 0xD6, 0xC9, 0x5F, 0xA9, 0x9E)]
    [InlineData("tray-capturing-dark.ico", 0x7F, 0xD6, 0xC9, 0x5F, 0xA9, 0x9E)]
    public void TheRingCarriesItsElapsedAndRemainingColours(
        string file, byte elapsedR, byte elapsedG, byte elapsedB, byte remainingR, byte remainingG, byte remainingB)
    {
        var frame = Frame16(file);

        Assert.Equal((elapsedR, elapsedG, elapsedB, (byte)255), PixelAt(frame, 13, 8));
        Assert.Equal((remainingR, remainingG, remainingB, (byte)255), PixelAt(frame, 3, 5));
    }

    /// <summary>
    /// The requirement itself, not just the means to it: a light taskbar needs a dark mark and a
    /// dark taskbar a light one. Checks EVERY solid pixel of every frame, not a sample — the second
    /// arc, the crown tick and the badge have to clear the bar too. Uses perceptual (luma-weighted)
    /// brightness rather than a flat channel average, since the eye weights green far more than blue.
    /// </summary>
    [Theory]
    [InlineData("tray-idle-light.ico")]
    [InlineData("tray-tracking-light.ico")]
    [InlineData("tray-capturing-light.ico")]
    [InlineData("tray-idle-warning-light.ico")]
    [InlineData("tray-tracking-warning-light.ico")]
    [InlineData("tray-idle-dark.ico")]
    [InlineData("tray-tracking-dark.ico")]
    [InlineData("tray-capturing-dark.ico")]
    [InlineData("tray-idle-warning-dark.ico")]
    [InlineData("tray-tracking-warning-dark.ico")]
    public void EverySolidPixelReadsAgainstItsTaskbar(string file)
    {
        var lightTaskbar = file.EndsWith("-light.ico", StringComparison.Ordinal);

        foreach (var size in FrameSizes)
        {
            var frame = ReadFrame(file, size);
            for (var i = 0; i < frame.Length; i += 4)
            {
                if (frame[i + 3] < 192)
                {
                    continue;
                }

                // Stored BGRA.
                var luminance = (0.299 * frame[i + 2]) + (0.587 * frame[i + 1]) + (0.114 * frame[i + 0]);
                if (lightTaskbar)
                {
                    Assert.True(luminance < 128, $"{file} @{size}px has a pixel too light ({luminance:F0}/255) for a light taskbar.");
                }
                else
                {
                    Assert.True(luminance > 128, $"{file} @{size}px has a pixel too dark ({luminance:F0}/255) for a dark taskbar.");
                }
            }
        }
    }

    /// <summary>
    /// The states differ by SHAPE, not only colour, as the macOS menu bar's do: idle is the bare
    /// ring, tracking adds a solid centre dot, and the capture flash is a lens — a ring inside the
    /// ring — whose centre is clear where tracking's is solid.
    /// </summary>
    [Theory]
    [InlineData("-light.ico")]
    [InlineData("-dark.ico")]
    public void EachStateHasItsOwnShape(string theme)
    {
        var idle = Frame16("tray-idle" + theme);
        var tracking = Frame16("tray-tracking" + theme);
        var capturing = Frame16("tray-capturing" + theme);

        Assert.Equal(0, PixelAt(idle, 8, 8).A); // idle: nothing inside the ring
        Assert.Equal(255, PixelAt(tracking, 8, 8).A); // tracking: the centre dot
        Assert.Equal(0, PixelAt(capturing, 8, 8).A); // capturing: the lens's clear centre
        Assert.Equal(255, PixelAt(capturing, 8, 6).A); // ... inside its inner ring
        Assert.True(PixelAt(tracking, 8, 6).A < 255, "Tracking's dot must not reach the lens ring.");
    }

    /// <summary>
    /// The crown tick is what makes the ring read as this app's mark rather than a placeholder
    /// circle, so it must survive at the smallest size.
    /// </summary>
    [Theory]
    [InlineData("tray-idle-light.ico")]
    [InlineData("tray-tracking-light.ico")]
    [InlineData("tray-idle-dark.ico")]
    [InlineData("tray-tracking-dark.ico")]
    public void TheCrownTickSurvivesAtSixteenPixels(string file)
    {
        var frame = Frame16(file);

        Assert.True(PixelAt(frame, 8, 1).A > 128, $"{file} has lost its crown tick at 16px.");
        Assert.Equal(0, PixelAt(frame, 5, 1).A); // it is a tick, not a band across the top
    }

    /// <summary>The warning is the palette's amber, dark on a light taskbar and light on a dark one.</summary>
    [Theory]
    [InlineData("tray-idle-warning-light.ico", 0xB4, 0x53, 0x09)]
    [InlineData("tray-tracking-warning-light.ico", 0xB4, 0x53, 0x09)]
    [InlineData("tray-idle-warning-dark.ico", 0xFB, 0xBF, 0x24)]
    [InlineData("tray-tracking-warning-dark.ico", 0xFB, 0xBF, 0x24)]
    public void WarningIconsCarryAnAmberBadgeInTheCorner(string file, byte r, byte g, byte b) =>
        Assert.Equal((r, g, b, (byte)255), PixelAt(Frame16(file), 13, 13));

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
        var badged = Frame16(warning);
        var mark = Frame16(plain);

        Assert.Equal(0, PixelAt(badged, 10, 10).A); // the gap
        Assert.Equal(PixelAt(mark, 2, 8), PixelAt(badged, 2, 8)); // the far side of the mark
        Assert.Equal(PixelAt(mark, 8, 2), PixelAt(badged, 8, 2));
        Assert.Equal(PixelAt(mark, 8, 8), PixelAt(badged, 8, 8)); // the state at its centre
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
