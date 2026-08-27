using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using NiftyTimer.Policy;
using NiftyTimer.Storage;

namespace NiftyTimer.Capture;

/// <summary>
/// PRD §6.2 — periodic screenshots via GDI.
///
/// Captures EVERY attached display in one tick, so a two-monitor desk is recorded as two frames of
/// the same moment rather than whichever one happened to be primary. Encodes JPEG at quality 60,
/// which keeps a 4K frame comfortably under the server's 10 MB multipart cap that a PNG would
/// blow straight through. The client captures RAW — blurring and thumbnailing are server-side.
///
/// **Why GDI and not Windows Graphics Capture.** WGC is the modern API and the original design
/// picked it, but it needs a target-framework bump to bring in the WinRT projections plus several
/// hundred lines of Direct3D 11 interop — device creation, a frame pool, a staging-texture
/// readback — none of which CI can verify, since there is no display on a build agent. It also
/// draws a visible yellow capture border on Windows 10 builds predating the opt-out, which would
/// mean a border flashing on every monitor every ten minutes: a user-visible product behaviour
/// nobody specified. GDI is roughly a hundred lines, needs no new dependency and no framework
/// change, and never draws anything.
///
/// The trade is real and worth stating: GDI reads the composited desktop, so DRM-protected video
/// (a browser playing Netflix) and some exclusive-fullscreen Direct3D games capture as BLACK
/// rather than as their contents. For a workforce-analytics screenshot that is an acceptable
/// answer — arguably the more appropriate one — but it is a difference from the macOS client,
/// which captures those correctly. <see cref="IDisplayGrabber"/> is the seam, so switching to WGC
/// later changes this one file and no test.
///
/// Takes the <see cref="AckGate"/> and grabs through it. Reading the pixels of somebody's screen
/// is the most invasive thing this application does, so re-confirming acknowledgement immediately
/// before the read — rather than trusting a check made higher up the tick — is worth one extra
/// policy fetch per screenshot interval.
///
/// Needs a real display, so it cannot run in CI — the macOS <c>ScreenCaptureKitGrabber</c> has the
/// same problem. <c>Integration/LiveDisplayGrabTests</c> exercises it on a developer machine when
/// <c>NIFTYTIMER_E2E_DISPLAY=1</c>, checking the frame against <c>EnumDisplaySettings</c> rather
/// than reading <c>DESKTOPHORZRES</c> back, which would only prove this code agrees with itself.
/// </summary>
public sealed class WindowsDisplayGrabber : IDisplayGrabber
{
    private const int SrcCopy = 0x00CC0020;

    /// <summary>Include layered windows in the copy; without it they come out as holes.</summary>
    private const int CaptureBlt = 0x40000000;

    private const int MonitorInfoPrimary = 0x00000001;

    /// <summary>
    /// <c>DESKTOPHORZRES</c> / <c>DESKTOPVERTRES</c> report the display's TRUE pixel dimensions,
    /// where <c>HORZRES</c> / <c>VERTRES</c> report the DPI-virtualized ones. Using the
    /// virtualized pair on a scaled 4K monitor captures a soft, upscaled 2560×1440 image and calls
    /// it native — so these are the ones to read, regardless of the process's DPI awareness.
    /// </summary>
    private const int DesktopHorzRes = 118;

    private const int DesktopVertRes = 117;

    private readonly AckGate _ackGate;
    private readonly Dispatcher _dispatcher;
    private readonly int _jpegQuality;

    public WindowsDisplayGrabber(AckGate ackGate, Dispatcher dispatcher, int jpegQuality = 60)
    {
        _ackGate = ackGate;
        _dispatcher = dispatcher;
        _jpegQuality = Math.Clamp(jpegQuality, 1, 100);
    }

    public Task<DisplayGrabResult> GrabAllAsync(CancellationToken cancellationToken = default) =>
        _ackGate.WithCaptureAllowedAsync(
            // Hop to the UI thread for the whole grab. The JPEG encoder and BitmapSource are WPF
            // DispatcherObjects: constructing one on a thread-pool thread silently spins up a
            // Dispatcher for that pooled thread which then outlives the call. A hitch of well
            // under a second, once per screenshot interval, is the cheaper of the two.
            ct => _dispatcher.InvokeAsync(() => GrabAll(ct), DispatcherPriority.Background).Task,
            cancellationToken);

    /// <summary>
    /// Primary display first, then by device name. Pure and deterministic, so a capture's
    /// <c>displayIndex</c> means the same physical monitor from one tick to the next — the OS
    /// enumeration order does not guarantee that, and an unstable index would shuffle the
    /// dashboard grid between screenshots.
    /// </summary>
    internal static List<MonitorDescriptor> Ordered(IEnumerable<MonitorDescriptor> monitors)
    {
        var ordered = new List<MonitorDescriptor>(monitors);
        ordered.Sort(static (a, b) =>
        {
            if (a.IsPrimary != b.IsPrimary)
            {
                return a.IsPrimary ? -1 : 1;
            }

            return string.CompareOrdinal(a.DeviceName, b.DeviceName);
        });
        return ordered;
    }

