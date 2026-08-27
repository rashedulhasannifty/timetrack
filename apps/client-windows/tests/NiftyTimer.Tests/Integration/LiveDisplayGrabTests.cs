using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using NiftyTimer.Capture;
using NiftyTimer.Policy;
using NiftyTimer.Storage;
using NiftyTimer.Tests.Support;
using Xunit;
using Xunit.Abstractions;

namespace NiftyTimer.Tests.Integration;

/// <summary>
/// Marks a test that needs a real, attached display. Skipped unless
/// <c>NIFTYTIMER_E2E_DISPLAY=1</c>, so the default <c>dotnet test</c> run — and CI, where the
/// agent's session may enumerate one virtual display that captures as black — stays green.
///
/// <code>
/// $env:NIFTYTIMER_E2E_DISPLAY = "1"
/// dotnet test --filter LiveDisplayGrabTests --logger "console;verbosity=detailed"
/// </code>
/// </summary>
public sealed class DisplayFactAttribute : FactAttribute
{
    public DisplayFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("NIFTYTIMER_E2E_DISPLAY") != "1")
        {
            Skip = "Set NIFTYTIMER_E2E_DISPLAY=1 on a machine with a real display to run this.";
        }
    }
}

/// <summary>
/// An STA thread running a real message loop.
///
/// <see cref="WindowsDisplayGrabber"/> marshals its whole grab onto a <see cref="Dispatcher"/>
/// because <c>JpegBitmapEncoder</c> and <c>BitmapSource</c> are <c>DispatcherObject</c>s. xUnit
/// runs on MTA thread-pool threads, where <c>Dispatcher.CurrentDispatcher</c> hands back a
/// dispatcher that nothing is pumping — so <c>InvokeAsync(...).Task</c> would never complete and
/// the test would HANG rather than fail. This owns the loop instead.
/// </summary>
internal sealed class StaDispatcher : IDisposable
{
    private readonly Thread _thread;

    public StaDispatcher()
    {
        using var ready = new ManualResetEventSlim();
        _thread = new Thread(() =>
        {
            Dispatcher = Dispatcher.CurrentDispatcher;
            ready.Set();
            Dispatcher.Run();
        })
        {
            IsBackground = true,
            Name = "grab-test-sta",
        };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        ready.Wait();
    }

    public Dispatcher Dispatcher { get; private set; } = null!;

    public void Dispose()
    {
        Dispatcher.InvokeShutdown();
        _thread.Join(TimeSpan.FromSeconds(5));
    }
}

/// <summary>
/// The one test that actually runs <see cref="WindowsDisplayGrabber"/>.
///
/// Everything else in the suite stops at the <see cref="IDisplayGrabber"/> seam, so until this
/// existed the GDI code had never been executed at all — it was build-verified only, matching how
/// the macOS client treats <c>ScreenCaptureKitGrabber</c>. Three things were unverified and each
/// gets an assertion here:
///
/// <list type="number">
/// <item>that a grab produces a decodable JPEG for every attached display;</item>
/// <item>that the frame is at the display's TRUE pixel resolution — the <c>DESKTOPHORZRES</c>
/// assumption — checked against <c>EnumDisplaySettings</c>, an INDEPENDENT oracle. Reading
/// <c>DESKTOPHORZRES</c> back would only prove the call is consistent with itself;</item>
/// <item>that the encoded frame fits the server's 10 MB multipart cap, which a 4K PNG would
/// not.</item>
/// </list>
///
/// Index STABILITY is not among them — <c>ScreenshotCaptureTests</c> covers
/// <c>WindowsDisplayGrabber.Ordered</c> as a pure function, and this test mirrors that same sort
/// rather than deriving it, so it could not catch an ordering regression even in principle.
///
/// It also samples the BOTTOM-RIGHT corner. If the DPI reasoning is wrong on a scaled monitor,
/// <c>BitBlt</c> reads past the logical surface and the excess lands on the right and bottom
/// edges — a whole-frame average stays comfortably non-zero and would miss it entirely.
///
/// What this test can prove depends on the machine it runs on: it reports whether any display is
/// DPI-virtualized and how many are attached, so a green run on one unscaled monitor is not read
/// as covering the scaled or multi-monitor case.
/// </summary>
public sealed class LiveDisplayGrabTests : IDisposable
{
    /// <summary>Matches the server's multipart limit; a capture above it is a 413.</summary>
    private const int MultipartCapBytes = 10 * 1024 * 1024;

    private readonly StaDispatcher _sta = new();
    private readonly ITestOutputHelper _output;

