namespace NiftyTimer.Sync;

/// <summary>
/// The outcome of one upload attempt. <c>Success</c> = the server upserted (idempotent on
/// UUIDv7). <c>Permanent</c> = a non-401 4xx the record can never satisfy → drop it (don't wedge
/// the queue). <c>Transient</c> = network error / 5xx → retry later with backoff.
/// <c>AuthFailed</c> = a 401 that survived one refresh-retry → stop; the session is likely
/// invalid.
/// </summary>
public abstract record UploadResult
{
    private UploadResult()
    {
    }

    public sealed record Success : UploadResult;

    /// <summary>
    /// A 4xx the record can never satisfy. <c>Status</c> is carried because 409 in particular
    /// means something specific to the caller: another machine holds the one-running-entry
    /// index. <see cref="LiveEntryPublisher"/> reads it.
    /// </summary>
    public sealed record Permanent(int Status) : UploadResult;

    public sealed record Transient : UploadResult;

    public sealed record AuthFailed : UploadResult;
}

/// <summary>The uploader seam. Tests substitute a fake.</summary>
public interface IUploader
{
    Task<UploadResult> UploadAsync(byte[] payload, CancellationToken cancellationToken = default);
}
