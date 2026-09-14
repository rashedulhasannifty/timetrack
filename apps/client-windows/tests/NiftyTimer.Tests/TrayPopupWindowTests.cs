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
            Math.Abs(work.Right - 320 - 12 - left) < 1.0,
            $"Left={left}, expected near {work.Right - 320 - 12}");
        Assert.True(
            Math.Abs(work.Bottom - windowHeight - 12 - top) < 1.0,
            $"Top={top}, expected near {work.Bottom - windowHeight - 12}");

        // The content Border still fills the window's own layout bounds exactly, i.e. WPF added
        // no margin/frame of its own between the window edge and the card that ShowNearTray's
        // formula assumes are the same rectangle.
        Assert.Equal(320d, windowWidth, precision: 3);
        Assert.Equal(windowWidth, borderWidth, precision: 3);
        Assert.Equal(windowHeight, borderHeight, precision: 3);
    }
}

/// <summary>
/// The picker as the person uses it: typing into the real search field filters the real list,
/// and picking a row reaches the view model. Driven headlessly on the shared WPF thread; the
/// window is constructed but never shown.
/// </summary>
[Collection("wpf")]
public class TrayPopupPickerTests
{
    private static readonly Project Website = new(
        "p1", "team", "Website", false, [new ProjectTask("t1", "p1", "Design review")]);

    private static readonly Project Billing = new("p2", "team", "Billing", false, null);

    private static T WithPopup<T>(Func<MenuViewModel, TrayPopupWindow, T> body) =>
        Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 9, 14, 9, 0, 0, TimeSpan.Zero));
            var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()))
            {
                Projects = [Website, Billing],
            };
            var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");

            try
            {
                return body(viewModel, window);
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });

    [Fact]
    public void TypingInTheSearchFieldFiltersTheListBySubstring()
    {
        var (query, shown) = WithPopup((vm, window) =>
        {
            ((TextBox)window.FindName("SearchBox")).Text = "design";
            var list = (ListBox)window.FindName("ProjectList");
            return (vm.Query, list.Items.Cast<PickerChoice>().ToList());
        });

        Assert.Equal("design", query);
        Assert.Equal("t1", Assert.Single(shown).TaskId);
    }

    [Fact]
    public void PickingARowSelectsItsProjectAndTask()
    {
        var selection = WithPopup((vm, window) =>
        {
            var list = (ListBox)window.FindName("ProjectList");
            list.SelectedItem = list.Items.Cast<PickerChoice>().Single(c => c.TaskId == "t1");
            return vm.Selection;
        });

        Assert.Equal(new StoredSelection("p1", "t1"), selection);
    }

    /// <summary>The hint is the field's only label, so it must go the moment anything is typed.</summary>
    [Fact]
    public void ThePlaceholderHidesOnceSomethingIsTyped()
    {
        var (before, after) = WithPopup((_, window) =>
        {
            var hint = (TextBlock)window.FindName("SearchHint");
            var first = hint.Visibility;
            ((TextBox)window.FindName("SearchBox")).Text = "b";
            return (first, hint.Visibility);
        });

        Assert.Equal(Visibility.Visible, before);
        Assert.Equal(Visibility.Collapsed, after);
    }
}

/// <summary>
/// The popup when nobody is signed in: a Sign in button and Quit, and none of the session's
/// controls. Mirrors the macOS dropdown's signed-out view.
/// </summary>
[Collection("wpf")]
public class TrayPopupSignedOutTests
{
    private static T WithPopup<T>(bool signedIn, Func<TrayPopupWindow, T> body) =>
        Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 9, 14, 9, 0, 0, TimeSpan.Zero));
            var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()));
            var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");
            viewModel.IsSignedIn = signedIn;

            try
            {
                return body(window);
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });

    private static (Visibility SignedOut, Visibility SignedIn) Panels(TrayPopupWindow window) => (
        ((FrameworkElement)window.FindName("SignedOutPanel")).Visibility,
        ((FrameworkElement)window.FindName("SignedInPanel")).Visibility);

    [Fact]
    public void SignedOutShowsOnlyTheSignInPanel()
    {
        var (signedOut, signedIn) = WithPopup(signedIn: false, Panels);

        Assert.Equal(Visibility.Visible, signedOut);
        Assert.Equal(Visibility.Collapsed, signedIn);
    }

    [Fact]
    public void SignedInShowsOnlyTheSessionPanel()
    {
        var (signedOut, signedIn) = WithPopup(signedIn: true, Panels);

        Assert.Equal(Visibility.Collapsed, signedOut);
        Assert.Equal(Visibility.Visible, signedIn);
    }

    [Fact]
    public void TheSignInButtonAsksForTheSignInWindow()
    {
        var asked = WithPopup(signedIn: false, window =>
        {
            var count = 0;
            window.SignInRequested += () => count++;
            ((Button)window.FindName("SignInButton")).RaiseEvent(
                new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            return count;
        });

        Assert.Equal(1, asked);
    }
}

