namespace NiftyTimer.Capture;

/// <summary>Why a grab produced nothing at all.</summary>
public enum DisplayGrabFailure
{
    /// <summary>No display was enumerable — a headless session, or an RDP disconnect.</summary>
    NoDisplay,

    /// <summary>Every display failed to copy.</summary>
    CaptureFailed,

    /// <summary>Frames were copied but none could be encoded to JPEG.</summary>
    EncodeFailed,
}

/// <summary>
/// Thrown only when NOTHING could be captured. A partial result is a success — see
/// <see cref="DisplayGrabResult.Attempted"/>.
/// </summary>
public sealed class DisplayGrabException : Exception
{
    public DisplayGrabException(DisplayGrabFailure failure)
        : base(failure switch
        {
            DisplayGrabFailure.NoDisplay => "No display is available to capture.",
            DisplayGrabFailure.EncodeFailed => "Captured frames could not be encoded.",
            _ => "The display could not be captured.",
        }) =>
        Failure = failure;

    public DisplayGrabFailure Failure { get; }
}

/// <summary>
/// One display's frame from a single capture tick.
/// </summary>
/// <param name="Index">
/// Stable position within the tick: 0 is the primary display, the rest follow in a deterministic
/// order. Derived from a sort, NOT from the OS enumeration order — that is not guaranteed stable
/// between calls, and an unstable index would make the same physical monitor swap places in the
/// dashboard grid from one capture to the next.
/// </param>
public sealed record DisplayCapture(int Index, byte[] Jpeg);

/// <summary>
/// The outcome of fanning one tick out across every attached display.
/// </summary>
/// <param name="Attempted">
/// How many displays were attached and attempted. This can exceed <see cref="Captures"/> count:
/// one flaky external monitor — asleep, or mid-reconnect — fails on its own without taking the
/// rest of the desk down with it, and the shortfall is precisely what tells the dashboard the
/// group is incomplete. Partial success is success.
/// </param>
public sealed record DisplayGrabResult(IReadOnlyList<DisplayCapture> Captures, int Attempted);

/// <summary>
/// The single seam over actual screen capture. Everything around it — schedule, buffer, upload,
/// sync — is faked in tests; only the concrete implementation needs a real display and cannot run
/// in CI, which matches how the macOS client treats <c>ScreenCaptureKitGrabber</c>.
/// </summary>
public interface IDisplayGrabber
{
    /// <summary>
    /// Grab every attached display. Throws <see cref="DisplayGrabException"/> only when nothing at
    /// all could be captured.
    /// </summary>
    Task<DisplayGrabResult> GrabAllAsync(CancellationToken cancellationToken = default);
}
