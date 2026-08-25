namespace NiftyTimer.Update;

/// <summary>
/// Owns the update check: when to run it, what the answer means, and nothing else.
///
/// Two triggers, for two different reasons. A six-hourly poll so a long-running install still
/// learns about a release; and a check when the menu opens, throttled to once every thirty
/// minutes, so somebody who has just been told about a release sees it without waiting for the
/// next poll. The throttle is what stops the menu becoming a way to spend the unauthenticated
/// GitHub rate limit sixty times an hour.
///
/// <b>Gated on <c>AppInstall.IsProduction</c>.</b> A developer build has no business polling a
/// release feed, and would be told forever that it is out of date — its version does not parse as
/// a release version at all.
///
/// <b>Nothing here can stop tracking.</b> The strongest state this produces is
/// <see cref="UpdateStatus.Overdue"/>, which puts a marker on the tray. A failed check is silent:
/// rate limiting, no network, and an unparseable running version all collapse to
/// <see cref="UpdateStatus.UnknownOrCurrent"/>, because an update check that could not run is not
/// something to nag a person about.
/// </summary>
public sealed class UpdateCoordinator : IDisposable
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromHours(6);
    private static readonly TimeSpan MenuThrottle = TimeSpan.FromMinutes(30);

    private readonly IUpdateFeed _feed;
    private readonly UpdateEvaluator _evaluator;
    private readonly Func<AppVersion?> _currentVersion;
    private readonly Func<DateTimeOffset> _clock;
    private readonly bool _enabled;
    private readonly Lock _gate = new();

    private DateTimeOffset? _lastChecked;
    private UpdateStatus _status = new UpdateStatus.UnknownOrCurrent();
    private Timer? _timer;
    private bool _disposed;

    public UpdateCoordinator(
        IUpdateFeed feed,
        bool enabled,
        UpdateEvaluator? evaluator = null,
        Func<AppVersion?>? currentVersion = null,
        Func<DateTimeOffset>? clock = null)
    {
        _feed = feed;
        _enabled = enabled;
        _evaluator = evaluator ?? new UpdateEvaluator();
        _currentVersion = currentVersion ?? (() => AppVersion.Current());
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <summary>Raised only when the status actually changes, so the tray is not rewritten every poll.</summary>
    public event Action<UpdateStatus>? StatusChanged;

    public UpdateStatus Status
    {
        get
        {
            lock (_gate)
            {
                return _status;
            }
        }
    }

    public void Start()
    {
        if (!_enabled)
        {
            return;
        }

        lock (_gate)
        {
            if (_timer is not null || _disposed)
            {
                return;
            }

            _timer = new Timer(
                static state => _ = ((UpdateCoordinator)state!).CheckAsync(),
                this,
                TimeSpan.Zero,
                PollInterval);
        }
    }

    public void Stop()
    {
        lock (_gate)
        {
            _timer?.Dispose();
            _timer = null;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Stop();
    }

    /// <summary>
    /// The menu was opened. Checks at most once every thirty minutes; otherwise reports the status
    /// already held. Returns whether a check actually ran, which is what the throttle test asserts.
    /// </summary>
    public async Task<bool> CheckOnMenuOpenAsync(CancellationToken cancellationToken = default)
    {
        if (!_enabled)
        {
            return false;
        }

        lock (_gate)
        {
            if (_lastChecked is { } last && _clock() - last < MenuThrottle)
            {
                return false;
            }
        }

        await CheckAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <summary>
    /// One check. Never throws: every failure mode — HTTP, rate limiting, malformed JSON, no
    /// network — leaves the previous status in place rather than reporting something alarming.
    /// </summary>
    public async Task CheckAsync(CancellationToken cancellationToken = default)
    {
        if (!_enabled)
        {
            return;
        }

        // Stamp the attempt before awaiting, so a slow or failing check still consumes the
        // throttle. Otherwise an office with no network would retry on every single menu open.
        lock (_gate)
        {
            _lastChecked = _clock();
        }

        ReleaseManifest manifest;
        try
        {
            manifest = await _feed.LatestAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception e) when (e is UpdateFeedException or System.Net.Http.HttpRequestException
                                      or TaskCanceledException or OperationCanceledException)
        {
            // Deliberately silent, rate limiting included. There is nothing a person can do about
            // a check that did not run, so telling them about it is pure noise.
            return;
        }

        var next = _evaluator.Evaluate(_currentVersion(), manifest, _clock());

        bool changed;
        lock (_gate)
        {
            changed = _status != next;
            _status = next;
        }

        if (changed)
        {
            StatusChanged?.Invoke(next);
        }
    }
}
