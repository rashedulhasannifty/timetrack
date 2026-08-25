using System.Runtime.InteropServices;

namespace NiftyTimer.App;

/// <summary>Which state the always-visible indicator is showing.</summary>
public enum TrayState
{
    Idle,
    Tracking,
}

/// <summary>
/// The always-visible indicator (PRD §4.2). A tray icon that changes with tracking state, plus
/// the click target that opens the dropdown.
///
/// There is no way to hide it. No configuration flag, no policy field, no command-line switch,
/// and no build target removes it — that is the point of the requirement, and it is why this is
/// created during startup before any other subsystem and never conditionally.
///
/// Hand-rolled over <c>Shell_NotifyIcon</c> rather than taking a tray-icon package, so the client
/// keeps its zero-runtime-dependency posture (CLAUDE.md §2). The hidden <see cref="MessageWindow"/>
/// exists only to receive the icon's callback messages; it is never shown.
/// </summary>
public sealed class TrayIconController : IDisposable
{
    private const int WmTrayCallback = 0x0400 + 1; // WM_APP + 1
    private const int WmLButtonUp = 0x0202;
    private const int WmRButtonUp = 0x0205;

    private const int NimAdd = 0x0;
    private const int NimModify = 0x1;
    private const int NimDelete = 0x2;

    private const int NifMessage = 0x1;
    private const int NifIcon = 0x2;
    private const int NifTip = 0x4;
    private const int NifInfo = 0x10;

    /// <summary>Balloon icon: informational. NIIF_NONE would render no glyph at all.</summary>
    private const int NiifInfo = 0x1;

    private const uint ImageIcon = 1;
    private const uint LrLoadFromFile = 0x0010;
    private const uint LrDefaultSize = 0x0040;

    private readonly MessageWindow _source;
    private readonly Dictionary<TrayState, IntPtr> _icons = [];
    private readonly uint _id;

    /// <summary>
    /// Explorer broadcasts this when the taskbar is (re)created — after an Explorer crash or
    /// restart, which is common enough on Windows to be routine. Every tray entry is dropped at
    /// that point and each app must re-add its own.
    ///
    /// Ignoring it would leave the indicator gone for the rest of the session while the client
    /// kept running. For an ordinary tray utility that is a papercut; for an indicator that
    /// PRD §4.2 says nothing may hide — and which in S3 will be the only sign that capture is
    /// active — it is the requirement quietly failing.
    /// </summary>
    private readonly uint _taskbarCreated;

    private TrayState _state = TrayState.Idle;
    private string _tooltip = "Nifty Timer";
    private bool _added;
    private bool _disposed;

    public TrayIconController(string resourceDirectory)
    {
        _id = 1;
        _taskbarCreated = RegisterWindowMessage("TaskbarCreated");

        // Hidden but TOP-LEVEL, not message-only. Shell_NotifyIcon is happy either way — it
        // delivers clicks to whatever handle it is given — but `TaskbarCreated` below is a
        // broadcast, and broadcasts never reach a message-only window. See `MessageWindow`.
        _source = new MessageWindow("NiftyTimer.TrayIconHost", WndProc);

        _icons[TrayState.Idle] = LoadIcon(Path.Combine(resourceDirectory, "tray-idle.ico"));
        _icons[TrayState.Tracking] = LoadIcon(Path.Combine(resourceDirectory, "tray-tracking.ico"));

        Add();
    }

    /// <summary>The user clicked the icon and wants the dropdown.</summary>
    public event Action? Activated;

    /// <summary>The user right-clicked the icon.</summary>
    public event Action? ContextMenuRequested;

    public TrayState State
    {
        get => _state;
        set
        {
            if (_state == value)
            {
                return;
            }

            _state = value;
            Update();
        }
    }

    /// <summary>
    /// The hover text. Carries the live elapsed time while tracking, so the state is legible
    /// without opening anything.
    /// </summary>
    public string Tooltip
    {
        get => _tooltip;
        set
        {
            // Shell_NotifyIcon truncates at 128 chars; trim rather than let it mangle.
            var trimmed = value.Length > 127 ? value[..127] : value;
            if (_tooltip == trimmed)
            {
                return;
            }

            _tooltip = trimmed;
            Update();
        }
    }

