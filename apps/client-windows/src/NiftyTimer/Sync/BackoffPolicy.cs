namespace NiftyTimer.Sync;

/// <summary>
/// PRD §7.5 — exponential backoff for the sync retry loop. Pure and deterministic: no timers, no
/// clock. <see cref="NextDelay"/> returns base·2^failures capped at <c>maxDelay</c>, transformed
/// by an injected jitter, and advances the failure count. <see cref="Reset"/> (called on a
/// successful upload) returns to the base. <see cref="SyncEngine"/> owns the timer and decides
/// when to call these.
///
/// Unlike the Swift original — whose <c>jitter</c> defaults to the identity function, so shipped
/// builds retry in lockstep — the default here is real ±25% randomization. The API's throttler is
/// a flat 100 req/min keyed on the request IP, which a whole office shares behind one NAT, and a
/// 429 classifies as transient. Without jitter every client in that office retries on the same
/// tick and re-trips the limit together.
/// </summary>
public sealed class BackoffPolicy
{
    private readonly TimeSpan _base;
    private readonly TimeSpan _maxDelay;
    private readonly Func<TimeSpan, TimeSpan> _jitter;

    public BackoffPolicy(
        TimeSpan? baseDelay = null,
        TimeSpan? maxDelay = null,
        Func<TimeSpan, TimeSpan>? jitter = null)
    {
        _base = baseDelay ?? TimeSpan.FromSeconds(5);
        _maxDelay = maxDelay ?? TimeSpan.FromSeconds(300);
        _jitter = jitter ?? DefaultJitter;
    }

    public int FailureCount { get; private set; }

    /// <summary>The delay before the next attempt; advances the failure count.</summary>
    public TimeSpan NextDelay()
    {
        var raw = TimeSpan.FromSeconds(
            Math.Min(_maxDelay.TotalSeconds, _base.TotalSeconds * Math.Pow(2, FailureCount)));
        FailureCount++;
        return _jitter(raw);
    }

    public void Reset() => FailureCount = 0;

    /// <summary>Uniform ±25%, never negative.</summary>
    public static TimeSpan DefaultJitter(TimeSpan raw)
    {
        // GetInt32 is [min, max) — 5001 buckets over [-2500, 2500] basis points.
        var basisPoints = System.Security.Cryptography.RandomNumberGenerator.GetInt32(-2500, 2501);
        var factor = 1.0 + (basisPoints / 10000.0);
        return TimeSpan.FromSeconds(Math.Max(0, raw.TotalSeconds * factor));
    }
}
