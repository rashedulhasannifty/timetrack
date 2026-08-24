using System.Net.Http;
using NiftyTimer.Auth;
using NiftyTimer.Policy;
using NiftyTimer.Projects;
using NiftyTimer.Reports;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests.Integration;

/// <summary>
/// Marks a test that needs a real API. Skipped unless <c>NIFTYTIMER_E2E_API</c> points at one, so
/// the default <c>dotnet test</c> run — and CI — stays green without a stack.
///
/// Run them with a local stack up:
/// <code>
/// $env:NIFTYTIMER_E2E_API      = "http://127.0.0.1:3001/v1"
/// $env:NIFTYTIMER_E2E_EMAIL    = "admin@example.com"
/// $env:NIFTYTIMER_E2E_PASSWORD = "verify-pass-123"
/// dotnet test
/// </code>
/// </summary>
public sealed class ApiFactAttribute : FactAttribute
{
    public ApiFactAttribute()
    {
        if (LiveApi.BaseUrl is null)
        {
            Skip = "Set NIFTYTIMER_E2E_API (and _EMAIL/_PASSWORD) to run against a live API.";
        }
    }
}

internal static class LiveApi
{
    public static Uri? BaseUrl
    {
        get
        {
            var raw = Environment.GetEnvironmentVariable("NIFTYTIMER_E2E_API");
            if (string.IsNullOrWhiteSpace(raw))
            {
                return null;
            }

            return new Uri(raw.EndsWith('/') ? raw : raw + "/");
        }
    }

    public static string Email =>
        Environment.GetEnvironmentVariable("NIFTYTIMER_E2E_EMAIL") ?? "admin@example.com";

    public static string Password =>
        Environment.GetEnvironmentVariable("NIFTYTIMER_E2E_PASSWORD")
        ?? throw new InvalidOperationException("NIFTYTIMER_E2E_PASSWORD is required.");
}

