using NiftyTimer.Policy;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tracking;

namespace NiftyTimer.Activity;

/// <summary>
/// PRD §6.3 — the activity CAPTURE path.
///
/// A self-gating interval timer. Each cycle, only while the clock is running and only through
/// <see cref="AckGate"/>, it measures the interval in <see cref="SubBuckets"/> sub-buckets off the
/// content-free counters, computes an activity percentage, reads the foreground application,
/// categorizes it against the live policy lists, mints a UUIDv7 and enqueues exactly one sample.
///
/// <c>isTracking</c> is checked BEFORE the gate, so a stopped clock never triggers a policy fetch —
/// otherwise an idle laptop would poll the API once a minute forever for no reason.
///
/// **Rescheduling is asymmetric and that is the point.** A cycle that MEASURED reschedules
/// immediately (delay zero), because the measurement itself consumed the full interval — that is
/// what keeps windows contiguous: …[0,60][60,120][120,180]… A cycle that SKIPPED (not tracking,
/// gate closed) waits the whole interval before retrying, so a closed gate cannot busy-loop policy
/// fetches. Collapse the two into "always wait the interval" and every measured window is followed
/// by a dead interval: activity is sampled half as often and every rollup silently under-reports.
/// A naive test passes either way, which is why <c>ActivitySamplerTests</c> asserts the delay.
///
/// Gate closed or errored → the whole interval is skipped. There is no partial sample, and no
/// fallback path.
/// </summary>
public sealed class ActivitySampler : IDisposable
{
    /// <summary>
    /// Mirrors <c>ACTIVITY_SAMPLE_INTERVAL_SECONDS</c> in @timetrack/contracts. The client cannot
    /// import the TypeScript constant, so it is mirrored by convention — the worker multiplies
    /// sample COUNT by this to get minutes, so changing one side alone silently rescales every
    /// report.
    /// </summary>
    public const int IntervalSeconds = 60;

    /// <summary>Sub-buckets per interval. A bucket is "active" if any key OR pointer event fell in it.</summary>
    public const int SubBuckets = 12;

    private readonly AckGate _ackGate;
    private readonly IInputCounting _counter;
    private readonly IAppSampling _appSampler;
    private readonly LivePolicy _livePolicy;
    private readonly IActivitySampleBuffer _store;
    private readonly TimeSpan _interval;
    private readonly int _subBuckets;
    private readonly Func<bool> _isTracking;
    private readonly Func<DateTimeOffset, string> _idGen;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Func<TimeSpan, CancellationToken, Task> _sleep;
    private readonly Action _onSampled;
    private readonly Lock _gate = new();

    private CancellationTokenSource _cycles = new();
    private Timer? _timer;
    private Task _currentCycle = Task.CompletedTask;
    private bool _started;
    private bool _isCapturing;
    private bool _disposed;

    public ActivitySampler(
        AckGate ackGate,
        IInputCounting counter,
        IAppSampling appSampler,
        LivePolicy livePolicy,
        IActivitySampleBuffer store,
        Func<bool> isTracking,
        TimeSpan? interval = null,
        int subBuckets = SubBuckets,
        Func<DateTimeOffset, string>? idGen = null,
        Func<DateTimeOffset>? clock = null,
        Func<TimeSpan, CancellationToken, Task>? sleep = null,
        Action? onSampled = null)
    {
        _ackGate = ackGate;
        _counter = counter;
        _appSampler = appSampler;
        _livePolicy = livePolicy;
        _store = store;
        _isTracking = isTracking;
        _interval = interval ?? TimeSpan.FromSeconds(IntervalSeconds);
        _subBuckets = Math.Max(1, subBuckets);
        _idGen = idGen ?? (static now => UuidV7.Generate(now));
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _sleep = sleep ?? Task.Delay;
        _onSampled = onSampled ?? (static () => { });
    }

    public void Start()
    {
        lock (_gate)
        {
            if (_started || _disposed)
            {
                return;
            }

            _started = true;
        }

        ScheduleNext(TimeSpan.Zero); // the first measurement window begins immediately
    }

    public void Stop()
    {
        CancellationTokenSource cancelled;
        lock (_gate)
        {
            _started = false;
            _timer?.Dispose();
            _timer = null;

            // Cancel whatever is mid-measurement. A cycle spends the whole interval asleep between
            // sub-buckets, so without this a sign-out would sit behind up to a minute of sleeping,
            // and the sample it eventually produced would belong to nobody in particular.
            cancelled = _cycles;
            _cycles = new CancellationTokenSource();
        }

        cancelled.Cancel();
        cancelled.Dispose();
    }