    public LiveDisplayGrabTests(ITestOutputHelper output) => _output = output;

    public void Dispose() => _sta.Dispose();

    [DisplayFact]
    public async Task GrabsEveryAttachedDisplayAtItsTruePixelResolution()
    {
        var attached = AttachedDisplays();
        Assert.NotEmpty(attached);

        foreach (var display in attached)
        {
            _output.WriteLine(
                $"{display.DeviceName}  primary={display.IsPrimary}  " +
                $"EnumDisplaySettings={display.Width}x{display.Height}  " +
                $"HORZRES={display.LogicalWidth}x{display.LogicalHeight}  " +
                $"DESKTOPHORZRES={display.PhysicalWidth}x{display.PhysicalHeight}  " +
                $"dpi={display.Dpi}");
        }

        var virtualized = attached.Any(d => d.LogicalWidth != d.PhysicalWidth);
        _output.WriteLine(
            virtualized
                ? "COVERAGE: at least one display is DPI-virtualized for this process, so the "
                  + "DESKTOPHORZRES assumption is genuinely under test."
                : "COVERAGE: no display is DPI-virtualized for this process (HORZRES == "
                  + "DESKTOPHORZRES everywhere), so this run does NOT exercise the scaled case.");
        _output.WriteLine(
            attached.Count > 1
                ? $"COVERAGE: {attached.Count} displays attached — the multi-monitor fan-out is "
                  + "under test."
                : "COVERAGE: one display attached — the multi-monitor fan-out is NOT under test.");

        var grabber = new WindowsDisplayGrabber(
            new AckGate(new FakePolicyProvider(FakePolicyProvider.Policy(ackRequired: false))),
            _sta.Dispatcher);

        var result = await grabber.GrabAllAsync();

        Assert.Equal(Math.Min(attached.Count, CaptureGroup.MaxDisplays), result.Attempted);
        Assert.Equal(result.Attempted, result.Captures.Count);

        var byIndex = result.Captures.OrderBy(c => c.Index).ToList();
        Assert.Equal(Enumerable.Range(0, byIndex.Count), byIndex.Select(c => c.Index));

        // Mirrors the grabber's documented order — primary first, then by device name — purely to
        // decide which display each capture SHOULD match in the resolution assertions below.
        // Because the sort is copied rather than derived, index stability is NOT what this test
        // verifies; `Ordered` has its own unit test for that. What is verified here is that
        // capture[i] carries the pixel dimensions of a real display, from an oracle the grabber
        // does not share.
        var ordered = attached
            .OrderBy(d => d.IsPrimary ? 0 : 1)
            .ThenBy(d => d.DeviceName, StringComparer.Ordinal)
            .Take(CaptureGroup.MaxDisplays)
            .ToList();

        for (var i = 0; i < byIndex.Count; i++)
        {
            var jpeg = byIndex[i].Jpeg;
            var display = ordered[i];

            Assert.Equal<byte[]>([0xFF, 0xD8, 0xFF], jpeg[..3]);
            Assert.InRange(jpeg.Length, 1, MultipartCapBytes);

            var frame = Decode(jpeg);

            _output.WriteLine(
                $"capture[{i}] {display.DeviceName}: {frame.Width}x{frame.Height}, " +
                $"{jpeg.Length:N0} bytes ({jpeg.Length * 100.0 / MultipartCapBytes:F2}% of the " +
                $"cap), bottom-right mean luminance {frame.CornerLuminance:F1}/255");

            Assert.Equal(display.Width, frame.Width);
            Assert.Equal(display.Height, frame.Height);

            // A blit that over-read the logical surface leaves the excess black on exactly this
            // corner. Not a colour assertion — a desk is never uniformly black in the corner
            // where the clock and the tray live.
            Assert.True(
                frame.CornerLuminance > 1.0,
                $"capture[{i}] bottom-right corner is black — BitBlt likely read past the surface.");
        }
    }

    private DecodedFrame Decode(byte[] jpeg) => _sta.Dispatcher.Invoke(() =>
    {
        var source = new JpegBitmapDecoder(
            new MemoryStream(jpeg),
            BitmapCreateOptions.PreservePixelFormat,
            BitmapCacheOption.OnLoad).Frames[0];

        // A 64px block in the far corner, converted to BGRA so the stride maths is fixed.
        var side = Math.Min(64, Math.Min(source.PixelWidth, source.PixelHeight));
        var corner = new CroppedBitmap(
            new FormatConvertedBitmap(source, PixelFormats.Bgra32, null, 0),
            new Int32Rect(source.PixelWidth - side, source.PixelHeight - side, side, side));

        var pixels = new byte[side * side * 4];
        corner.CopyPixels(pixels, side * 4, 0);

        double total = 0;
        for (var i = 0; i < pixels.Length; i += 4)
        {
            total += (0.114 * pixels[i]) + (0.587 * pixels[i + 1]) + (0.299 * pixels[i + 2]);
        }

        return new DecodedFrame(source.PixelWidth, source.PixelHeight, total / (side * (double)side));
    });

