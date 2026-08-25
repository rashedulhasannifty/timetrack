using NiftyTimer.Policy;
using NiftyTimer.Storage;
using NiftyTimer.Tracking;

namespace NiftyTimer.Capture;

/// <summary>
/// PRD §6.2 — the screenshot capture trigger.
///
/// A single self-gating interval timer. Each tick, only while the clock is running and only
/// through <see cref="AckGate"/>, it grabs EVERY attached display, writes each frame to the
/// durable image buffer under one shared capture-group id, and lets the sync engine drain them.
///
/// Capture is tied to time tracking: there are no screenshots on a stopped clock. <c>isTracking</c>
/// is checked BEFORE the gate so a stopped clock never triggers a policy fetch.
///
/// The interval and whether screenshots run at all are an install-time snapshot — the caller
/// constructs this only when <c>screenshotsEnabled</c> — but acknowledgement is re-checked by the
/// gate on EVERY tick, so revoking it stops capture mid-session rather than at the next launch.
///
/// **No permission preflight, unlike the macOS counterpart.** That client checks
/// <c>CGPreflightScreenCaptureAccess</c> before every grab because entering ScreenCaptureKit
/// without the TCC grant re-triggers the OS permission dialog on each interval. Windows has no
/// equivalent gate on screen capture, so there is no permission to check, nothing to warn about,
/// and no self-healing path to build. Porting it as a <c>() =&gt; true</c> stub would leave dead
/// plumbing and a warning state that can never be entered.
/// </summary>
public sealed class ScreenshotScheduler : IDisposable
{
    private readonly AckGate _ackGate;
    private readonly IDisplayGrabber _grabber;
    private readonly IImageBuffer _buffer;
    private readonly TimeSpan _interval;
    private readonly Func<bool> _isTracking;
    private readonly Func<DateTimeOffset, string> _idGen;
    private readonly Func<DateTimeOffset, string> _groupIdGen;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Action _onCaptured;
    private readonly Lock _gate = new();

    private CancellationTokenSource _cycles = new();
    private Timer? _timer;
    private Task _currentCycle = Task.CompletedTask;
    private bool _started;
    private bool _isCapturing;
    private bool _disposed;

    public ScreenshotScheduler(
        AckGate ackGate,
        IDisplayGrabber grabber,
        IImageBuffer buffer,
        int intervalMinutes,
        Func<bool> isTracking,
        Func<DateTimeOffset, string>? idGen = null,
        Func<DateTimeOffset, string>? groupIdGen = null,
        Func<DateTimeOffset>? clock = null,
        Action? onCaptured = null)
    {
        _ackGate = ackGate;
        _grabber = grabber;
        _buffer = buffer;
        _interval = TimeSpan.FromMinutes(Math.Max(1, intervalMinutes));
        _isTracking = isTracking;
        _idGen = idGen ?? (static now => UuidV7.Generate(now));
        _groupIdGen = groupIdGen ?? (static now => UuidV7.Generate(now));
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _onCaptured = onCaptured ?? (static () => { });
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

        ScheduleNext(_interval);
    }

    public void Stop()
    {
        CancellationTokenSource cancelled;
        lock (_gate)
        {
            _started = false;
            _timer?.Dispose();
            _timer = null;
            cancelled = _cycles;
            _cycles = new CancellationTokenSource();
        }

        cancelled.Cancel();
        cancelled.Dispose();
    }

    /// <summary>
    /// Await any capture cycle already in flight. Sign-out teardown MUST await this before
    /// clearing the image buffer: a grab suspended mid-cycle would otherwise resume afterwards and
    /// enqueue into the just-cleared buffer, uploading one user's screen under the next user's
    /// token.
    /// </summary>
    public Task FinishInFlightAsync()
    {
        lock (_gate)
        {
            return _currentCycle;
        }
    }

    /// <summary>
    /// One capture attempt. Returns true when frames were captured and buffered.
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
            if (!_isTracking())
            {
                return false;
            }

            return await _ackGate.WithCaptureAllowedAsync(GrabAsync, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception e) when (e is AckGateException or Auth.NotAuthenticatedException
                                      or Auth.AuthException or DisplayGrabException
                                      or OperationCanceledException)
        {
            // Gate closed, session unusable, nothing grabbable, or torn down mid-tick. Skip the
            // tick; the timer keeps running so capture resumes on its own.
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

    private async Task<bool> GrabAsync(CancellationToken cancellationToken)
    {
        var capturedAt = _clock();

        // The fan-out across displays happens INSIDE the gate, and every frame shares one capture
        // time and one group id — so the dashboard reads a two-monitor desk as a single moment
        // rather than as unrelated screenshots taken seconds apart.
        var result = await _grabber.GrabAllAsync(cancellationToken).ConfigureAwait(false);
        if (result.Captures.Count == 0)
        {
            return false;
        }

        var groupId = _groupIdGen(capturedAt);
        foreach (var capture in result.Captures)
        {
            _buffer.Enqueue(
                _idGen(capturedAt),
                capturedAt,
                capture.Jpeg,
                new CaptureGroup(groupId, capture.Index, result.Attempted));
        }

        _onCaptured();
        return true;
    }

    private async Task RunCycleAsync(CancellationToken cancellationToken)
    {
        await CaptureTickAsync(cancellationToken).ConfigureAwait(false);

        lock (_gate)
        {
            if (!_started)
            {
                return;
            }
        }

        // Always the full interval, measured or skipped. Unlike the activity sampler, a tick here
        // costs a fraction of a second rather than consuming the interval, so there is nothing to
        // make contiguous.
        ScheduleNext(_interval);
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