/// <summary>
/// Exercises every HTTP client against a real API.
///
/// The rest of the suite tests behaviour at the <c>IUploader</c> / <c>IPolicyProvider</c> seam,
/// which means request construction itself — URLs, headers, JSON shape, status handling — is
/// never actually executed. Those are exactly the things the strict-mode Zod pipe rejects with a
/// 422 and the things a unit test cannot catch.
/// </summary>
public sealed class LiveApiTests : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };

    public void Dispose() => _http.Dispose();

    [ApiFact]
    public async Task SignsInAndMintsAUsableAccessToken()
    {
        var client = new AuthClient(_http, LiveApi.BaseUrl!);

        var pair = await client.LoginAsync(LiveApi.Email, LiveApi.Password);

        Assert.NotEmpty(pair.AccessToken);
        Assert.NotEmpty(pair.RefreshToken);
        Assert.True(pair.ExpiresIn > 0);

        // The claims the client actually reads must be present and decodable.
        var claims = JwtDecoder.ReadClaims(pair.AccessToken);
        Assert.NotEmpty(claims.Sub);
        Assert.NotEmpty(claims.TeamId);
    }

    [ApiFact]
    public async Task RejectsBadCredentialsAsInvalidRatherThanAsAServerError()
    {
        var client = new AuthClient(_http, LiveApi.BaseUrl!);

        var error = await Assert.ThrowsAsync<AuthException>(
            () => client.LoginAsync(LiveApi.Email, "definitely-not-the-password"));

        Assert.Equal(AuthFailure.InvalidCredentials, error.Failure);
    }

    [ApiFact]
    public async Task RotatesTheRefreshTokenAndKeepsTheSessionUsable()
    {
        var store = new InMemoryTokenStore();
        using var session = await NewSessionAsync(store);

        var firstRefresh = store.ReadRefreshToken();
        await session.ForceRefreshAsync();
        var secondRefresh = store.ReadRefreshToken();

        // Refresh tokens are single-use and rotate; the ACCESS token is not asserted on, because
        // two JWTs minted in the same second with identical claims are byte-identical.
        Assert.NotNull(secondRefresh);
        Assert.NotEqual(firstRefresh, secondRefresh);

        // The rotated token must still work — a reuse-detection trip would revoke the whole family
        // and every later call would 401.
        var policy = await NewPolicyClient(session).EffectivePolicyAsync();
        Assert.NotEmpty(policy.PolicyVersion);
    }

    /// <summary>
    /// Presenting an already-rotated refresh token outside the server's grace window is treated as
    /// REUSE and revokes the entire family. That is why <see cref="AuthSession"/> single-flights
    /// its refresh; this pins the server behaviour the design depends on.
    /// </summary>
    [ApiFact]
    public async Task ConcurrentCallersDoNotTripReuseDetection()
    {
        using var session = await NewSessionAsync();

        var tokens = await Task.WhenAll(
            Enumerable.Range(0, 10).Select(_ => session.AccessTokenAsync()));

        Assert.All(tokens, t => Assert.NotEmpty(t));

        // Still usable: had the callers raced into separate refreshes, the family would be gone.
        var policy = await NewPolicyClient(session).EffectivePolicyAsync();
        Assert.NotEmpty(policy.PolicyVersion);
    }

    [ApiFact]
    public async Task ReadsTheEffectivePolicyAndDecodesItsSettings()
    {
        using var session = await NewSessionAsync();

        var policy = await NewPolicyClient(session).EffectivePolicyAsync();

        Assert.NotEmpty(policy.PolicyVersion);
        Assert.NotNull(policy.Settings);
        Assert.True(policy.Settings.IdleThresholdMinutes > 0);
        Assert.True(policy.Settings.ScreenshotIntervalMinutes > 0);
    }

    /// <summary>
    /// The acknowledgement round-trip: the server reports <c>ackRequired</c>, the client posts the
    /// acknowledgement, and the server stops requiring it. This is the gate that lets capture run
    /// at all, so it is the single most important request the client makes.
    /// </summary>
    [ApiFact]
    public async Task AcknowledgingMonitoringOpensTheGateServerSide()
    {
        using var session = await NewSessionAsync();
        var policyClient = NewPolicyClient(session);

        var before = await policyClient.EffectivePolicyAsync();
        var userId = session.UserId!;

        var ackClient = new AckClient(_http, LiveApi.BaseUrl!, session);
        Assert.True(await ackClient.AcknowledgeAsync(userId, before.PolicyVersion));

        var after = await policyClient.EffectivePolicyAsync();
        Assert.False(after.AckRequired);

        // And the gate agrees, through the same path the capture subsystems use.
        var gate = new AckGate(policyClient);
        Assert.True(await gate.WithCaptureAllowedAsync(_ => Task.FromResult(true)));
    }

    [ApiFact]
    public async Task ListsProjectsAndSelfTotals()
    {
        using var session = await NewSessionAsync();
        var json = new AuthorizedJsonClient(_http, LiveApi.BaseUrl!, session);

        var projects = await new ProjectClient(json).ListAsync();
        Assert.NotNull(projects);

        var totals = await new SelfTotalsClient(json).FetchAsync();

        // Every boundary is resolved server-side in Asia/Dhaka; the client must never recompute.
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", totals.Day);
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", totals.WeekStart);
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", totals.MonthStart);
        Assert.True(totals.TodaySeconds >= 0);
    }

    /// <summary>
    /// A closed entry, exactly as <see cref="TimeTracker"/> builds it, must be accepted. If the
    /// null-vs-omit rules were wrong this returns 422 and the whole buffer would drain into
    /// nothing — dropped as "permanent" and gone.
    /// </summary>
    [ApiFact]
    public async Task PostsAClosedTimeEntryAndCanReadItBack()
    {
        using var session = await NewSessionAsync();
        var uploader = new TimeEntryUploader(_http, LiveApi.BaseUrl!, session);

        var start = DateTimeOffset.UtcNow.AddMinutes(-20);
        var id = UuidV7.Generate(start);

        var buffer = new BufferSpyRecorder();
        var tracker = new TimeTracker(buffer, () => start, _ => id);
        tracker.Start(null, null, "integration round-trip");
        tracker.Stop(start.AddMinutes(5));

        var result = await uploader.UploadAsync(buffer.Last);
        Assert.IsType<UploadResult.Success>(result);

        // Idempotent on the client-minted UUIDv7 — a retry must be a no-op, not a duplicate.
        Assert.IsType<UploadResult.Success>(await uploader.UploadAsync(buffer.Last));

        var json = new AuthorizedJsonClient(_http, LiveApi.BaseUrl!, session);
        var from = Uri.EscapeDataString(UuidV7.Iso(start.AddHours(-1)));
        var to = Uri.EscapeDataString(UuidV7.Iso(DateTimeOffset.UtcNow.AddHours(1)));
        var entries = await json.GetAsync<List<Dictionary<string, object>>>(
            $"time-entries?from={from}&to={to}");

        Assert.Contains(entries, e => e["id"].ToString() == id);
    }

    /// <summary>
    /// The heartbeat: re-POSTing the SAME open entry keeps it alive. There is no dedicated
    /// heartbeat route, so if this were rejected the running entry would go stale after five
    /// minutes and every reporting query would silently truncate the person's live time.
    /// </summary>
    [ApiFact]
    public async Task PublishesARunningEntryAndHeartbeatsIt()
    {
        using var session = await NewSessionAsync();
        var uploader = new TimeEntryUploader(_http, LiveApi.BaseUrl!, session);
        var publisher = new LiveEntryPublisher(uploader);

        var blocked = new List<bool>();
        var conflicts = new List<string>();
        publisher.BlockedChanged += blocked.Add;
        publisher.ConflictDetected += conflicts.Add;

        var start = DateTimeOffset.UtcNow;
        var entryId = UuidV7.Generate(start);
        var span = new TrackerState.Tracking(
            entryId, start, new TimeTracker.Selection(null, null), TimeTracker.EntrySource.Manual);

        await publisher.HeartbeatAsync(span);
        await publisher.HeartbeatAsync(span);

        Assert.Empty(conflicts);
        Assert.Empty(blocked);

        // Close it so the one-running-entry index is released for the next test.
        await CloseEntryAsync(uploader, entryId, start);
    }

    /// <summary>
    /// The one collision a second client platform introduces. Opening a second running entry while
    /// a FRESH one exists must come back 409 — and <c>Classify</c> must carry the status through,
    /// because that is what turns it into "already tracking on another machine" rather than a
    /// generic retry.
    /// </summary>
    [ApiFact]
    public async Task ASecondRunningEntryIsRefusedWithAConflict()
    {
        using var session = await NewSessionAsync();
        var uploader = new TimeEntryUploader(_http, LiveApi.BaseUrl!, session);

        var start = DateTimeOffset.UtcNow;
        var firstId = UuidV7.Generate(start);
        var secondId = UuidV7.Generate(start.AddMilliseconds(1));

        Assert.IsType<UploadResult.Success>(await uploader.UploadAsync(OpenEntry(firstId, start)));

        var result = await uploader.UploadAsync(OpenEntry(secondId, start.AddSeconds(1)));

        var permanent = Assert.IsType<UploadResult.Permanent>(result);
        Assert.Equal(409, permanent.Status);

        // And the publisher turns exactly that into the conflict signal, naming the refused span.
        var publisher = new LiveEntryPublisher(uploader);
        var conflicts = new List<string>();
        var blocked = new List<bool>();
        publisher.ConflictDetected += conflicts.Add;
        publisher.BlockedChanged += blocked.Add;

        await publisher.PublishAsync(
            secondId, start.AddSeconds(1), new TimeTracker.Selection(null, null),
            TimeTracker.EntrySource.Manual);

        Assert.Equal([secondId], conflicts);
        Assert.Empty(blocked);

        await CloseEntryAsync(uploader, firstId, start);
    }

    /// <summary>
    /// A malformed record must come back as PERMANENT so the sync engine drops it. If this were
    /// classified transient, one bad record would wedge the queue behind it forever.
    /// </summary>
    [ApiFact]
    public async Task AnInvalidRecordIsRejectedAsPermanentSoItCannotWedgeTheQueue()
    {
        using var session = await NewSessionAsync();
        var uploader = new TimeEntryUploader(_http, LiveApi.BaseUrl!, session);

        var bad = System.Text.Encoding.UTF8.GetBytes("""{"id":"not-a-uuid","source":"MANUAL"}""");

        var permanent = Assert.IsType<UploadResult.Permanent>(await uploader.UploadAsync(bad));
        Assert.InRange(permanent.Status, 400, 499);
    }

    /// <summary>
    /// Request bodies are parsed in Zod STRICT mode. This pins the reason the payload type must
    /// never gain a helpful <c>platform</c> or <c>deviceId</c> field.
    /// </summary>
    [ApiFact]
    public async Task AnUnknownBodyFieldIsRejected()
    {
        using var session = await NewSessionAsync();
        var uploader = new TimeEntryUploader(_http, LiveApi.BaseUrl!, session);

        var start = DateTimeOffset.UtcNow.AddMinutes(-10);
        var body = $$"""
            {"id":"{{UuidV7.Generate(start)}}","projectId":null,"taskId":null,
             "startTime":"{{UuidV7.Iso(start)}}","endTime":"{{UuidV7.Iso(start.AddMinutes(1))}}",
             "source":"MANUAL","platform":"windows"}
            """;

        var result = await uploader.UploadAsync(System.Text.Encoding.UTF8.GetBytes(body));

        var permanent = Assert.IsType<UploadResult.Permanent>(result);
        Assert.Equal(422, permanent.Status);
    }

    private static byte[] OpenEntry(string id, DateTimeOffset start) => new TimeEntryPayload
    {
        Id = id,
        ProjectId = null,
        TaskId = null,
        StartTime = UuidV7.Iso(start),
        EndTime = null,
        Source = "MANUAL",
        Note = null,
    }.ToJsonUtf8();

    private static async Task CloseEntryAsync(IUploader uploader, string id, DateTimeOffset start)
    {
        var closed = new TimeEntryPayload
        {
            Id = id,
            ProjectId = null,
            TaskId = null,
            StartTime = UuidV7.Iso(start),
            EndTime = UuidV7.Iso(start.AddSeconds(1)),
            Source = "MANUAL",
            Note = null,
        };
        await uploader.UploadAsync(closed.ToJsonUtf8());
    }

    private PolicyClient NewPolicyClient(AuthSession session) =>
        new(_http, LiveApi.BaseUrl!, session);

    private Task<AuthSession> NewSessionAsync() => NewSessionAsync(new InMemoryTokenStore());

    private async Task<AuthSession> NewSessionAsync(ITokenStore store)
    {
        var session = new AuthSession(
            new AuthClient(_http, LiveApi.BaseUrl!),
            store,
            new InMemoryUserSettings());
        await session.LoginAsync(LiveApi.Email, LiveApi.Password);
        return session;
    }

    private sealed class BufferSpyRecorder : ITimeEntryBuffer
    {
        public byte[] Last { get; private set; } = [];

        public void Enqueue(string id, BufferKind kind, byte[] payload) => Last = payload;
    }
}