    /// <summary>
    /// Await any cycle already in flight. Sign-out teardown MUST await this before clearing the
    /// buffer: a cycle suspended mid-measurement would otherwise resume afterwards and enqueue
    /// into the just-cleared buffer, where it would upload under the NEXT user's token.
    /// </summary>
    public Task FinishInFlightAsync()
    {
        lock (_gate)
        {
            return _currentCycle;
        }
    }

    /// <summary>
    /// One interval. Returns true only when this call ran the full measurement and enqueued a
    /// sample; false on every skip path (already capturing, clock stopped, gate closed, cancelled).
    /// The caller reads that to choose the next delay.
    /// </summary>
    public async Task<bool> CaptureTickAsync(CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            if (_isCapturing)
            {
                return false;
            }

            _isCapturing = true;
        }

        try
        {
            // Before the gate, deliberately: a stopped clock must not cost a policy fetch.
            if (!_isTracking())
            {
                return false;
            }

            return await _ackGate.WithCaptureAllowedAsync(MeasureAsync, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception e) when (e is AckGateException or Auth.NotAuthenticatedException
                                      or Auth.AuthException or OperationCanceledException)
        {
            // Gate closed, session unusable, or torn down mid-cycle. Skip the interval. Fail-safe.
            return false;
        }
        finally
        {
            lock (_gate)
            {
                _isCapturing = false;
            }
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
        _cycles.Dispose();
    }

    private async Task<bool> MeasureAsync(CancellationToken cancellationToken)
    {
        var meter = new ActivityRateMeter(_subBuckets);
        var previousKeys = _counter.KeyEvents;
        var previousPointer = _counter.PointerEvents;
        var bucketLength = _interval / _subBuckets;

        for (var i = 0; i < _subBuckets; i++)
        {
            // Cancellation throws out of here and is caught by CaptureTickAsync, so a torn-down
            // cycle never persists a partial window.
            await _sleep(bucketLength, cancellationToken).ConfigureAwait(false);

            var keys = _counter.KeyEvents;
            var pointer = _counter.PointerEvents;
            meter.AddBucket(keys - previousKeys, pointer - previousPointer);
            previousKeys = keys;
            previousPointer = pointer;
        }

        cancellationToken.ThrowIfCancellationRequested();

        var capturedAt = _clock();

        // The app read goes through the gate itself and publishes the policy it fetched, so the
        // categorization below runs on the SAME snapshot that authorized the read. Reading the
        // policy before this call would risk titling the window under one rule set and
        // categorizing it under another.
        var snapshot = await _appSampler.SampleAsync(cancellationToken).ConfigureAwait(false);
        var settings = _livePolicy.Current;

        // host is always null on Windows: there is no browser-URL read on this platform, so site
        // rules never fire and app rules apply. See Categorizer for the full consequence.
        var category = Categorizer.From(settings).Categorize(snapshot.AppName, snapshot.BundleId, host: null);

        _store.Enqueue(new ActivitySamplePayload
        {
            Id = _idGen(capturedAt),
            Timestamp = UuidV7.Iso(capturedAt),
            AppName = snapshot.AppName,
            BundleId = snapshot.BundleId,
            WindowTitle = snapshot.WindowTitle,
            ActivityPct = meter.ActivityPct(),
            Category = Categories.Token(category),
        });

        _onSampled();
        return true;
    }

    private async Task RunCycleAsync(CancellationToken cancellationToken)
    {
        var measured = await CaptureTickAsync(cancellationToken).ConfigureAwait(false);

        lock (_gate)
        {
            if (!_started)
            {
                return;
            }
        }

        // Measured → the interval has already elapsed inside the measurement, so start the next
        // window now and keep them contiguous. Skipped → wait a full interval.
        ScheduleNext(measured ? TimeSpan.Zero : _interval);
    }

    private void ScheduleNext(TimeSpan delay)
    {
        lock (_gate)
        {
            if (!_started)
            {
                return;
            }

            var token = _cycles.Token;
            _timer?.Dispose();
            _timer = new Timer(
                _ =>
                {
                    lock (_gate)
                    {
                        _currentCycle = RunCycleAsync(token);
                    }
                },
                null,
                delay < TimeSpan.Zero ? TimeSpan.Zero : delay,
                Timeout.InfiniteTimeSpan);
        }
    }
}