    /// <summary>
    /// Show a balloon notification from the tray icon. Windows 10 and 11 render these through the
    /// Action Center, so they look and behave like ordinary toasts.
    ///
    /// This is deliberately not the WinRT <c>ToastNotificationManager</c> route. That would need a
    /// target-framework bump to pull in the Windows SDK projections — the same cost declined for
    /// screen capture — plus an Application User Model ID registered by a Start Menu shortcut,
    /// which the unsigned pilot has no installer to create. The cost of this choice is no action
    /// buttons and a body the shell truncates past 255 characters; every nudge this client sends
    /// is informational, and the one that wants interaction (the distraction nudge) already falls
    /// back to a real in-app window.
    ///
    /// Best-effort by design. A user who has turned notifications off, or a shell that simply
    /// declines, is a silent no-op — never an error, and never a change to what is tracked.
    /// </summary>
    public void ShowBalloon(string title, string body)
    {
        if (!_added || _disposed)
        {
            return;
        }

        var data = NewData(NifInfo);
        data.szInfoTitle = Truncate(title, 63);
        data.szInfo = Truncate(body, 255);
        data.dwInfoFlags = NiifInfo;

        Shell_NotifyIcon(NimModify, ref data);
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max];

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        if (_added)
        {
            var data = NewData(NifMessage);
            Shell_NotifyIcon(NimDelete, ref data);
            _added = false;
        }

        foreach (var icon in _icons.Values)
        {
            if (icon != IntPtr.Zero)
            {
                DestroyIcon(icon);
            }
        }

        _icons.Clear();
        _source.Dispose();
    }

    private static IntPtr LoadIcon(string path)
    {
        var handle = LoadImage(IntPtr.Zero, path, ImageIcon, 0, 0, LrLoadFromFile | LrDefaultSize);
        if (handle == IntPtr.Zero)
        {
            // The indicator is not optional, so a missing icon is a hard failure rather than a
            // silently icon-less tray entry.
            throw new FileNotFoundException($"Tray icon resource missing or unreadable: {path}", path);
        }

        return handle;
    }

    private void Add()
    {
        var data = NewData(NifMessage | NifIcon | NifTip);
        _added = Shell_NotifyIcon(NimAdd, ref data);
        if (!_added)
        {
            throw new InvalidOperationException(
                "Shell_NotifyIcon(NIM_ADD) failed; the tray indicator could not be created.");
        }
    }

    private void Update()
    {
        if (!_added)
        {
            return;
        }

        var data = NewData(NifIcon | NifTip);
        Shell_NotifyIcon(NimModify, ref data);
    }

    private NotifyIconData NewData(int flags) => new()
    {
        cbSize = Marshal.SizeOf<NotifyIconData>(),
        hWnd = _source.Handle,
        uID = _id,
        uFlags = flags,
        uCallbackMessage = WmTrayCallback,
        hIcon = _icons.GetValueOrDefault(_state),
        szTip = _tooltip,

        // The ByValTStr fields must never be null: marshalling a null fixed-length buffer throws,
        // and it would throw from inside the tray update path — the one path that must not fail.
        szInfo = string.Empty,
        szInfoTitle = string.Empty,
    };

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (_taskbarCreated != 0 && msg == (int)_taskbarCreated)
        {
            // Explorer restarted and dropped every tray entry. Re-add ours.
            _added = false;
            Add();
            handled = true;
            return IntPtr.Zero;
        }

        if (msg != WmTrayCallback)
        {
            return IntPtr.Zero;
        }

        switch ((int)lParam)
        {
            case WmLButtonUp:
                Activated?.Invoke();
                handled = true;
                break;
            case WmRButtonUp:
                ContextMenuRequested?.Invoke();
                handled = true;
                break;
        }

        return IntPtr.Zero;
    }

    /// <summary>
    /// The full modern <c>NOTIFYICONDATAW</c>. Every field is present even though only some are
    /// used, because <c>cbSize</c> is how the shell decides which layout it was handed — a struct
    /// truncated after <c>szTip</c> reports a size matching no documented version, and the shell
    /// is entitled to reject it. <c>TrayIconLayoutTests</c> pins the offsets, since a wrong one
    /// here is not a compile error or an exception but a tray entry built from misread memory.
    /// </summary>
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct NotifyIconData
    {
#pragma warning disable SA1307 // Win32 struct field names must match the native layout.
        public int cbSize;
        public IntPtr hWnd;
        public uint uID;
        public int uFlags;
        public int uCallbackMessage;
        public IntPtr hIcon;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;

        public int dwState;
        public int dwStateMask;

        /// <summary>The balloon body. The shell truncates past 255 characters.</summary>
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;

        /// <summary>A union of uTimeout and uVersion; the shell ignores the timeout on
        /// Windows Vista and later, which is every version this client supports.</summary>
        public int uVersion;

        /// <summary>The balloon title. The shell truncates past 63 characters.</summary>
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;

        public int dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
#pragma warning restore SA1307
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Shell_NotifyIcon(int message, ref NotifyIconData data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadImage(
        IntPtr instance,
        string name,
        uint type,
        int cx,
        int cy,
        uint load);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr icon);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint RegisterWindowMessage(string message);
}
