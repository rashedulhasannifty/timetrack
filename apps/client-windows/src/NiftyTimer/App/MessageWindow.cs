using System.Windows.Interop;

namespace NiftyTimer.App;

/// <summary>
/// A hidden, top-level window that exists only to receive Win32 messages.
///
/// The distinction from a message-only window (<c>HWND_MESSAGE</c> as parent) is the whole point
/// and is easy to get wrong, because a message-only window looks strictly better: cheaper, invisible
/// by construction, and it cannot be enumerated. But it also <b>does not receive broadcast
/// messages</b> — and two of the signals this client depends on are broadcasts:
///
/// <list type="bullet">
///   <item><c>TaskbarCreated</c>, which Explorer broadcasts after a restart. Miss it and the
///   always-visible indicator (PRD §4.2) stays gone for the rest of the session.</item>
///   <item><c>WM_POWERBROADCAST</c>, which carries suspend/resume — how S2 knows the machine went
///   to sleep rather than the person simply going quiet.</item>
/// </list>
///
/// So the window is top-level instead, and kept out of the user's way by being neither shown nor
/// given <c>WS_VISIBLE</c>, plus <c>WS_EX_TOOLWINDOW</c> so it can never surface in Alt-Tab or the
/// taskbar even momentarily. It has zero size and no paint handler.
/// </summary>
public sealed class MessageWindow : IDisposable
{
    private const int WsPopup = unchecked((int)0x80000000);
    private const int WsExToolWindow = 0x00000080;

    private readonly HwndSource _source;
    private readonly HwndSourceHook _hook;
    private bool _disposed;

    public MessageWindow(string name, HwndSourceHook hook)
    {
        _hook = hook;
        _source = new HwndSource(new HwndSourceParameters(name)
        {
            // Deliberately NOT ParentWindow = HWND_MESSAGE. See the type comment: a message-only
            // window would silently drop TaskbarCreated and WM_POWERBROADCAST.
            WindowStyle = WsPopup,
            ExtendedWindowStyle = WsExToolWindow,
            Width = 0,
            Height = 0,
            PositionX = 0,
            PositionY = 0,
        });
        _source.AddHook(_hook);
    }

    public IntPtr Handle => _source.Handle;

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.RemoveHook(_hook);
        _source.Dispose();
    }
}
