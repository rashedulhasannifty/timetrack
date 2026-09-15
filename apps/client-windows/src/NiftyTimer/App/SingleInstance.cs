namespace NiftyTimer.App;

/// <summary>
/// One running copy per install, per signed-in Windows session.
///
/// Without this, starting the exe while the app was already running started a second copy: two
/// tray icons, two sets of timers, and two processes draining the same durable buffers. That was
/// also the person's only remedy when the icon seemed to vanish, which made it common.
///
/// A second launch now asks the running copy to open its menu — so double-clicking the exe still
/// "brings it back", which is what people already do — and then exits.
///
/// The names are scoped to the install through <see cref="AppInstall.SupportDirectoryName"/>, the
/// same key as its data folder, so a dev build never blocks the released one. <c>Local\</c> keeps
/// them per session, so two people signed in to one machine each get their own copy.
/// </summary>
public sealed class SingleInstance : IDisposable
{
    /// <summary>
    /// How long a launch waits for a copy that is on its way out — the updater's relaunch, or a
    /// double-click during quit — before concluding the lock is really held.
    /// </summary>
    public static readonly TimeSpan HandOverWait = TimeSpan.FromSeconds(5);

    private readonly Mutex _mutex;
    private readonly EventWaitHandle _showRequest;
    private readonly RegisteredWaitHandle _registration;
    private bool _disposed;

    private SingleInstance(Mutex mutex, EventWaitHandle showRequest)
    {
        _mutex = mutex;
        _showRequest = showRequest;
        _registration = ThreadPool.RegisterWaitForSingleObject(
            showRequest,
            (_, _) => ShowRequested?.Invoke(),
            state: null,
            millisecondsTimeOutInterval: Timeout.Infinite,
            executeOnlyOnce: false);
    }

    /// <summary>Another launch asked this copy to open its menu. Raised on a thread-pool thread.</summary>
    public event Action? ShowRequested;

    internal static string MutexName(string? appId) =>
        $@"Local\{AppInstall.SupportDirectoryName(appId)}.instance";

    internal static string ShowEventName(string? appId) =>
        $@"Local\{AppInstall.SupportDirectoryName(appId)}.show";

    /// <summary>
    /// Claim the install's lock, waiting up to <paramref name="wait"/> for a copy that is exiting.
    /// Null when another copy holds it. Call on the thread that will later dispose the result:
    /// a mutex is released by the thread that owns it.
    /// </summary>
    public static SingleInstance? TryAcquire(string? appId, TimeSpan wait)
    {
        var mutex = new Mutex(initiallyOwned: false, MutexName(appId));
        bool owned;
        try
        {
            owned = mutex.WaitOne(wait);
        }
        catch (AbandonedMutexException)
        {
            // The previous copy ended without releasing it — a crash, or a kill. Ownership passes
            // to this call, which is exactly the case this app must recover from.
            owned = true;
        }

        if (!owned)
        {
            mutex.Dispose();
            return null;
        }

        var showRequest = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName(appId));
        return new SingleInstance(mutex, showRequest);
    }

    /// <summary>Ask the running copy to open its menu. False when no copy is listening.</summary>
    public static bool SignalRunning(string? appId)
    {
        try
        {
            using var showRequest = EventWaitHandle.OpenExisting(ShowEventName(appId));
            return showRequest.Set();
        }
        catch (Exception e) when (e is WaitHandleCannotBeOpenedException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _registration.Unregister(null);
        _showRequest.Dispose();

        try
        {
            _mutex.ReleaseMutex();
        }
        catch (ApplicationException)
        {
            // Disposed from a thread that does not own it. Closing the handle below still frees
            // it for the next launch, which sees it as abandoned and takes it.
        }

        _mutex.Dispose();
    }
}
