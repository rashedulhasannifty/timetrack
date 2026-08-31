using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using NiftyTimer.App;
using NiftyTimer.Projects;
using NiftyTimer.Storage;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using NiftyTimer.UI;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// Task 7 swapped <c>AllowsTransparency="True"</c> (window bounds == card bounds, by construction,
/// because a transparent window paints nothing of its own) for a real window frame that DWM rounds
/// via <c>DWMWA_WINDOW_CORNER_PREFERENCE</c>. <see cref="TrayPopupWindow.ShowNearTray"/>'s Left/Top
/// math — <c>SystemParameters.WorkArea</c> minus <c>Width</c>/<c>ActualHeight</c> — was written
/// against that transparent window, so this is the moment a shift would appear: if dropping
/// transparency had reintroduced any OS-drawn non-client frame, the card would sit inset from the
/// corner <c>ShowNearTray</c> targets even though the formula itself is untouched.
///
/// No agent in this session had display access to perform the brief's Step 3 by eye. This proves
/// the same code path headlessly: it runs the real <c>ShowNearTray</c> against the real (now
/// non-transparent) window and checks that the content <see cref="Border"/> still fills the
/// window's own layout bounds exactly, at the corner <c>ShowNearTray</c> computes. It does NOT
/// prove no OS-level non-client pixel was added outside WPF's own layout system (that class of
/// regression only shows up on screen) — Step 3's manual/visual check still stands as unperformed.
/// </summary>
[Collection("wpf")]
public class TrayPopupWindowPositionTests
{
    [Fact]
    public void ShowNearTrayAnchorsFlushToTheWorkAreaCornerWithNoLayoutGap()
    {
        var (left, top, windowWidth, windowHeight, borderWidth, borderHeight, work) = Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero));
            var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()));
            var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");

            try
            {
                window.ShowNearTray();

                // ShowNearTray queues a Loaded-priority callback to correct Top once
                // SizeToContent has actually measured the window. An empty Invoke at the same
                // priority runs behind it in FIFO order, so this returns only once that
                // correction has already happened.
                window.Dispatcher.Invoke(() => { }, DispatcherPriority.Loaded);

                var border = (Border)window.Content;
                return (
                    window.Left,
                    window.Top,
                    window.ActualWidth,
                    window.ActualHeight,
                    border.ActualWidth,
                    border.ActualHeight,
                    SystemParameters.WorkArea);
            }
            finally
            {
                // OnClosing cancels every close unless this is set — without it the window leaks
                // into the shared "wpf" dispatcher for the rest of the test run.
                window.AllowClose = true;
                window.Close();
            }
        });

        // Width is fixed (SizeToContent="Height" only, per the brief); ActualHeight only settles
        // after the first layout pass, which is exactly why ShowNearTray corrects Top
        // asynchronously rather than trusting it immediately after Show(). The tolerance (rather
        // than exact equality) is for HWND placement snapping to the physical pixel grid at the
        // active DPI scale — that snapping happens on Left/Top regardless of AllowsTransparency,
        // so up to one device pixel of slack is expected and is not itself a regression.
        Assert.True(
            Math.Abs(work.Right - 340 - 12 - left) < 1.0,
            $"Left={left}, expected near {work.Right - 340 - 12}");
        Assert.True(
            Math.Abs(work.Bottom - windowHeight - 12 - top) < 1.0,
            $"Top={top}, expected near {work.Bottom - windowHeight - 12}");

        // The content Border still fills the window's own layout bounds exactly, i.e. WPF added
        // no margin/frame of its own between the window edge and the card that ShowNearTray's
        // formula assumes are the same rectangle.
        Assert.Equal(340d, windowWidth, precision: 3);
        Assert.Equal(windowWidth, borderWidth, precision: 3);
        Assert.Equal(windowHeight, borderHeight, precision: 3);
    }
}
