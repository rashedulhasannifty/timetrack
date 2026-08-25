using NiftyTimer.Storage;

namespace NiftyTimer.Policy;

/// <summary>
/// A local record that a user acknowledged the monitoring policy, so an OFFLINE relaunch can
/// re-enable MANUAL tracking without a live policy fetch (PRD §7.5 offline tolerance).
///
/// Scope guard: this gates manual time tracking only. It NEVER opens a capture path —
/// screenshots/activity/idle stay behind <see cref="AckGate"/> (CLAUDE.md §1). The structural
/// guarantee is not in this file: capture subsystems are installed only on the online
/// <c>!ackRequired</c> branch, so there is no code path from an offline launch to a capture API
/// at all. Cleared on logout, so one user's marker cannot grant readiness to the next.
/// </summary>
public sealed class AckMarker
{
    private readonly IUserSettings _settings;

    public AckMarker(IUserSettings settings) => _settings = settings;

    public void Record(string userId, string policyVersion) =>
        _settings.SetString(Key(userId), policyVersion);

    public bool HasAcknowledged(string userId) => _settings.GetString(Key(userId)) is not null;

    public void Clear(string userId) => _settings.Remove(Key(userId));

    private static string Key(string userId) => $"ackedPolicyVersion:{userId}";
}
