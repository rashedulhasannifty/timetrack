namespace NiftyTimer.Policy;

public enum AckGateFailure
{
    /// <summary>The signed-in user has not acknowledged the monitoring policy.</summary>
    NotAcknowledged,

    /// <summary>The policy could not be fetched. The gate stays closed.</summary>
    PolicyUnavailable,
}

public sealed class AckGateException : Exception
{
    public AckGateException(AckGateFailure failure)
        : base(failure == AckGateFailure.NotAcknowledged
            ? "Monitoring policy has not been acknowledged."
            : "Effective policy is unavailable.")
    {
        Failure = failure;
    }

    public AckGateFailure Failure { get; }
}

public interface IPolicyProvider
{
    Task<EffectivePolicy> EffectivePolicyAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// PRD §4.1 — monitoring MUST NOT run until the signed-in user has acknowledged the monitoring
/// policy. This is a structural gate, not a runtime <c>if</c> scattered across call sites: every
/// capture path is passed INTO <see cref="WithCaptureAllowedAsync"/> as a delegate, so there is
/// no way to reach a capture API without going through here.
///
/// There is no admin override. There is no debug flag. Do not add one.
///
/// Fail-safe: any failure — offline, a 401 that survived refresh, malformed JSON — throws, and
/// the gate stays CLOSED.
/// </summary>
public sealed class AckGate
{
    private readonly IPolicyProvider _policyProvider;
    private readonly Action<EffectivePolicy> _onPolicy;

    /// <param name="policyProvider">Source of the effective policy; fetched on every call.</param>
    /// <param name="onPolicy">
    /// Receives each policy the gate fetches, once it has decided capture is allowed. This is how
    /// admin-editable settings reach a RUNNING client (see <see cref="LivePolicy"/>) — the gate
    /// already pays for this fetch every capture cycle, so nothing here adds a request. It
    /// deliberately does not fire on a closed gate: no capture, nothing to configure.
    /// </param>
    public AckGate(IPolicyProvider policyProvider, Action<EffectivePolicy>? onPolicy = null)
    {
        _policyProvider = policyProvider;
        _onPolicy = onPolicy ?? (static _ => { });
    }

    /// <summary>
    /// The ONLY entry point to any capture API. Screenshot, activity sampling and idle detection
    /// all route through here.
    /// </summary>
    public async Task<T> WithCaptureAllowedAsync<T>(
        Func<CancellationToken, Task<T>> body,
        CancellationToken cancellationToken = default)
    {
        var policy = await _policyProvider.EffectivePolicyAsync(cancellationToken).ConfigureAwait(false);
        if (policy.AckRequired)
        {
            throw new AckGateException(AckGateFailure.NotAcknowledged);
        }

        // Publish BEFORE the body so this very cycle already runs on the latest settings.
        _onPolicy(policy);
        return await body(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Void-returning overload, for capture paths whose work has no result.</summary>
    public Task WithCaptureAllowedAsync(
        Func<CancellationToken, Task> body,
        CancellationToken cancellationToken = default) =>
        WithCaptureAllowedAsync<bool>(
            async ct =>
            {
                await body(ct).ConfigureAwait(false);
                return true;
            },
            cancellationToken);
}
