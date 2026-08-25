using NiftyTimer.Auth;
using NiftyTimer.Storage;
using NiftyTimer.Tests.Support;
using Xunit;

namespace NiftyTimer.Tests;

public class JwtDecoderTests
{
    [Fact]
    public void ReadsTheClaimsTheClientNeeds()
    {
        var claims = JwtDecoder.ReadClaims(Jwt.ForSubject("user-9", "MANAGER", "team-3"));

        Assert.Equal("user-9", claims.Sub);
        Assert.Equal("MANAGER", claims.Role);
        Assert.Equal("team-3", claims.TeamId);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-jwt")]
    [InlineData("only.two")]
    [InlineData("a.b.c.d")]
    public void RejectsAnythingThatIsNotThreeSegments(string token) =>
        Assert.Throws<JwtMalformedException>(() => JwtDecoder.ReadClaims(token));

    [Fact]
    public void RejectsAPayloadThatIsNotJson() =>
        Assert.Throws<JwtMalformedException>(() => JwtDecoder.ReadClaims("aGVhZGVy.bm90LWpzb24.sig"));

    [Fact]
    public void TryReadReturnsNullRatherThanThrowing()
    {
        Assert.Null(JwtDecoder.TryReadClaims("garbage"));
        Assert.Null(JwtDecoder.TryReadClaims(null));
        Assert.NotNull(JwtDecoder.TryReadClaims(Jwt.ForSubject("u")));
    }
}

public class AuthSessionTests
{
    private static AuthSession NewSession(
        FakeAuthClient client,
        ITokenStore store,
        IUserSettings? settings = null,
        Func<DateTimeOffset>? clock = null) =>
        new(client, store, settings ?? new InMemoryUserSettings(), clock);

    [Fact]
    public async Task BootstrapWithNoStoredTokenIsUnauthenticated()
    {
        var session = NewSession(new FakeAuthClient(), new InMemoryTokenStore());

        Assert.Equal(BootstrapOutcome.Unauthenticated, await session.BootstrapAsync());
    }

    [Fact]
    public async Task BootstrapRefreshesWhenATokenIsStored()
    {
        var client = new FakeAuthClient();
        var session = NewSession(client, new InMemoryTokenStore("stored"));

        Assert.Equal(BootstrapOutcome.Authenticated, await session.BootstrapAsync());
        Assert.Equal(1, client.RefreshCalls);
    }

    /// <summary>
    /// ONLY a 401 means the stored token is dead. This is the bug that signed macOS users out for
    /// good when a laptop woke before its Wi-Fi associated.
    /// </summary>
    [Fact]
    public async Task ARejectedRefreshClearsTheStoredToken()
    {
        var store = new InMemoryTokenStore("stored");
        var client = new FakeAuthClient { RefreshFailure = AuthFailure.RefreshRejected };
        var session = NewSession(client, store);

        Assert.Equal(BootstrapOutcome.Unauthenticated, await session.BootstrapAsync());
        Assert.Null(store.ReadRefreshToken());
    }

    [Theory]
    [InlineData(AuthFailure.Transport)]
    [InlineData(AuthFailure.Server)]
    public async Task ANetworkOrServerFailureKeepsTheTokenAndReportsOffline(AuthFailure failure)
    {
        var store = new InMemoryTokenStore("stored");
        var client = new FakeAuthClient { RefreshFailure = failure };
        var session = NewSession(client, store);

        Assert.Equal(BootstrapOutcome.Offline, await session.BootstrapAsync());
        Assert.Equal("stored", store.ReadRefreshToken());
    }

    [Fact]
    public async Task AValidAccessTokenIsReusedWithoutRefreshing()
    {
        var client = new FakeAuthClient();
        var session = NewSession(client, new InMemoryTokenStore("stored"));

        await session.BootstrapAsync();
        await session.AccessTokenAsync();
        await session.AccessTokenAsync();

        Assert.Equal(1, client.RefreshCalls);
    }

    /// <summary>
    /// Refresh happens 30s before the deadline, not at it — a request that starts just inside the
    /// window would otherwise arrive with an expired token.
    /// </summary>
    [Fact]
    public async Task RefreshesBeforeTheTokenActuallyExpires()
    {
        var now = new DateTimeOffset(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);
        var client = new FakeAuthClient { Next = new TokenPair(Jwt.ForSubject("u"), "r", 60) };
        var session = NewSession(client, new InMemoryTokenStore("stored"), clock: () => now);

        await session.BootstrapAsync();
        Assert.Equal(1, client.RefreshCalls);

        now = now.AddSeconds(35); // 25s of life left — inside the 30s skew
        await session.AccessTokenAsync();

        Assert.Equal(2, client.RefreshCalls);
    }

