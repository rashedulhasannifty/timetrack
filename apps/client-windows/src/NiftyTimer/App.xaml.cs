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

        // Before the delegate starts, so the first window is drawn in the right theme rather than
        // flashing light and correcting itself.
        _theme = new ThemeWatcher();

        _delegate = new App.AppDelegate();
        _delegate.Start();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _theme?.Dispose();
        _delegate?.Dispose();
        base.OnExit(e);
    }
}
