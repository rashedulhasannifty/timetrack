using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace NiftyTimer.App;

/// <summary>
/// The start/stop hotkey — <b>Ctrl+Alt+T</b>, the Windows counterpart to the macOS client's ⌥⌘T.
///
/// Uses <c>RegisterHotKey</c>, which hands the OS one specific chord and receives a
/// <c>WM_HOTKEY</c> message when it fires. That is the whole reason it is not built on the raw
/// input path in <c>Activity/EventCounter</c>: this way the process is told about exactly one key
/// combination and learns nothing about anything else typed on the machine. Routing a hotkey
/// through the input counter would mean inspecting keys to recognise the chord — precisely the
/// capability CLAUDE.md §1 forbids and that the counter is built to lack.
///
/// **Registration failing is normal, not exceptional.** Any other application — a terminal, an IDE,
/// a vendor utility — may already own Ctrl+Alt+T, and Windows gives it to whoever asked first.
/// So a failure degrades to "no hotkey" silently: <see cref="IsRegistered"/> reports it, the tray
/// icon still starts and stops the clock, and nothing throws on the UI thread during launch.
/// Throwing here would take down the whole app over a keyboard shortcut.
/// </summary>
public sealed class GlobalHotKey : IDisposable
{
    private const int WmHotKey = 0x0312;

    private const uint ModAlt = 0x0001;
    private const uint ModControl = 0x0002;

    /// <summary>Do not repeat while the keys are held — one press is one toggle.</summary>
    private const uint ModNoRepeat = 0x4000;

    private const uint VkT = 0x54;

    /// <summary>Any value unique within this window; the message carries it back.</summary>
    private const int HotKeyId = 0xA17;

    private readonly Action _onPressed;
    private readonly IMessageHost _host;
    private bool _disposed;

    public GlobalHotKey(Action onPressed, Func<string, HwndSourceHook, IMessageHost>? hostFactory = null)
    {
        _onPressed = onPressed;
        var factory = hostFactory ?? ((name, hook) => new MessageWindowHost(name, hook));
        _host = factory("NiftyTimer.HotKeyHost", OnMessage);

        IsRegistered = RegisterHotKey(_host.Handle, HotKeyId, ModControl | ModAlt | ModNoRepeat, VkT);
    }

    /// <summary>
    /// False when another application already owns the chord. Worth surfacing rather than hiding:
    /// a person pressing a shortcut that silently does nothing has no way to find out why.
    /// </summary>
    public bool IsRegistered { get; }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        if (IsRegistered)
        {
            // Unregister before destroying the window. Leaving it registered would keep the chord
            // claimed from every other application until the process exits.
            UnregisterHotKey(_host.Handle, HotKeyId);
        }

        _host.Dispose();
    }

    internal IntPtr OnMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WmHotKey || (int)wParam != HotKeyId)
        {
            return IntPtr.Zero;
        }

        _onPressed();
        handled = true;
        return IntPtr.Zero;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
