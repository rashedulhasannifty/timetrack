using System.Runtime.InteropServices;
using System.Windows.Threading;
using NiftyTimer.App;

namespace NiftyTimer.Tracking;

/// <summary>
/// What the system edge reports. Implemented by the coordinators and by
/// <see cref="FanOutSignalReceiver"/>.
/// </summary>
public interface ISignalReceiver
{
    void Tick(int idleSeconds);

    void MarkAway();

    void Resume();
}

/// <summary>
/// PRD §6.1/§6.4 — the system edge for idle detection. The Windows counterpart of the macOS
/// client's <c>WorkspaceObserver</c>. A timer samples how long the session has been without input;
/// suspend/resume and lock/unlock feed away/resume directly. All the logic lives in
/// <see cref="IdleMonitor"/> / <see cref="ManualIdleMonitor"/> — this type only forwards signals.
///
/// <b>Counts and durations, never content (CLAUDE.md §1).</b> <c>GetLastInputInfo</c> returns a
/// single tick-count scalar: the moment of the last input of any kind. It carries no key identity,
/// no scancode, no coordinates, and no window. Nothing here installs a hook, and nothing here may
/// grow one — a keyboard hook would see content, and the equivalent macOS API physically cannot.
///
/// Three signals, three mechanisms:
/// <list type="bullet">
///   <item><b>Inactivity</b> — polled, because Windows has no "user went idle" event.</item>
///   <item><b>Sleep</b> — <c>WM_POWERBROADCAST</c>, a broadcast, which is why the host window is
///   top-level rather than message-only (see <see cref="MessageWindow"/>).</item>
///   <item><b>Lock/unlock</b> — <c>WM_WTSSESSION_CHANGE</c>, delivered only after an explicit
///   <c>WTSRegisterSessionNotification</c>.</item>
/// </list>
///
/// Sleep and lock matter because polling alone gets them wrong: a machine asleep for eight hours
/// reports the idle time correctly on wake, but the away window would be backdated from the wake
/// moment rather than starting when the lid actually closed, and a locked machine that someone else
/// wakes looks like the owner returning. Both mark away <i>immediately</i>, at the moment the
/// signal arrives, rather than waiting for the threshold.
///
/// <see cref="DispatcherTimer"/> deliberately, not <c>System.Threading.Timer</c>: everything
/// downstream — the monitors, the coordinators, <see cref="TimeTracker"/>,
/// <see cref="App.MenuViewModel"/> — is UI-thread-only, exactly as the Swift original's
/// <c>RunLoop.main</c> timer guarantees.
/// </summary>
public sealed class SessionObserver : IDisposable
{
    private const int WmPowerBroadcast = 0x0218;
    private const int PbtApmSuspend = 0x0004;
    private const int PbtApmResumeSuspend = 0x0007;
    private const int PbtApmResumeAutomatic = 0x0012;

    private const int WmWtsSessionChange = 0x02B1;
    private const int WtsSessionLock = 0x7;
    private const int WtsSessionUnlock = 0x8;

    private const int NotifyForThisSession = 0;

    private readonly ISignalReceiver _receiver;
    private readonly DispatcherTimer _timer;
    private readonly Func<int> _idleSeconds;

    private MessageWindow? _window;
    private bool _registered;
    private bool _disposed;

    public SessionObserver(ISignalReceiver receiver, TimeSpan? pollInterval = null, Func<int>? idleSeconds = null)
    {
        _receiver = receiver;
        _idleSeconds = idleSeconds ?? IdleSecondsFromSystem;
        _timer = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = pollInterval ?? TimeSpan.FromSeconds(15),
        };
        _timer.Tick += (_, _) => _receiver.Tick(_idleSeconds());
    }

    /// <summary>
    /// Whether the OS accepted our request for lock/unlock notifications.
    ///
    /// Exposed because a refusal is otherwise invisible: idle detection keeps working from polling
    /// alone, and the only symptom is that locking the workstation stops marking away immediately —
    /// so away windows silently start late by up to the threshold, which looks like nothing at all.
    /// </summary>
    public bool IsRegisteredForSessionNotifications => _registered;

    /// <summary>
    /// Seconds since the last input event in this session, from <c>GetLastInputInfo</c>.
    ///
    /// The subtraction is done in UNSIGNED arithmetic on purpose. <c>dwTime</c> is a 32-bit tick
    /// count that wraps every ~49.7 days of uptime; subtracting as signed ints across the wrap
    /// yields a huge negative, and a huge negative idle reading is indistinguishable from "very
    /// active" — so on a long-uptime machine idle detection would simply stop working, once, for a
    /// few seconds, in a way no test would ever catch. Unsigned subtraction wraps correctly.
    /// </summary>
    public static int IdleSecondsFromSystem()
    {
        var info = new LastInputInfo { cbSize = (uint)Marshal.SizeOf<LastInputInfo>() };
        if (!GetLastInputInfo(ref info))
        {
            return 0; // Fail-safe: unknown idle reads as active, so nothing is auto-stopped.
        }

        var elapsed = unchecked((uint)Environment.TickCount - info.dwTime);
        return (int)(elapsed / 1000);
    }

    public void Start()
    {
        if (_disposed || _window is not null)
        {
            return;
        }

        _window = new MessageWindow("NiftyTimer.SessionObserver", WndProc);
        _registered = WTSRegisterSessionNotification(_window.Handle, NotifyForThisSession);
        _timer.Start();
    }

    public void Stop()
    {
        _timer.Stop();

        if (_window is null)
        {
            return;
        }

        if (_registered)
        {
            WTSUnRegisterSessionNotification(_window.Handle);
            _registered = false;
        }

        _window.Dispose();
        _window = null;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Stop();
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        switch (msg)
        {
            case WmPowerBroadcast when (int)wParam == PbtApmSuspend:
                _receiver.MarkAway();
                break;

            case WmPowerBroadcast when (int)wParam is PbtApmResumeSuspend or PbtApmResumeAutomatic:
                // Both resume flavours are forwarded. PBT_APMRESUMEAUTOMATIC fires on every wake;
                // PBT_APMRESUMESUSPEND only when the wake was user-initiated, so a machine woken by
                // a timer and then used would otherwise never report the return. Resume is
                // idempotent on the monitors (a no-op unless away), so the duplicate is harmless.
                _receiver.Resume();
                break;

            case WmWtsSessionChange when (int)wParam == WtsSessionLock:
                _receiver.MarkAway();
                break;

            case WmWtsSessionChange when (int)wParam == WtsSessionUnlock:
                _receiver.Resume();
                break;

            default:
                break;
        }

        return IntPtr.Zero;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LastInputInfo
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetLastInputInfo(ref LastInputInfo plii);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSRegisterSessionNotification(IntPtr hWnd, int dwFlags);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSUnRegisterSessionNotification(IntPtr hWnd);
}

/// <summary>
/// Fans one <see cref="SessionObserver"/> out to several receivers, so the auto and manual
/// coordinators share a single system-edge timer rather than each polling independently.
/// </summary>
public sealed class FanOutSignalReceiver : ISignalReceiver
{
    private readonly IReadOnlyList<ISignalReceiver> _receivers;

    public FanOutSignalReceiver(params ISignalReceiver[] receivers) => _receivers = receivers;

    public void Tick(int idleSeconds)
    {
        foreach (var receiver in _receivers)
        {
            receiver.Tick(idleSeconds);
        }
    }

    public void MarkAway()
    {
        foreach (var receiver in _receivers)
        {
            receiver.MarkAway();
        }
    }

    public void Resume()
    {
        foreach (var receiver in _receivers)
        {
            receiver.Resume();
        }
    }
}