/// <summary>The AppDelegate half of the signed-out panel, pinned with the shared IL scanner.</summary>
public class SignInWiringTests
{
    /// <summary>
    /// Both launch branches that find a stored session — online and offline — must mark it signed
    /// in, or a signed-in person opens the popup to "Not signed in".
    /// </summary>
    [Fact]
    public void TheLaunchMarksAStoredSessionSignedIn() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("BootstrapAsync"), nameof(MenuViewModel), "set_IsSignedIn"),
            "AppDelegate.BootstrapAsync no longer marks a stored session as signed in.");

    [Fact]
    public void ThePopupsSignInButtonOpensTheSignInWindow() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("WireEvents"), nameof(AppDelegate), "ShowLogin"),
            "AppDelegate.WireEvents no longer hands ShowLogin to the popup's Sign in button.");
}

/// <summary>The update row: the version by name, and what the link will do.</summary>
[Collection("wpf")]
public class TrayPopupUpdateRowTests
{
    private static T WithPopup<T>(Action<MenuViewModel> arrange, Func<TrayPopupWindow, T> body) =>
        Wpf.Run(() =>
        {
            var tracker = new TimeTracker(
                new BufferSpy(),
                () => new DateTimeOffset(2026, 9, 14, 9, 0, 0, TimeSpan.Zero));
            var viewModel = new MenuViewModel(tracker, new SelectionStore(new InMemoryUserSettings()))
            {
                IsSignedIn = true,
            };
            var window = new TrayPopupWindow(viewModel, new Uri("https://example.invalid/"), "test-build");
            arrange(viewModel);

            try
            {
                return body(window);
            }
            finally
            {
                window.AllowClose = true;
                window.Close();
            }
        });

    [Fact]
    public void AnAvailableUpdateIsOfferedByVersion()
    {
        var (row, content) = WithPopup(
            vm =>
            {
                vm.UpdateVersion = "1.4.0";
                vm.UpdateAvailable = true;
            },
            window => (
                ((FrameworkElement)window.FindName("UpdateRow")).Visibility,
                ((Button)window.FindName("UpdateButton")).Content));

        Assert.Equal(Visibility.Visible, row);
        Assert.Equal("Update to 1.4.0", content);
    }

    [Fact]
    public void WhileInstallingTheLinkGivesWayToAStatusLine()
    {
        var (button, label, text) = WithPopup(
            vm =>
            {
                vm.UpdateVersion = "1.4.0";
                vm.UpdateAvailable = true;
                vm.IsInstallingUpdate = true;
            },
            window => (
                ((Button)window.FindName("UpdateButton")).Visibility,
                ((TextBlock)window.FindName("UpdateProgressLabel")).Visibility,
                ((TextBlock)window.FindName("UpdateProgressLabel")).Text));

        Assert.Equal(Visibility.Collapsed, button);
        Assert.Equal(Visibility.Visible, label);
        Assert.Equal("Updating to 1.4.0…", text);
    }

    [Fact]
    public void NoUpdateNoRow()
    {
        var row = WithPopup(
            _ => { },
            window => ((FrameworkElement)window.FindName("UpdateRow")).Visibility);

        Assert.Equal(Visibility.Collapsed, row);
    }
}

public class UpdateWiringTests
{
    [Fact]
    public void TheReleasesPageIsTheRepositorysLatestRelease() =>
        Assert.Equal(
            new Uri("https://github.com/owner/repo/releases/latest"),
            AppDelegate.ReleasesPage("owner/repo"));

    /// <summary>The link routes through the install-or-download decision, not straight to install.</summary>
    [Fact]
    public void ThePopupsUpdateLinkDecidesBetweenInstallAndDownload() =>
        Assert.True(
            LaunchResolutionWiringTests.References(
                LaunchResolutionWiringTests.Body("WireEvents"), nameof(AppDelegate), "OnUpdateRequested"),
            "AppDelegate.WireEvents no longer routes the update link through OnUpdateRequested.");
}
