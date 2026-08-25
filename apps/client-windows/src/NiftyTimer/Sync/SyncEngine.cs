using NiftyTimer.Storage;

namespace NiftyTimer.Sync;

/// <summary>
/// PRD §7.5 — one-way (client→server) sync. <see cref="SyncNowAsync"/> drains the durable buffer
/// through the uploaders: timeEntry records to <c>uploader</c>, then idleEvent records to
/// <c>idleUploader</c>; each is removed on confirmed success (2xx). Idempotent on the UUIDv7, so a
/// retried record is a no-op. A transient/auth failure stops the cycle (time-entry failures skip
/// the idle pass) and the caller backs off; a permanent 4xx record is dropped so a poison record
/// can't wedge the queue. Stale records still age-prune each cycle.
///
/// Not a capture path → not gated by <see cref="Policy.AckGate"/>. The timer glue is
/// build-verified; <see cref="SyncNowAsync"/> is unit-tested.
/// </summary>
public sealed class SyncEngine : IDisposable
{
    private readonly BufferStore _buffer;
    private readonly IUploader _uploader;
    private readonly IUploader _idleUploader;
    private readonly BackoffPolicy _backoff;
    private readonly TimeSpan _interval;
    private readonly int _batchLimit;
    private readonly TimeSpan _maxAge;
    private readonly Lock _gate = new();

    private readonly SemaphoreSlim _drainGate = new(1, 1);

    private Timer? _timer;
    private bool _started;

    public SyncEngine(
        BufferStore buffer,
        IUploader uploader,
        IUploader idleUploader,
        BackoffPolicy? backoff = null,
        TimeSpan? interval = null,
        int batchLimit = 50,
        TimeSpan? maxAge = null)
    {
        _buffer = buffer;
        _uploader = uploader;
        _idleUploader = idleUploader;
        _backoff = backoff ?? new BackoffPolicy();
        _interval = interval ?? TimeSpan.FromSeconds(90);
        _batchLimit = batchLimit;
        _maxAge = maxAge ?? TimeSpan.FromDays(7);
    }

    public void Start()
    {
        lock (_gate)
        {
            if (_started)
            {
                return;
            }

            _started = true;
        }

        ScheduleNext(TimeSpan.Zero); // kick immediately
    }

    public void Stop()
    {
        lock (_gate)
        {
            _started = false;
            _timer?.Dispose();
            _timer = null;
        }
    }

    /// <summary>
    /// One drain pass, skipped if another is already running. Returns true if it stopped early on
    /// a transient/auth failure (the scheduler then waits a backoff delay). This is the timer's
    /// entry point — a cycle that arrives while the previous one is still going should be dropped,
    /// not queued behind it.
    /// </summary>
    public async Task<bool> SyncNowAsync(CancellationToken cancellationToken = default)
    {
        if (!await _drainGate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            return false;
        }

        try
        {
            return await DrainCycleAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _drainGate.Release();
        }
    }

    /// <summary>
    /// One drain pass that WAITS for any in-flight cycle instead of skipping.
    ///
    /// This is what sign-out must call. <see cref="SyncNowAsync"/> returns immediately when a
    /// cycle is already running, so using it as the "best-effort final drain" means the drain
    /// silently does not happen — and the caller then clears the buffer anyway, discarding up to a
    /// full batch of real, unsent tracked time. The window is small (one cycle in ninety seconds)
    /// and entirely avoidable.
    /// </summary>
    public async Task<bool> FlushAsync(CancellationToken cancellationToken = default)
    {
        await _drainGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await DrainCycleAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _drainGate.Release();
        }
    }

    public void Dispose()
    {
        Stop();
        _drainGate.Dispose();
    }

    private async Task<bool> DrainCycleAsync(CancellationToken cancellationToken)
    {
        _buffer.Prune(_maxAge);

        // Time entries first; a transient/auth failure there stops the whole cycle (the session is
        // likely unusable, so the idle pass would fail too) and the caller backs off.
        if (await DrainAsync(BufferKind.TimeEntry, _uploader, cancellationToken).ConfigureAwait(false))
        {
            return true;
        }

        return await DrainAsync(BufferKind.IdleEvent, _idleUploader, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// One drain pass for a single buffer kind. Returns true if it stopped early on a
    /// transient/auth failure. Each record is removed on confirmed success (2xx) or dropped on a
    /// permanent 4xx (a poison record can't wedge the queue). Idempotent on the UUIDv7.
    /// </summary>
    private async Task<bool> DrainAsync(BufferKind kind, IUploader uploader, CancellationToken cancellationToken)
    {
        foreach (var record in _buffer.Take(kind, _batchLimit))
        {
            cancellationToken.ThrowIfCancellationRequested();
            switch (await uploader.UploadAsync(record.Payload, cancellationToken).ConfigureAwait(false))
            {
                case UploadResult.Success:
                    _buffer.Remove(record.Id);
                    _backoff.Reset();
                    break;
                case UploadResult.Permanent:
                    _buffer.Remove(record.Id); // drop the poison record so it can't wedge the queue
                    break;
                default:
                    return true; // transient / auth failure — stop this cycle; caller backs off
            }
        }

        return false;
    }

    private async void RunCycleAsync()
    {
        bool backedOff;
        try
        {
            backedOff = await SyncNowAsync().ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        lock (_gate)
        {
            if (!_started)
            {
                return;
            }
        }

        ScheduleNext(backedOff ? _backoff.NextDelay() : _interval);
    }

    private void ScheduleNext(TimeSpan delay)
    {
        lock (_gate)
        {
            if (!_started)
            {
                return;
            }

            _timer?.Dispose();
            _timer = new Timer(
                static state => ((SyncEngine)state!).RunCycleAsync(),
                this,
                delay < TimeSpan.Zero ? TimeSpan.Zero : delay,
                Timeout.InfiniteTimeSpan);
        }
    }
}
