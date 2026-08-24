using System.Runtime.InteropServices;
using NiftyTimer.App;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// A regression guard on a Win32 property, not on our own logic — which is the only reason it is
/// worth an OS-level test.
///
/// The tray host was originally a message-only window (<c>HWND_MESSAGE</c> as parent). Everything
/// about that looked right and every behavioural test passed, because message-only windows receive
/// every message that is <i>sent to them</i>. What they never receive is a <b>broadcast</b> — and
/// <c>TaskbarCreated</c> (Explorer restarted; re-add your tray icon) and <c>WM_POWERBROADCAST</c>
/// (the machine slept) are both broadcasts. The handling code for both existed and was simply
/// unreachable: the always-visible indicator (PRD §4.2) stayed gone after any Explorer restart,
/// with no error anywhere.
///
/// <c>EnumWindows</c> is the sharp test for the distinction: it enumerates top-level windows and
/// explicitly does not enumerate message-only ones — the same population the system broadcasts to.
/// So "found by EnumWindows" is exactly "will receive broadcasts", which is the property the tray
/// icon depends on and which nothing else in the suite can observe.
/// </summary>
[Collection("wpf")]
public class MessageWindowTests
{
    [Fact]
    public void IsATopLevelWindowSoBroadcastsReachIt()
    {
        var found = Wpf.Run(() =>
        {
            using var window = new MessageWindow(
                "NiftyTimer.Tests.BroadcastProbe",
                (IntPtr _, int _, IntPtr _, IntPtr _, ref bool _) => IntPtr.Zero);

            return TopLevelWindows().Contains(window.Handle);
        });

        Assert.True(
            found,
            "MessageWindow must be a hidden TOP-LEVEL window. It is not enumerable as one, which " +
            "means it is message-only and will silently drop TaskbarCreated and WM_POWERBROADCAST.");
    }

    /// <summary>The window must stay invisible — hidden top-level, never a stray empty frame.</summary>
    [Fact]
    public void IsNeverVisible()
    {
        var visible = Wpf.Run(() =>
        {
            using var window = new MessageWindow(
                "NiftyTimer.Tests.VisibilityProbe",
                (IntPtr _, int _, IntPtr _, IntPtr _, ref bool _) => IntPtr.Zero);

            return IsWindowVisible(window.Handle);
        });

        Assert.False(visible);
    }

    private static List<IntPtr> TopLevelWindows()
    {
        var handles = new List<IntPtr>();
        EnumWindows(
            (handle, _) =>
            {
                handles.Add(handle);
                return true;
            },
            IntPtr.Zero);
        return handles;
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);
}
