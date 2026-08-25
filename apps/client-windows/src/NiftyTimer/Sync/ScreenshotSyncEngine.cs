using NiftyTimer.Storage;

namespace NiftyTimer.Sync;

/// <summary>
/// PRD §7.4 / §7.5 — one-way (client → server) drain of the durable image buffer.
///
/// Mirrors <see cref="SyncEngine"/> but carries a single binary kind through its own multipart
/// uploader. Each image is removed on confirmed success, dropped on a permanent 4xx so a poison
/// record cannot wedge the queue, or kept on a transient/auth failure — in which case the cycle
/// stops early and the caller backs off. Stale images age- and count-prune each cycle.
///
/// **The local file is deleted only after a confirmed upload** (PRD §6.2). Removing it optimistically
/// on send would lose the capture whenever the response is the thing that goes missing.
///
/// Not a capture path, so it is not gated and runs on both the online and the offline-marker
/// branches — draining what was already captured is not capturing.
/// </summary>
public sealed class ScreenshotSyncEngine : IDisposable
{
    private readonly IImageBuffer _buffer;
    private readonly IScreenshotUploading _uploader;
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

    public ScreenshotSyncEngine(
        IImageBuffer buffer,
        IScreenshotUploading uploader,
        BackoffPolicy? backoff = null,
        TimeSpan? interval = null,
        int batchLimit = 20,
        TimeSpan? maxAge = null,
        int maxCount = 500)
    {
        _buffer = buffer;
        _uploader = uploader;
        _backoff = backoff ?? new BackoffPolicy();
        _interval = interval ?? TimeSpan.FromSeconds(90);
        _batchLimit = batchLimit;
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

    /// <summary>One drain pass, skipped if another is already running.</summary>
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

    /// <summary>
    /// One drain pass that WAITS for any in-flight cycle rather than skipping. Sign-out must call
    /// this: <see cref="SyncNowAsync"/> returns immediately when a cycle is running, so using it
    /// as the final drain means the drain silently does not happen and the buffer is then cleared
    /// anyway — discarding captures that were never sent.
    /// </summary>
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
        _buffer.Prune(_maxAge, _maxCount);

        foreach (var record in _buffer.Take(_batchLimit))
        {
            cancellationToken.ThrowIfCancellationRequested();

            byte[] jpeg;
            try
            {
                jpeg = File.ReadAllBytes(record.Path);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // An image we cannot read can never be uploaded, and retrying it forever would
                // block every capture behind it. Drop it.
                _buffer.Remove(record.Id);
                continue;
            }

            var result = await _uploader
                .UploadAsync(record.Id, record.CapturedAt, record.Group, jpeg, cancellationToken)
                .ConfigureAwait(false);

            switch (result)
            {
                case UploadResult.Success:
                    _buffer.Remove(record.Id);
                    _backoff.Reset();
                    break;
                case UploadResult.Permanent:
                    _buffer.Remove(record.Id); // poison record — drop it rather than wedge the queue
                    break;
                default:
                    return true; // transient / auth — stop this cycle, caller backs off
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
                static state => ((ScreenshotSyncEngine)state!).RunCycleAsync(),
                this,
                delay < TimeSpan.Zero ? TimeSpan.Zero : delay,
                Timeout.InfiniteTimeSpan);
        }
    }
}
