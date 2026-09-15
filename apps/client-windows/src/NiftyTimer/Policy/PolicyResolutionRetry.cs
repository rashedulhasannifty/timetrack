using NiftyTimer.Sync;

namespace NiftyTimer.Policy;

/// <summary>
/// What <see cref="PolicyResolutionRetry.RecordFailure"/> tells the caller to do next. Closed
/// hierarchy — no other cases exist.
/// </summary>
public abstract record PolicyRetryOutcome
{
    /// <summary>Idle detection is installed (or was torn down); the loop is over.</summary>
    public sealed record Stop : PolicyRetryOutcome;

    /// <summary>
    /// Try again after <paramref name="After"/>. <paramref name="WarnUser"/> is true on exactly ONE
    /// outcome per schedule — the point where silence has gone on long enough to be worth
    /// surfacing.
    /// </summary>
    public sealed record Retry(TimeSpan After, bool WarnUser) : PolicyRetryOutcome;
}

/// <summary>
/// The retry schedule for launch-time policy resolution. Ported from the macOS client's
/// <c>PolicyResolutionRetry</c>.
///
/// <see cref="App.AppDelegate"/> used to resolve the policy exactly once per launch. An app started
/// by the Run key at login starts while the network is still coming up, so the very first
/// <c>policy/effective</c> fetch is the one most likely to fail — and its catch granted MANUAL
/// tracking and stopped there. In auto mode that left a client that looked completely normal
/// (signed in, ready, indicator idle) and never started tracking for the rest of the session. This
/// type is the schedule that makes that state recoverable.
///
/// Pure and deterministic: no timers, no clock, no network. <see cref="App.AppDelegate"/> owns the
/// timer and asks this what to do next, exactly as <see cref="SyncEngine"/> does with
/// <see cref="BackoffPolicy"/> (which this reuses rather than growing a second backoff — and
/// inherits its jitter, so an office whose network came back at once does not re-fetch in
/// lockstep).
///
/// NOT a capture path — it decides when to re-ask for the policy, and touches no hardware API.
/// </summary>
public sealed class PolicyResolutionRetry
{
    private readonly BackoffPolicy _backoff;
    private readonly int _warnAfterFailures;
    private int _failures;
    private bool _hasWarned;

    public PolicyResolutionRetry(BackoffPolicy? backoff = null, int warnAfterFailures = 3)
    {
        _backoff = backoff ?? new BackoffPolicy(TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(300));
        _warnAfterFailures = warnAfterFailures;
    }

    public bool IsResolved { get; private set; }

    /// <summary>One failed resolution attempt. Returns what the caller should do next.</summary>
    public PolicyRetryOutcome RecordFailure()
    {
        if (IsResolved)
        {
            return new PolicyRetryOutcome.Stop();
        }

        _failures++;
        var warn = !_hasWarned && _failures >= _warnAfterFailures;
        if (warn)
        {
            _hasWarned = true;
        }

        return new PolicyRetryOutcome.Retry(_backoff.NextDelay(), warn);
    }

    /// <summary>Idle detection installed — stop retrying. Idempotent.</summary>
    public void MarkResolved() => IsResolved = true;

    /// <summary>
    /// Sign-out teardown. The next user on this machine gets their own schedule and their own
    /// single warning rather than inheriting an exhausted one-shot — the cross-user teardown class
    /// that has already bitten the away and recovery prompts.
    /// </summary>
    public void Reset()
    {
        IsResolved = false;
        _failures = 0;
        _hasWarned = false;
        _backoff.Reset();
    }
}
