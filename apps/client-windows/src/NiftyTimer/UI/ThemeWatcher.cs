using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using NiftyTimer.App;

namespace NiftyTimer.UI;

/// <summary>
/// Keeps the merged theme dictionary in step with the shell's appearance.
///
/// The signal is <c>WM_SETTINGCHANGE</c> with an lParam of "ImmersiveColorSet", delivered to the
/// same kind of hidden top-level window the tray icon already uses. That choice is deliberate over
/// <c>SystemEvents.UserPreferenceChanged</c>: SystemEvents raises its callbacks on its own thread,
/// so every handler has to marshal to the dispatcher before touching
/// <see cref="Application.Resources"/> or it throws — whereas a window procedure already runs on
/// the UI thread. <see cref="MessageWindow"/> is top-level rather than message-only precisely so
/// broadcasts like this one reach it.
/// </summary>
public sealed class ThemeWatcher : IDisposable
{
    private const int WmSettingChange = 0x001A;

    private readonly Func<AppTheme> _read;
    private readonly Action<AppTheme> _apply;
    private readonly IMessageHost _host;

    private bool _disposed;

    public ThemeWatcher(
        Func<AppTheme> read,
        Action<AppTheme> apply,
        Func<HwndSourceHook, IMessageHost> host)
    {
        _read = read;
        _apply = apply;
        _host = host(Hook);

        Current = _read();
        _apply(Current);
    }

    public AppTheme Current { get; private set; }

    /// <summary>
    /// Swap the dictionary at index 0. Everything downstream reaches these brushes through
    /// DynamicResource, so already-constructed windows re-resolve — which is the whole point,
    /// because the tray popup is built once and never rebuilt.
    /// </summary>
    public static void ApplyToApplication(AppTheme theme)
    {
        var name = theme == AppTheme.Dark ? "Theme.Dark" : "Theme.Light";

        Application.Current.Resources.MergedDictionaries[0] = new ResourceDictionary
        {
            Source = new Uri(
                $"pack://application:,,,/NiftyTimer;component/UI/{name}.xaml",
                UriKind.Absolute),
        };
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _host.Dispose();
    }

    /// <summary>
    /// Re-read and apply, but only on a real change. WM_SETTINGCHANGE also fires for DPI, locale
    /// and accessibility changes; re-merging the dictionary on each of those would rebuild every
    /// brush in the app for nothing.
    /// </summary>
    internal void OnSettingChange()
    {
        var next = _read();
        if (next == Current)
        {
            return;
        }

        Current = next;
        _apply(next);
    }

    private IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmSettingChange && IsColorSetChange(lParam))
        {
            OnSettingChange();
        }

        return IntPtr.Zero;
    }

    private static bool IsColorSetChange(IntPtr lParam) =>
        lParam != IntPtr.Zero
        && string.Equals(
            Marshal.PtrToStringUni(lParam),
            "ImmersiveColorSet",
            StringComparison.Ordinal);
}
