namespace NiftyTimer.Tracking;

/// <summary>
/// PRD §6.3 — the pure activity-% computation. The sampling interval is split into N sub-buckets;
/// a bucket counts as "active" if ANY input occurred in it, key or pointer. The result is
/// <c>active / N × 100</c>.
///
/// Deliberately separated from timing so it is fully unit-testable, and deliberately NOT in a
/// capture namespace: it takes two integers per bucket and returns a percentage. It touches no
/// hardware and needs no gate — it sits beside <see cref="IdleMonitor"/>, the other pure machine
/// the capture layer drives.
///
/// A class rather than a struct: the Swift original is a mutable struct, and the C# equivalent
/// would be copied by every assignment and parameter pass, silently discarding buckets.
/// </summary>
public sealed class ActivityRateMeter
{
    private readonly int _buckets;
    private int _seen;
    private int _active;

    public ActivityRateMeter(int buckets) => _buckets = Math.Max(1, buckets);

    /// <summary>
    /// Record one sub-bucket from the input-count deltas measured across it. Buckets beyond the
    /// configured count are ignored, so a cycle that somehow over-runs cannot report above 100%.
    /// </summary>
    public void AddBucket(long keyDelta, long pointerDelta)
    {
        if (_seen >= _buckets)
        {
            return;
        }

        _seen++;
        if (keyDelta > 0 || pointerDelta > 0)
        {
            _active++;
        }
    }

    /// <summary>round(active / buckets × 100), clamped to 0…100 (the server's schema bound).</summary>
    public int ActivityPct()
    {
        var pct = (int)Math.Round(_active / (double)_buckets * 100, MidpointRounding.AwayFromZero);
        return Math.Clamp(pct, 0, 100);
    }
}