    /// <summary>
    /// The server rotates refresh tokens single-use and treats one presented outside a 10-second
    /// grace as REUSE, revoking the whole token family. Two racing refreshes would therefore sign
    /// the machine out — so concurrent callers must share one in-flight refresh.
    /// </summary>
    [Fact]
    public async Task ConcurrentCallersShareASingleRefresh()
    {
        var client = new FakeAuthClient(TimeSpan.FromMilliseconds(50));
        var session = NewSession(client, new InMemoryTokenStore("stored"));

        var callers = Enumerable.Range(0, 20).Select(_ => session.AccessTokenAsync()).ToArray();
        var tokens = await Task.WhenAll(callers);

        Assert.Equal(1, client.RefreshCalls);
        Assert.All(tokens, t => Assert.Equal(tokens[0], t));
    }

    [Fact]
    public async Task ASecondRoundOfCallersRefreshesAgain()
    {
        var client = new FakeAuthClient(TimeSpan.FromMilliseconds(20));
        var session = NewSession(client, new InMemoryTokenStore("stored"));

        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => session.ForceRefreshAsync()));
        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => session.ForceRefreshAsync()));

        // Each round coalesces to one call; the rounds do not coalesce with each other.
        Assert.InRange(client.RefreshCalls, 2, 10);
    }

    /// <summary>
    /// An offline launch has no access token to decode, so the user id must survive elsewhere —
    /// the offline branch needs it to look up this user's local acknowledgement marker.
    /// </summary>
    [Fact]
    public async Task TheUserIdSurvivesAnOfflineLaunch()
    {
        var settings = new InMemoryUserSettings();
        var store = new InMemoryTokenStore();
        var client = new FakeAuthClient { Next = new TokenPair(Jwt.ForSubject("user-77"), "r", 900) };

        var first = NewSession(client, store, settings);
        await first.LoginAsync("a@b.c", "pw");
        Assert.Equal("user-77", first.UserId);

        // Relaunch, offline: the refresh fails but the token is retained.
        client.RefreshFailure = AuthFailure.Transport;
        var second = NewSession(client, store, settings);
        Assert.Equal(BootstrapOutcome.Offline, await second.BootstrapAsync());
        Assert.Equal("user-77", second.UserId);
    }

    /// <summary>
    /// Sign-out must drop the mirrored id, or the next person to sign in on this machine inherits
    /// the previous user's identity for the offline acknowledgement lookup.
    /// </summary>
    [Fact]
    public async Task LogoutClearsTheMirroredUserId()
    {
        var settings = new InMemoryUserSettings();
        var store = new InMemoryTokenStore();
        var session = NewSession(new FakeAuthClient(), store, settings);

        await session.LoginAsync("a@b.c", "pw");
        session.Logout();

        Assert.Null(session.UserId);
        Assert.Null(store.ReadRefreshToken());
        Assert.False(session.IsAuthenticated);
    }
}

public class DpapiTokenStoreTests : IDisposable
{
    private readonly TempDirectory _dir = new();

    public void Dispose() => _dir.Dispose();

    [Fact]
    public void RoundTripsAToken()
    {
        var store = new DpapiTokenStore(_dir.File("refresh.bin"));

        store.SaveRefreshToken("a-refresh-token");

        Assert.Equal("a-refresh-token", store.ReadRefreshToken());
    }

    [Fact]
    public void ReadsNullBeforeAnythingIsSaved() =>
        Assert.Null(new DpapiTokenStore(_dir.File("missing.bin")).ReadRefreshToken());

    [Fact]
    public void ClearRemovesTheToken()
    {
        var store = new DpapiTokenStore(_dir.File("refresh.bin"));
        store.SaveRefreshToken("t");

        store.Clear();

        Assert.Null(store.ReadRefreshToken());
    }

    /// <summary>The token is never at rest in plaintext — that is the whole point of DPAPI here.</summary>
    [Fact]
    public void TheTokenIsNotStoredInPlaintext()
    {
        var path = _dir.File("refresh.bin");
        var store = new DpapiTokenStore(path);

        store.SaveRefreshToken("super-secret-refresh-token");

        var onDisk = File.ReadAllBytes(path);
        var asText = System.Text.Encoding.UTF8.GetString(onDisk);
        Assert.DoesNotContain("super-secret-refresh-token", asText, StringComparison.Ordinal);
    }
}
