using NiftyTimer.Storage;

namespace NiftyTimer.Auth;

public sealed class NotAuthenticatedException : Exception
{
    public NotAuthenticatedException()
        : base("No usable session.")
    {
    }
}

/// <summary>
/// What a launch-time bootstrap concluded.
///
/// The distinction that matters is <see cref="Offline"/> vs <see cref="Unauthenticated"/>: only a
/// server that actually REJECTED the refresh token (401) means the session is dead. Being
/// offline, or catching the API mid-deploy, or tripping the global throttler, says nothing about
/// the token — and used to sign the employee out anyway on macOS, wiping stored credentials on a
/// laptop that simply woke up before the network associated.
/// </summary>
public enum BootstrapOutcome
{
    /// <summary>Refresh succeeded; an access token is in memory.</summary>
    Authenticated,

    /// <summary>Refresh could not be completed, but the refresh token is retained and still good.</summary>
    Offline,

    /// <summary>No stored token, or the server rejected the one we had. Credentials are cleared.</summary>
    Unauthenticated,
}

/// <summary>
/// The single owner of the client's tokens. Refresh token → DPAPI on disk; access token → memory
/// only, re-minted via refresh on expiry.
///
/// Concurrent callers of <see cref="AccessTokenAsync"/> share ONE in-flight refresh rather than
/// racing — the Swift original gets this from being an <c>actor</c>; here a
/// <see cref="SemaphoreSlim"/> guards a cached refresh <see cref="Task"/>. This is not a
/// nicety: the server rotates refresh tokens single-use and treats a token presented outside a
/// 10-second grace window as reuse, revoking the entire token family. Two racing refreshes would
/// sign the machine out.
/// </summary>
public sealed class AuthSession : IDisposable
{
    /// <summary>
    /// The last signed-in user id, mirrored out of the access token's <c>sub</c>.
    ///
    /// The access token is memory-only, so after an offline launch there is nothing to decode a
    /// user id from — and the offline branch needs one to look up this user's local ack marker.
    /// Cleared by <see cref="Logout"/>, which is what stops one user's marker from granting
    /// readiness to whoever signs in next.
    /// </summary>
    private const string LastUserIdKey = "auth.lastUserId";

    private static readonly TimeSpan Skew = TimeSpan.FromSeconds(30);

    private readonly IAuthClient _client;
    private readonly ITokenStore _store;
    private readonly IUserSettings _settings;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private string? _access;
    private DateTimeOffset? _accessDeadline;
    private Task? _refreshInFlight;

    public AuthSession(
        IAuthClient client,
        ITokenStore store,
        IUserSettings settings,
        Func<DateTimeOffset>? clock = null)
    {
        _client = client;
        _store = store;
        _settings = settings;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public bool IsAuthenticated => _store.ReadRefreshToken() is not null;

    public string? UserId
    {
        get
        {
            if (JwtDecoder.TryReadClaims(_access) is { } claims)
            {
                return claims.Sub;
            }

            // Offline launch: no access token to decode, so fall back to the mirrored id.
            return _settings.GetString(LastUserIdKey);
        }
    }

    /// <summary>
    /// On launch: if a refresh token is stored, refresh once to mint an access token. Never
    /// throws to the caller.
    ///
    /// ONLY a 401 clears the stored token. Everything else — no network, a 5xx while the API is
    /// redeploying, a 429 from the global throttler — leaves the token untouched and reports
    /// <see cref="BootstrapOutcome.Offline"/>, because none of those are evidence the token is
    /// dead.
    /// </summary>
    public async Task<BootstrapOutcome> BootstrapAsync(CancellationToken cancellationToken = default)
    {
        if (_store.ReadRefreshToken() is null)
        {
            return BootstrapOutcome.Unauthenticated;
        }

        try
        {
            await RefreshAsync(cancellationToken).ConfigureAwait(false);
            return BootstrapOutcome.Authenticated;
        }
        catch (AuthException e) when (e.Failure == AuthFailure.RefreshRejected)
        {
            Logout();
            return BootstrapOutcome.Unauthenticated;
        }
        catch (Exception e) when (e is AuthException or NotAuthenticatedException or OperationCanceledException)
        {
            _access = null;
            _accessDeadline = null;
            return BootstrapOutcome.Offline;
        }
    }

    public async Task LoginAsync(string email, string password, CancellationToken cancellationToken = default)
    {
        var pair = await _client.LoginAsync(email, password, cancellationToken).ConfigureAwait(false);
        Apply(pair);
    }

    public void Logout()
    {
        _store.Clear();
        _access = null;
        _accessDeadline = null;
        _refreshInFlight = null;
        _settings.Remove(LastUserIdKey);
    }

    /// <summary>Returns a valid access token, refreshing when within <see cref="Skew"/> of the deadline.</summary>
    public async Task<string> AccessTokenAsync(CancellationToken cancellationToken = default)
    {
        if (_access is { } cached && _accessDeadline is { } deadline && deadline - _clock() > Skew)
        {
            return cached;
        }

        await RefreshAsync(cancellationToken).ConfigureAwait(false);
        return _access ?? throw new NotAuthenticatedException();
    }

    /// <summary>Forces a refresh regardless of deadline — used by every client on a 401.</summary>
    public async Task<string> ForceRefreshAsync(CancellationToken cancellationToken = default)
    {
        await RefreshAsync(cancellationToken).ConfigureAwait(false);
        return _access ?? throw new NotAuthenticatedException();
    }

    public void Dispose() => _gate.Dispose();

    /// <summary>
    /// Coalesced: concurrent callers await the SAME in-flight refresh instead of racing. The
    /// semaphore covers only the decision to join or start — the network call itself happens
    /// outside it, so joiners are not serialized behind each other.
    /// </summary>
    private async Task RefreshAsync(CancellationToken cancellationToken)
    {
        Task task;
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_refreshInFlight is { } existing)
            {
                task = existing;
            }
            else
            {
                var token = _store.ReadRefreshToken() ?? throw new NotAuthenticatedException();
                task = PerformRefreshAsync(token, cancellationToken);
                _refreshInFlight = task;
            }
        }
        finally
        {
            _gate.Release();
        }

        try
        {
            await task.ConfigureAwait(false);
        }
        finally
        {
            await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
            try
            {
                if (ReferenceEquals(_refreshInFlight, task))
                {
                    _refreshInFlight = null;
                }
            }
            finally
            {
                _gate.Release();
            }
        }
    }

    private async Task PerformRefreshAsync(string token, CancellationToken cancellationToken)
    {
        var pair = await _client.RefreshAsync(token, cancellationToken).ConfigureAwait(false);
        Apply(pair);
    }

    private void Apply(TokenPair pair)
    {
        _access = pair.AccessToken;
        _accessDeadline = _clock().AddSeconds(pair.ExpiresIn);
        _store.SaveRefreshToken(pair.RefreshToken);
        if (JwtDecoder.TryReadClaims(pair.AccessToken) is { } claims)
        {
            _settings.SetString(LastUserIdKey, claims.Sub);
        }
    }
}
