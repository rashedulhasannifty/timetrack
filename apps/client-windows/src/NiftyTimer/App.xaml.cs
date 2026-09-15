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
    private App.SingleInstance? _instance;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var config = App.AppConfig.Load();

        // First, before anything that can fail. An error while the app was being built used to end
        // the process with no message and no trace — the icon was simply never there.
        var crashLog = new App.CrashLog(App.AppInstall.SupportDirectory(config.AppId));
        crashLog.Install(this);

        // One copy per install. A second launch opens the running copy's menu and leaves — the exe
        // is what people double-click when they think the app has gone, so it must bring it back
        // rather than start a second copy draining the same buffers.
        _instance = App.SingleInstance.TryAcquire(config.AppId, TimeSpan.Zero);
        if (_instance is null && App.SingleInstance.SignalRunning(config.AppId))
        {
            Shutdown();
            return;
        }

        // Nobody answered, so the holder is on its way out — the updater's relaunch, or a quit in
        // progress. Give it a moment to let go rather than refusing to start.
        _instance ??= App.SingleInstance.TryAcquire(config.AppId, App.SingleInstance.HandOverWait);
        if (_instance is null)
        {
            crashLog.Write("Another copy holds the single-instance lock and did not answer. Exiting.");
            Shutdown();
            return;
        }

        // A local, not the field: the field is nullable and the compiler's flow analysis does not
        // follow an assignment into a lambda, so capturing it would be CS8602 — and CS8602 is an
        // error here, not a warning.
        var appDelegate = new App.AppDelegate(crashLog);
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

        // Raised on a thread-pool thread; the menu is UI.
        _instance.ShowRequested += () => Dispatcher.InvokeAsync(appDelegate.ShowMenu);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _theme?.Dispose();
        _delegate?.Dispose();

        // Last, and on the UI thread that claimed it: a mutex is released by its owner.
        _instance?.Dispose();
        base.OnExit(e);
    }
}
