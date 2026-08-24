using System.Runtime.InteropServices;
using System.Windows.Interop;
using NiftyTimer.App;
using NiftyTimer.Policy;

namespace NiftyTimer.Activity;

/// <summary>
/// The ONLY thing the rest of the application may learn about input: two monotonic counters.
///
/// CLAUDE.md §1 forbids logging or transmitting keystroke CONTENT — counts only. On macOS that is
/// guaranteed by the platform: <c>CGEventSource.counterForEventType</c> is physically incapable of
/// returning key identity. On Windows the equivalent APIs CAN return it, so the guarantee has to
/// be built rather than inherited, and this interface is where it is built. Two <c>long</c>
/// getters, nothing else.
///
/// <c>EventCounterBoundaryTests</c> asserts this interface's member set EXACTLY, not by
/// containment, so adding a <c>LastVirtualKey</c> or a <c>RecentScanCodes</c> here fails CI rather
/// than shipping.
/// </summary>
public interface IInputCounting
{
    long KeyEvents { get; }

    long PointerEvents { get; }
}

/// <summary>
/// PRD §6.3 — counts keyboard and pointer EVENTS so <see cref="Tracking.ActivityRateMeter"/> can
/// derive an activity percentage. Uses Raw Input (<c>RegisterRawInputDevices</c> + <c>WM_INPUT</c>)
/// on its own hidden window.
///
/// **It reads the message HEADER only.** <c>GetRawInputData</c> is called with
/// <c>RID_HEADER</c> rather than <c>RID_INPUT</c>, so what comes back is a
/// <c>RAWINPUTHEADER</c> — device type, size, device handle — and the <c>RAWKEYBOARD</c> payload
/// carrying <c>VKey</c> and <c>MakeCode</c> is never copied into this process at all. That is a
/// deliberately stronger position than "we fetch the key and choose not to look at it": there is
/// no buffer here for a future change to start reading. Do not switch this to <c>RID_INPUT</c>.
///
/// Why Raw Input and not a hook: <c>WH_KEYBOARD_LL</c> receives key content by construction, is
/// forbidden outright by CLAUDE.md §1, and is the classic keylogger signature that enterprise EDR
/// flags. Raw Input with <c>RIDEV_INPUTSINK</c> gets us the one bit we need — "something
/// happened" — while the machine is not in the foreground.
///
/// The counters are only ever compared against zero (a sub-bucket is "active" if the delta is
/// positive), so their absolute magnitude carries no meaning and nothing depends on it. That is
/// worth knowing, because a keyboard raises raw input on both press AND release while the macOS
/// counterpart counts only key-down: the same typing yields roughly twice the count here.
/// Distinguishing them would mean reading <c>RAWKEYBOARD.Flags</c> — i.e. opening the payload —
/// which is a trade this type exists to refuse.
///
/// Takes the <see cref="AckGate"/> and registers through it: subscribing to every keystroke and
/// mouse move on the machine IS the observation, so arming it is the thing that must be
/// authorized, not merely reading the totals afterwards.
/// </summary>
public sealed class EventCounter : IInputCounting, IDisposable
{
    private const int WmInput = 0x00FF;

    private const int RidHeader = 0x10000005;

    private const ushort UsagePageGeneric = 0x01;
    private const ushort UsageMouse = 0x02;
    private const ushort UsageKeyboard = 0x06;

    /// <summary>Deliver input even when our window is not in the foreground — which is always.</summary>
    private const int RidevInputSink = 0x00000100;

    private const int RidevRemove = 0x00000001;

    private const int RimTypeMouse = 0;
    private const int RimTypeKeyboard = 1;

    private readonly AckGate _ackGate;
    private readonly Func<string, HwndSourceHook, IMessageHost> _hostFactory;

    private IMessageHost? _host;
    private long _keyEvents;
    private long _pointerEvents;
    private bool _disposed;

    public EventCounter(AckGate ackGate, Func<string, HwndSourceHook, IMessageHost>? hostFactory = null)
    {
        _ackGate = ackGate;
        _hostFactory = hostFactory ?? ((name, hook) => new MessageWindowHost(name, hook));
    }

    /// <summary>Cumulative since <see cref="StartAsync"/>; read from the sampling cycle.</summary>
    public long KeyEvents => Interlocked.Read(ref _keyEvents);

