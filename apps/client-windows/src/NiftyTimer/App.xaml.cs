using System.Windows;
using NiftyTimer.UI;

namespace NiftyTimer;

/// <summary>
/// The app has no main window: like the macOS client's <c>LSUIElement</c> menu bar app, the only
/// permanently visible surface is the tray icon. <c>ShutdownMode="OnExplicitShutdown"</c> is what
/// keeps the process alive while every window is closed.
///
/// Named <c>NiftyTimerApp</c> rather than <c>App</c> so the <c>NiftyTimer.App</c> namespace
/// (which holds the wiring — <see cref="App.AppInstall"/>, <see cref="App.AppDelegate"/>) is not
/// shadowed by a type of the same name.
/// </summary>
public partial class NiftyTimerApp : Application
{
    private App.AppDelegate? _delegate;
    private ThemeWatcher? _theme;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // A local, not the field: the field is nullable and the compiler's flow analysis does not
        // follow an assignment into a lambda, so capturing it would be CS8602 — and CS8602 is an
        // error here, not a warning.
        var appDelegate = new App.AppDelegate();
        _delegate = appDelegate;

        // The watcher applies once on construction, so the delegate must exist first or that very
        // first ApplyTheme lands on a null tray.
        _theme = new ThemeWatcher(
            ThemeResolver.FromRegistry,
            theme =>
            {
                ThemeWatcher.ApplyToApplication(theme);
                appDelegate.ApplyTheme(theme);
            },
            hook => new App.MessageWindowHost("NiftyTimer.ThemeHost", hook));

        appDelegate.Start();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _theme?.Dispose();
        _delegate?.Dispose();
        base.OnExit(e);
    }
}