    private sealed record DecodedFrame(int Width, int Height, double CornerLuminance);

    private sealed record DisplayFacts(
        string DeviceName,
        bool IsPrimary,
        int Width,
        int Height,
        int LogicalWidth,
        int LogicalHeight,
        int PhysicalWidth,
        int PhysicalHeight,
        int Dpi);

    /// <summary>
    /// Enumerated through <c>EnumDisplayDevices</c> + <c>EnumDisplaySettings</c> — deliberately
    /// NOT the <c>EnumDisplayMonitors</c> path the grabber uses, so the expectation is independent
    /// of the code under test.
    ///
    /// <c>EnumDisplayDevices</c> walks display devices across every adapter, so a machine with an
    /// iGPU plus a discrete card, or a virtual display driver, surfaces entries the grabber will
    /// never see; <c>DISPLAY_DEVICE_ATTACHED_TO_DESKTOP</c> is what filters them back down. If the
    /// first multi-monitor run fails on the <c>Attempted</c> count rather than on a frame, it is
    /// the two enumerations disagreeing and this is the method to reconcile — not a grabber bug.
    /// </summary>
    private static List<DisplayFacts> AttachedDisplays()
    {
        const int AttachedToDesktop = 0x00000001;
        const int PrimaryDevice = 0x00000004;
        const int EnumCurrentSettings = -1;

        var found = new List<DisplayFacts>();

        for (uint index = 0; ; index++)
        {
            var device = new DisplayDevice { Size = Marshal.SizeOf<DisplayDevice>() };
            if (!EnumDisplayDevices(null, index, ref device, 0))
            {
                break;
            }

            if ((device.StateFlags & AttachedToDesktop) == 0)
            {
                continue;
            }

            var mode = new DevMode { Size = (ushort)Marshal.SizeOf<DevMode>() };
            if (!EnumDisplaySettings(device.DeviceName, EnumCurrentSettings, ref mode))
            {
                continue;
            }

            var dc = CreateDC(null, device.DeviceName, null, IntPtr.Zero);
            var logicalWidth = GetDeviceCaps(dc, 8);    // HORZRES — DPI-virtualized
            var logicalHeight = GetDeviceCaps(dc, 10);  // VERTRES
            var physicalWidth = GetDeviceCaps(dc, 118); // DESKTOPHORZRES — true pixels
            var physicalHeight = GetDeviceCaps(dc, 117); // DESKTOPVERTRES
            var dpi = GetDeviceCaps(dc, 88);            // LOGPIXELSX
            DeleteDC(dc);

            found.Add(new DisplayFacts(
                device.DeviceName,
                (device.StateFlags & PrimaryDevice) != 0,
                (int)mode.PelsWidth,
                (int)mode.PelsHeight,
                logicalWidth,
                logicalHeight,
                physicalWidth,
                physicalHeight,
                dpi));
        }

        return found;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        public int Size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceId;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DevMode
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
        public ushort SpecVersion;
        public ushort DriverVersion;
        public ushort Size;
        public ushort DriverExtra;
        public uint Fields;
        public short Orientation;
        public short PaperSize;
        public short PaperLength;
        public short PaperWidth;
        public short Scale;
        public short Copies;
        public short DefaultSource;
        public short PrintQuality;
        public short Color;
        public short Duplex;
        public short YResolution;
        public short TtOption;
        public short Collate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string FormName;
        public ushort LogPixels;
        public uint BitsPerPel;
        public uint PelsWidth;
        public uint PelsHeight;
        public uint DisplayFlags;
        public uint DisplayFrequency;
        public uint IcmMethod;
        public uint IcmIntent;
        public uint MediaType;
        public uint DitherType;
        public uint Reserved1;
        public uint Reserved2;
        public uint PanningWidth;
        public uint PanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool EnumDisplayDevices(
        string? device, uint index, ref DisplayDevice info, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool EnumDisplaySettings(string device, int mode, ref DevMode devMode);

    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateDC(string? driver, string device, string? port, IntPtr mode);

    [DllImport("gdi32.dll")]
    private static extern int GetDeviceCaps(IntPtr dc, int index);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr dc);
}
