namespace NiftyTimer.Policy;

/// <summary>
/// The team policy as the running client currently understands it.
///
/// Settings the capture path acts on would otherwise be frozen into the subsystems built at
/// launch, so an admin's edit in the dashboard would do nothing until the employee quit and
/// reopened the app — while the settings page promises "changes take effect on each client's next
/// heartbeat (≤60s)". <see cref="AckGate"/> already re-fetches the effective policy before EVERY
/// capture cycle to check <c>ackRequired</c>; it publishes each fetched policy here, so those
/// settings ride the fetch that was happening anyway. No extra timer, no second network cadence,
/// and the refresh naturally stops when the clock stops.
///
/// Read from background cycles and written from the gate; the lock makes the swap atomic, so a
/// tick sees one coherent snapshot rather than a half-applied policy.
///
/// Scope: what a running client can change on the fly. The screenshot interval, the idle
/// threshold and auto-start-on-login are wired into timers built at launch and still need a
/// relaunch to change.
/// </summary>
public sealed class LivePolicy
{
    /// <summary>
    /// Nothing fetched yet. Never used for real once the gate has opened once — the first capture
    /// cycle replaces it.
    /// </summary>
    public static readonly PolicySettings Pending = new()
    {
        CaptureWindowTitles = false,
        DistractionAlertsEnabled = false,
    };

    private readonly Lock _gate = new();
    private PolicySettings _snapshot;

    public LivePolicy(PolicySettings? initial = null) => _snapshot = initial ?? Pending;

    public PolicySettings Current
    {
        get
        {
            lock (_gate)
            {
                return _snapshot;
            }
        }
    }

    public void Update(PolicySettings settings)
    {
        lock (_gate)
        {
            _snapshot = settings;
        }
    }
}
