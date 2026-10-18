namespace NiftyTimer.Sync;

/// <summary>
/// The sign-out drain: flush one engine repeatedly until its buffer is empty, a cycle fails, or a
/// cycle makes no progress.
///
/// One flush is one engine cycle — at most 50 time entries, 20 screenshots or 500 activity
/// samples — so a single flush left everything past the first batch behind. Whatever this cannot
/// deliver now stays on disk for the same account (see <c>UnsentDataOwnership</c>); it is never
/// deleted here.
///
/// Bounded three ways so a sign-out cannot hang: a cycle that reports a transient or auth failure
/// ends the loop (the session is probably unusable), a cycle that leaves the count where it was
/// ends it (retrying immediately would only repeat itself), and <see cref="MaxCycles"/> caps the
/// whole thing.
/// </summary>
public static class FinalDrain
{
    public const int MaxCycles = 100;

    /// <summary>Returns how many records are still pending afterwards.</summary>
    public static async Task<int> RunAsync(
        Func<CancellationToken, Task<bool>> flush,
        Func<int> pending,
        CancellationToken cancellationToken = default,
        int maxCycles = MaxCycles)
    {
        for (var cycle = 0; cycle < maxCycles; cycle++)
        {
            var before = pending();
            if (before == 0)
            {
                return 0;
            }

            if (await flush(cancellationToken).ConfigureAwait(false))
            {
                break; // transient / auth failure: keep the rest for later
            }

            if (pending() >= before)
            {
                break; // no progress: another pass now would do the same
            }
        }

        return pending();
    }
}
