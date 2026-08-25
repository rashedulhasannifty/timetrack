namespace NiftyTimer.Update;

/// <summary>One published build, as the client needs to see it.</summary>
/// <param name="Sha256">
/// Lowercase hex digest of the zip, published beside it as a sidecar asset. Without it the
/// installer refuses to proceed — for the unsigned pilot this is the only thing standing between
/// the running app and an arbitrary download.
/// </param>
public sealed record ReleaseManifest(
    AppVersion Version,
    DateTimeOffset PublishedAt,
    Uri ZipUrl,
    string Sha256);

/// <summary>
/// What the tray should say about the installed build.
///
/// **There is deliberately no state that stops tracking.** An out-of-date client keeps recording
/// time: somebody who has not clicked "update" has not done anything wrong, and losing their day's
/// records over it would be far worse than running an old build. The strongest thing the update
/// path may ever do is show a warning.
/// </summary>
public abstract record UpdateStatus
{
    private UpdateStatus()
    {
    }

    /// <summary>
    /// Nothing newer published, or we could not tell — no network, rate limited, or a running
    /// version that would not parse. Indistinguishable to the user, and intentionally so: a failed
    /// check is not something to nag about.
    /// </summary>
    public sealed record UnknownOrCurrent : UpdateStatus;

    /// <summary>Newer build published recently. A quiet menu item.</summary>
    public sealed record Available(ReleaseManifest Manifest) : UpdateStatus;

    /// <summary>Newer build, and the grace period has elapsed. Prominent, with a tray marker.</summary>
    public sealed record Overdue(ReleaseManifest Manifest) : UpdateStatus;

    /// <summary>
    /// The manifest, when there is one. Named apart from the derived records own
    /// <c>Manifest</c> members on purpose: a base property of the same name would collide with
    /// their positional parameters rather than being satisfied by them.
    /// </summary>
    public ReleaseManifest? ManifestOrNull => this switch
    {
        Available a => a.Manifest,
        Overdue o => o.Manifest,
        _ => null,
    };

    public bool IsOverdue => this is Overdue;
}

/// <summary>
/// Pure decision logic, kept apart from the network and the clock so it can be tested directly.
/// </summary>
public sealed class UpdateEvaluator
{
    private readonly int _graceDays;

    public UpdateEvaluator(int graceDays = 7) => _graceDays = graceDays;

    public UpdateStatus Evaluate(AppVersion? current, ReleaseManifest? latest, DateTimeOffset now)
    {
        // No manifest: the check failed or has not run. Say nothing.
        if (latest is null)
        {
            return new UpdateStatus.UnknownOrCurrent();
        }

        // An unreadable running version must NOT be treated as "older than everything" — that
        // would nag every developer running a local build, forever.
        if (current is null || current >= latest.Version)
        {
            return new UpdateStatus.UnknownOrCurrent();
        }

        // A release dated in the future — clock skew, or a backdated tag — gives a negative
        // elapsed and falls through to Available rather than escalating instantly.
        var elapsed = now - latest.PublishedAt;
        return elapsed > TimeSpan.FromDays(_graceDays)
            ? new UpdateStatus.Overdue(latest)
            : new UpdateStatus.Available(latest);
    }
}
