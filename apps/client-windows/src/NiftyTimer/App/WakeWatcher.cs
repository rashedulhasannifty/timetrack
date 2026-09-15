using System.Windows.Interop;

namespace NiftyTimer.App;

/// <summary>
/// Reports that the machine has resumed from sleep. The Windows counterpart of the macOS client's
/// <c>NSWorkspace.didWakeNotification</c> observer, and used for the same one thing: a machine that
/// failed its launch-time policy resolve most likely has network again the moment it wakes, so the
/// retry should run now rather than sit out the rest of a five-minute backoff the sleep already
/// outlasted.
///
/// Deliberately separate from <see cref="Tracking.SessionObserver"/>, which also sees resume: that
/// observer watches the person, so it is installed only behind the acknowledgement gate — which is
/// exactly the install this watcher exists to retry. Waking up is a fact about the machine, not the
/// person, so this reads nothing but the broadcast itself.
///
/// The signal is <c>WM_POWERBROADCAST</c>, a broadcast, which is why it needs the top-level
/// <see cref="MessageWindow"/> rather than a message-only one. A window procedure also runs on the
/// UI thread, so the callback needs no dispatcher hop — the reason <see cref="UI.ThemeWatcher"/>
/// takes the same route over <c>SystemEvents</c>.
/// </summary>
public sealed class WakeWatcher : IDisposable
{
    private const int WmPowerBroadcast = 0x0218;
    private const int PbtApmResumeSuspend = 0x0007;
    private const int PbtApmResumeAutomatic = 0x0012;

    private readonly Action _onWake;
    private readonly IMessageHost _host;
    private bool _disposed;

    public WakeWatcher(Action onWake, Func<HwndSourceHook, IMessageHost>? host = null)
    {
        _onWake = onWake;
        var factory = host ?? (hook => new MessageWindowHost("NiftyTimer.WakeHost", hook));
        _host = factory(Hook);
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
    /// Both resume codes count. A wake the person triggered delivers
    /// <c>PBT_APMRESUMEAUTOMATIC</c> and then <c>PBT_APMRESUMESUSPEND</c>, so the callback can run
    /// twice for one wake; the consumer is idempotent for that reason.
    /// </summary>
    internal static bool IsResume(int msg, IntPtr wParam) =>
        msg == WmPowerBroadcast && (int)wParam is PbtApmResumeSuspend or PbtApmResumeAutomatic;

    private IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (IsResume(msg, wParam))
        {
            _onWake();
        }

        return IntPtr.Zero;
    }
}