    private DisplayGrabResult GrabAll(CancellationToken cancellationToken)
    {
        var monitors = Ordered(EnumerateMonitors());
        if (monitors.Count == 0)
        {
            throw new DisplayGrabException(DisplayGrabFailure.NoDisplay);
        }

        // The server bounds displayIndex to 0–15 and displayCount to 1–16. Beyond that the upload
        // is a 422, which classifies as permanent and DROPS the capture — so an unusual desk would
        // silently lose its screenshots. Cap instead, and record the cap as the attempted count so
        // the group reads as complete rather than as perpetually short.
        if (monitors.Count > CaptureGroup.MaxDisplays)
        {
            monitors.RemoveRange(CaptureGroup.MaxDisplays, monitors.Count - CaptureGroup.MaxDisplays);
        }

        var captures = new List<DisplayCapture>(monitors.Count);
        var sawEncodeFailure = false;

        for (var index = 0; index < monitors.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                if (Capture(monitors[index]) is { } jpeg)
                {
                    captures.Add(new DisplayCapture(index, jpeg));
                }
                else
                {
                    sawEncodeFailure = true;
                }
            }
            catch (Exception e) when (e is COMException or InvalidOperationException or OutOfMemoryException)
            {
                // One display failed — an external monitor asleep or mid-reconnect. Keep going.
                // Losing the whole desk because one screen blinked is a worse record than a group
                // honestly marked incomplete.
            }
        }

        if (captures.Count == 0)
        {
            throw new DisplayGrabException(
                sawEncodeFailure ? DisplayGrabFailure.EncodeFailed : DisplayGrabFailure.CaptureFailed);
        }

        return new DisplayGrabResult(captures, monitors.Count);
    }

    private byte[]? Capture(MonitorDescriptor monitor)
    {
        // A DC created from the device name has its origin at that monitor's top-left, so the blit
        // is (0,0)-relative and needs no virtual-screen offset arithmetic.
        var source = CreateDC(null, monitor.DeviceName, null, IntPtr.Zero);
        if (source == IntPtr.Zero)
        {
            return null;
        }

        var memory = IntPtr.Zero;
        var bitmap = IntPtr.Zero;
        var previous = IntPtr.Zero;

        try
        {
            var width = GetDeviceCaps(source, DesktopHorzRes);
            var height = GetDeviceCaps(source, DesktopVertRes);
            if (width <= 0 || height <= 0)
            {
                return null;
            }

            memory = CreateCompatibleDC(source);
            if (memory == IntPtr.Zero)
            {
                return null;
            }

            bitmap = CreateCompatibleBitmap(source, width, height);
            if (bitmap == IntPtr.Zero)
            {
                return null;
            }

            previous = SelectObject(memory, bitmap);
            if (!BitBlt(memory, 0, 0, width, height, source, 0, 0, SrcCopy | CaptureBlt))
            {
                return null;
            }

            return Encode(bitmap);
        }
        finally
        {
            if (previous != IntPtr.Zero)
            {
                SelectObject(memory, previous);
            }

            if (bitmap != IntPtr.Zero)
            {
                DeleteObject(bitmap);
            }

            if (memory != IntPtr.Zero)
            {
                DeleteDC(memory);
            }

            DeleteDC(source);
        }
    }

    private byte[] Encode(IntPtr bitmap)
    {
        var frame = Imaging.CreateBitmapSourceFromHBitmap(
            bitmap,
            IntPtr.Zero,
            Int32Rect.Empty,
            BitmapSizeOptions.FromEmptyOptions());
        frame.Freeze();

        var encoder = new JpegBitmapEncoder { QualityLevel = _jpegQuality };
        encoder.Frames.Add(BitmapFrame.Create(frame));

        using var stream = new MemoryStream();
        encoder.Save(stream);
        return stream.ToArray();
    }

    private static List<MonitorDescriptor> EnumerateMonitors()
    {
        var monitors = new List<MonitorDescriptor>();

        bool Collect(IntPtr monitor, IntPtr hdc, ref Rect clip, IntPtr data)
        {
            var info = new MonitorInfoEx { cbSize = Marshal.SizeOf<MonitorInfoEx>() };
            if (GetMonitorInfo(monitor, ref info))
            {
                monitors.Add(new MonitorDescriptor(
                    info.szDevice,
                    (info.dwFlags & MonitorInfoPrimary) != 0));
            }

            return true; // keep enumerating
        }

        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, Collect, IntPtr.Zero);
        return monitors;
    }

    /// <summary>A monitor as the ordering cares about it. No handles — pure, so it can be sorted in a test.</summary>
    internal sealed record MonitorDescriptor(string DeviceName, bool IsPrimary)
    {
        public override string ToString() =>
            string.Create(CultureInfo.InvariantCulture, $"{DeviceName}{(IsPrimary ? " (primary)" : string.Empty)}");
    }

    private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, ref Rect clip, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        public int cbSize;
        public Rect rcMonitor;
        public Rect rcWork;
        public int dwFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfoEx info);

    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateDC(string? driver, string device, string? output, IntPtr initData);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int width, int height);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr SelectObject(IntPtr hdc, IntPtr handle);

    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BitBlt(
        IntPtr destination,
        int x,
        int y,
        int width,
        int height,
        IntPtr source,
        int sourceX,
        int sourceY,
        int rop);

    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteObject(IntPtr handle);

    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern int GetDeviceCaps(IntPtr hdc, int index);
}
