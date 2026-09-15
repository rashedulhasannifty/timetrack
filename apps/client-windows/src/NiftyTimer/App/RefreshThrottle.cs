namespace NiftyTimer.App;

/// <summary>
/// Rate-limits an on-demand refresh — re-fetching projects or totals as the menu opens — so a
/// person clicking the tray icon repeatedly does not hammer the API and its throttler. Ported from
/// the macOS client's <c>RefreshThrottle</c>.
///
/// <see cref="ShouldRefresh"/> allows at most once per interval and records the moment it allowed;
/// the first call always allows. Pure apart from the injected clock. UI-thread-only, like its only
/// caller.
/// </summary>
public sealed class RefreshThrottle
{
    private readonly TimeSpan _minInterval;
    private readonly Func<DateTimeOffset> _clock;
    private DateTimeOffset? _last;

    public RefreshThrottle(TimeSpan minInterval, Func<DateTimeOffset>? clock = null)
    {
        _minInterval = minInterval;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public bool ShouldRefresh()
    {
        var now = _clock();
        if (_last is { } last && now - last < _minInterval)
        {
            return false;
        }

        _last = now;
        return true;
    }

    /// <summary>Sign-out: the next person's first menu open refreshes at once.</summary>
    public void Reset() => _last = null;
}
