namespace NiftyTimer.Storage;

/// <summary>What happens to unsent records when a user is about to start uploading them.</summary>
public enum UnsentDataAction
{
    /// <summary>The records are this user's (or there are none): keep them and drain them.</summary>
    Keep,

    /// <summary>The records belong to someone else, or cannot be shown to be this user's: delete them unsent.</summary>
    Discard,
}

/// <summary>
/// Who the unsent records on this machine belong to.
///
/// Unsent time entries, idle events, activity samples and screenshots outlive a sign-out — and a
/// session the server ended — so the person does not lose tracked work for want of a network at
/// the moment they left. But no uploaded record carries a user id: the server attributes every one
/// to the bearer token it arrives with. So records left by one account must never be drained under
/// another's token. This marker is what makes that decidable: it names the account whose session
/// last owned the buffers, and every account must <see cref="Claim"/> them before the sync engines
/// may start for it.
///
/// <b>Legacy buffers</b> — records written by a build that predates this marker — have no owner on
/// file. They are kept only when the session that was signed in when this build first launched
/// carried straight over from that older build (<c>sessionCarriedOver</c>): the older build cleared
/// the buffers on every sign-out before discarding the session, and drained them continuously under
/// that session's token, so whatever it left behind was recorded under that same account and would
/// have been uploaded under it on the next cycle anyway. A legacy buffer met at an interactive
/// sign-in has no such evidence — the older build also left buffers behind when the server rejected
/// a session at launch — so it is discarded. Unknown ownership is never resolved in favour of
/// uploading.
///
/// Not a capture path: it decides the fate of records already captured.
/// </summary>
public sealed class UnsentDataOwnership
{
    internal const string OwnerKey = "unsent.ownerUserId";

    private readonly IUserSettings _settings;

    public UnsentDataOwnership(IUserSettings settings) => _settings = settings;

    /// <summary>The account the buffers belong to, or null when none has been recorded.</summary>
    public string? Owner => _settings.GetString(OwnerKey);

    /// <summary>
    /// The rule, pure so every branch is testable. Nothing pending means nothing to decide.
    /// </summary>
    internal static UnsentDataAction Decide(string? owner, string userId, bool hasPending, bool sessionCarriedOver)
    {
        if (!hasPending)
        {
            return UnsentDataAction.Keep;
        }

        if (owner is not null)
        {
            return string.Equals(owner, userId, StringComparison.Ordinal)
                ? UnsentDataAction.Keep
                : UnsentDataAction.Discard;
        }

        return sessionCarriedOver ? UnsentDataAction.Keep : UnsentDataAction.Discard;
    }

    /// <summary>
    /// Make <paramref name="userId"/> the owner of the buffers, discarding through
    /// <paramref name="discard"/> anything that is not provably theirs FIRST. The caller must not
    /// start any upload before this returns.
    /// </summary>
    public UnsentDataAction Claim(string userId, int pending, bool sessionCarriedOver, Action discard)
    {
        var action = Decide(Owner, userId, pending > 0, sessionCarriedOver);
        if (action == UnsentDataAction.Discard)
        {
            discard();
        }

        _settings.SetString(OwnerKey, userId);
        return action;
    }
}