    public long PointerEvents => Interlocked.Read(ref _pointerEvents);

    public bool IsRegistered { get; private set; }

    /// <summary>
    /// Arm the counter, through the gate. Must be called on the UI (STA) thread — the hidden
    /// window is created here and Win32 delivers <c>WM_INPUT</c> to the thread that owns it.
    /// </summary>
    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (_host is not null || _disposed)
        {
            return;
        }

        await _ackGate.WithCaptureAllowedAsync(
            _ =>
            {
                Register();
                return Task.CompletedTask;
            },
            cancellationToken).ConfigureAwait(true);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        if (_host is not null)
        {
            Unregister();
            _host.Dispose();
            _host = null;
        }

        IsRegistered = false;
    }

    /// <summary>
    /// The message handler. Increments a counter and returns; it holds no per-event state and
    /// allocates nothing that could retain one.
    /// </summary>
    internal IntPtr OnMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WmInput)
        {
            return IntPtr.Zero;
        }

        // RID_HEADER: the device type and nothing else. The keyboard/mouse payload is left in the
        // OS buffer and never enters this address space.
        var header = default(RawInputHeader);
        var size = (uint)Marshal.SizeOf<RawInputHeader>();
        var headerSize = (uint)Marshal.SizeOf<RawInputHeader>();

        if (GetRawInputData(lParam, RidHeader, ref header, ref size, headerSize) != unchecked((uint)-1))
        {
            switch (header.dwType)
            {
                case RimTypeKeyboard:
                    Interlocked.Increment(ref _keyEvents);
                    break;
                case RimTypeMouse:
                    Interlocked.Increment(ref _pointerEvents);
                    break;
                default:
                    break;
            }
        }

        // Deliberately NOT handled: WM_INPUT must reach DefWindowProc so the OS can release the
        // raw input buffer. Swallowing it leaks a buffer per event.
        return IntPtr.Zero;
    }

    private void Register()
    {
        _host = _hostFactory("NiftyTimer.EventCounter", OnMessage);

        var devices = new RawInputDevice[]
        {
            new()
            {
                usUsagePage = UsagePageGeneric,
                usUsage = UsageKeyboard,
                dwFlags = RidevInputSink,
                hwndTarget = _host.Handle,
            },
            new()
            {
                usUsagePage = UsagePageGeneric,
                usUsage = UsageMouse,
                dwFlags = RidevInputSink,
                hwndTarget = _host.Handle,
            },
        };

        IsRegistered = RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf<RawInputDevice>());

        // A failed registration is not fatal and must not stop the clock: the sample still goes
        // out, with an activity percentage of zero. Reporting nothing at all would be worse — the
        // app name and category are still true.
    }

    private static void Unregister()
    {
        // hwndTarget MUST be null for RIDEV_REMOVE; passing the window handle fails the call and
        // leaves the process subscribed to every keystroke on the machine after sign-out.
        var devices = new RawInputDevice[]
        {
            new() { usUsagePage = UsagePageGeneric, usUsage = UsageKeyboard, dwFlags = RidevRemove, hwndTarget = IntPtr.Zero },
            new() { usUsagePage = UsagePageGeneric, usUsage = UsageMouse, dwFlags = RidevRemove, hwndTarget = IntPtr.Zero },
        };

        RegisterRawInputDevices(devices, (uint)devices.Length, (uint)Marshal.SizeOf<RawInputDevice>());
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RawInputDevice
    {
        public ushort usUsagePage;
        public ushort usUsage;
        public int dwFlags;
        public IntPtr hwndTarget;
    }

    /// <summary>
    /// The whole of what this type ever reads from an input event. Note what is absent: there is
    /// no <c>RAWKEYBOARD</c> and no <c>RAWMOUSE</c> member, because <c>RID_HEADER</c> never
    /// returns them.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct RawInputHeader
    {
        public int dwType;
        public int dwSize;
        public IntPtr hDevice;
        public IntPtr wParam;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterRawInputDevices(
        [MarshalAs(UnmanagedType.LPArray)] RawInputDevice[] devices,
        uint numDevices,
        uint size);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetRawInputData(
        IntPtr hRawInput,
        int uiCommand,
        ref RawInputHeader pData,
        ref uint pcbSize,
        uint cbSizeHeader);
}
