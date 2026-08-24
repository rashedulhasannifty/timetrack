using NiftyTimer.Storage;

namespace NiftyTimer.Sync;

/// <summary>
/// PRD §7.5 — one-way (client → server) BATCH drain of the durable activity-sample buffer.
///
/// Mirrors <see cref="ScreenshotSyncEngine"/>, but posts ONE batch per cycle rather than looping
/// until the buffer is empty. That is deliberate and worth keeping: the whole batch is removed
/// after a success, and if a delete were to fail the samples would still be there on the next
/// pass. Looping within a cycle would re-take and re-send them immediately, in a tight loop, for
/// as long as the delete kept failing. Letting the timer schedule the next batch bounds that to
/// one pointless round trip per interval instead of a spin.
///
/// The batch is removed on success, dropped on a permanent 4xx (poison cannot wedge the queue),
/// or kept on transient/auth. The uploader is the shared <see cref="TimeEntryUploader"/> pointed
/// at <c>activity-samples/batch</c> — the JSON POST, the single 401 refresh-retry and the status
/// classification are identical, and duplicating them is how the two paths drift apart.
///
/// Not a capture path → not gated.
/// </summary>
public sealed class ActivityBatchSyncEngine : IDisposable
{
    /// <summary>Server bound: <c>samples: z.array(...).min(1).max(500)</c>.</summary>
    public const int MaxBatchSize = 500;

    private readonly IActivitySampleBuffer _store;
    private readonly IUploader _uploader;
    private readonly BackoffPolicy _backoff;
    private readonly TimeSpan _interval;
    private readonly int _batchLimit;
    private readonly TimeSpan _maxAge;
    private readonly int _maxCount;
    private readonly Lock _gate = new();
    private readonly SemaphoreSlim _drainGate = new(1, 1);

    private Timer? _timer;
    private bool _started;
    private bool _disposed;

    public ActivityBatchSyncEngine(
        IActivitySampleBuffer store,
        IUploader uploader,
        BackoffPolicy? backoff = null,
        TimeSpan? interval = null,
        int batchLimit = MaxBatchSize,
        TimeSpan? maxAge = null,
        int maxCount = 5000)
    {
        _store = store;
        _uploader = uploader;
        _backoff = backoff ?? new BackoffPolicy();
        _interval = interval ?? TimeSpan.FromSeconds(90);
        _batchLimit = Math.Clamp(batchLimit, 1, MaxBatchSize);
        _maxAge = maxAge ?? TimeSpan.FromDays(7);
        _maxCount = maxCount;
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

        ScheduleNext(TimeSpan.Zero);
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

    /// <summary>One batch, skipped if another drain is already running.</summary>
    public async Task<bool> SyncNowAsync(CancellationToken cancellationToken = default)
    {
        if (!await _drainGate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            return false;
        }

        try
        {
            return await DrainAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _drainGate.Release();
        }
    }

    /// <summary>One batch, WAITING for any in-flight drain. This is what sign-out must call.</summary>
    public async Task<bool> FlushAsync(CancellationToken cancellationToken = default)
    {
        await _drainGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await DrainAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _drainGate.Release();
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
        _drainGate.Dispose();
    }

    private async Task<bool> DrainAsync(CancellationToken cancellationToken)
    {
        _store.Prune(_maxAge, _maxCount);

        var batch = _store.Take(_batchLimit);
        if (batch.Count == 0)
        {
            // The server rejects an empty `samples` array (min 1), so there is nothing to send and
            // nothing to report.
            return false;
        }

        cancellationToken.ThrowIfCancellationRequested();

        var payload = new ActivityBatchPayload { Samples = batch }.ToJsonUtf8();
        var ids = new List<string>(batch.Count);
        foreach (var sample in batch)
        {
            ids.Add(sample.Id);
        }

        switch (await _uploader.UploadAsync(payload, cancellationToken).ConfigureAwait(false))
        {
            case UploadResult.Success:
                _store.Remove(ids);
                _backoff.Reset();
                return false;
            case UploadResult.Permanent:
                _store.Remove(ids);
                return false;
            default:
                return true; // transient / auth — keep the batch, caller backs off
        }
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
                static state => ((ActivityBatchSyncEngine)state!).RunCycleAsync(),
                this,
                delay < TimeSpan.Zero ? TimeSpan.Zero : delay,
                Timeout.InfiniteTimeSpan);
        }
    }
}
