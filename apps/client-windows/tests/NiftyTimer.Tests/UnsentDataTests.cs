using System.Text;
using NiftyTimer.App;
using NiftyTimer.Auth;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// Unsent data survives sign-out and a session the server ended, but is never uploaded under a
/// different account. The rule lives in <see cref="UnsentDataOwnership"/>; the sign-out drain in
/// <see cref="FinalDrain"/>; the AppDelegate wiring is pinned on the IL in
/// <see cref="UnsentDataWiringTests"/>.
/// </summary>
public class UnsentDataOwnershipTests
{
    [Fact]
    public void TheSameAccountKeepsItsUnsentData() =>
        Assert.Equal(UnsentDataAction.Keep, UnsentDataOwnership.Decide("user-a", "user-a", hasPending: true, sessionCarriedOver: false));

    /// <summary>The server attributes by token: draining A's records under B would bill A's work to B.</summary>
    [Fact]
    public void ADifferentAccountDiscardsThePreviousOwnersData()
    {
        Assert.Equal(UnsentDataAction.Discard, UnsentDataOwnership.Decide("user-a", "user-b", hasPending: true, sessionCarriedOver: false));
        Assert.Equal(UnsentDataAction.Discard, UnsentDataOwnership.Decide("user-a", "user-b", hasPending: true, sessionCarriedOver: true));
    }

    /// <summary>
    /// Legacy buffers (no owner marker) are kept only when the session carried straight over from
    /// the older build that wrote them; met at an interactive sign-in they cannot be shown to be
    /// this account's, so they go.
    /// </summary>
    [Fact]
    public void AnUnknownOwnerIsKeptOnlyForACarriedOverSession()
    {
        Assert.Equal(UnsentDataAction.Keep, UnsentDataOwnership.Decide(null, "user-a", hasPending: true, sessionCarriedOver: true));
        Assert.Equal(UnsentDataAction.Discard, UnsentDataOwnership.Decide(null, "user-a", hasPending: true, sessionCarriedOver: false));
    }

    [Fact]
    public void NothingPendingIsNothingToDiscard() =>
        Assert.Equal(UnsentDataAction.Keep, UnsentDataOwnership.Decide("user-a", "user-b", hasPending: false, sessionCarriedOver: false));

    /// <summary>The discard happens inside the claim, before the new owner is recorded.</summary>
    [Fact]
    public void ClaimingForADifferentAccountDiscardsFirstThenRecordsTheNewOwner()
    {
        var settings = new InMemoryUserSettings();
        var ownership = new UnsentDataOwnership(settings);
        ownership.Claim("user-a", pending: 0, sessionCarriedOver: false, discard: () => Assert.Fail("nothing to discard"));

        string? ownerAtDiscard = "not called";
        var action = ownership.Claim("user-b", pending: 3, sessionCarriedOver: false, discard: () => ownerAtDiscard = ownership.Owner);

        Assert.Equal(UnsentDataAction.Discard, action);
        Assert.Equal("user-a", ownerAtDiscard);
        Assert.Equal("user-b", ownership.Owner);
    }

    [Fact]
    public void ClaimingForTheSameAccountKeepsTheData()
    {
        var ownership = new UnsentDataOwnership(new InMemoryUserSettings());
        ownership.Claim("user-a", pending: 0, sessionCarriedOver: false, discard: () => { });

        var discarded = false;
        var action = ownership.Claim("user-a", pending: 5, sessionCarriedOver: false, discard: () => discarded = true);

        Assert.Equal(UnsentDataAction.Keep, action);
        Assert.False(discarded);
    }

    /// <summary>The owner marker is durable: it is what the next launch reads.</summary>
    [Fact]
    public void TheOwnerSurvivesARestart()
    {
        using var dir = new TempDirectory();
        var path = dir.File("settings.json");
        new UnsentDataOwnership(new JsonUserSettings(path)).Claim("user-a", 0, false, () => { });

        Assert.Equal("user-a", new UnsentDataOwnership(new JsonUserSettings(path)).Owner);
    }
}

public class FinalDrainTests : IDisposable
{
    private readonly TempDirectory _dir = new();

    public void Dispose() => _dir.Dispose();

    private static byte[] Payload(string s) => Encoding.UTF8.GetBytes(s);

    private BufferStore BufferWith(int entries)
    {
        var buffer = new BufferStore(_dir.File("buffer"));
        for (var i = 0; i < entries; i++)
        {
            buffer.Enqueue($"e{i:D4}", BufferKind.TimeEntry, Payload("x"));
        }

        return buffer;
    }

    /// <summary>
    /// One flush is one batch of 50. Sign-out used to run exactly one and clear the rest; now it
    /// keeps going until the buffer is empty.
    /// </summary>
    [Fact]
    public async Task SignOutDrainsEveryBatchNotJustTheFirst()
    {
        var buffer = BufferWith(120);
        var uploader = new FakeUploader();
        using var engine = new SyncEngine(buffer, uploader, new FakeUploader());

        var left = await FinalDrain.RunAsync(engine.FlushAsync, buffer.PendingCount);

        Assert.Equal(0, left);
        Assert.Equal(120, uploader.Uploads.Count);
    }

    /// <summary>A failing cycle ends the drain, and what is left stays on disk — nothing is cleared.</summary>
    [Fact]
    public async Task AFailedCycleStopsTheDrainAndKeepsTheRest()
    {
        var buffer = BufferWith(120);
        var uploader = new FakeUploader { Default = new UploadResult.Transient() };
        using var engine = new SyncEngine(buffer, uploader, new FakeUploader());

        var left = await FinalDrain.RunAsync(engine.FlushAsync, buffer.PendingCount);

        Assert.Equal(120, left);
        Assert.Equal(120, buffer.PendingCount());
        Assert.Single(uploader.Uploads); // stopped at the first failure, no retry storm
    }

    [Fact]
    public async Task ACycleThatMakesNoProgressEndsTheDrain()
    {
        var flushes = 0;

        var left = await FinalDrain.RunAsync(
            _ =>
            {
                flushes++;
                return Task.FromResult(false);
            },
            () => 7);

        Assert.Equal(7, left);
        Assert.Equal(1, flushes);
    }

    [Fact]
    public async Task TheDrainIsBounded()
    {
        var pending = 1000;
        var flushes = 0;

        await FinalDrain.RunAsync(
            _ =>
            {
                flushes++;
                pending--;
                return Task.FromResult(false);
            },
            () => pending,
            maxCycles: 5);

        Assert.Equal(5, flushes);
    }

    [Fact]
    public async Task AnEmptyBufferIsNotFlushedAtAll()
    {
        var flushes = 0;

        await FinalDrain.RunAsync(
            _ =>
            {
                flushes++;
                return Task.FromResult(false);
            },
            () => 0);

        Assert.Equal(0, flushes);
    }
}

public class SessionEndedTests
{
    private static AuthSession NewSession(FakeAuthClient client) =>
        new(client, new InMemoryTokenStore("stored"), new InMemoryUserSettings());

    /// <summary>
    /// A rejected refresh mid-session used to be swallowed by every caller — a deactivated user
    /// stayed "signed in" forever. It now raises one event, and the rejection still reaches the
    /// caller as before.
    /// </summary>
    [Fact]
    public async Task ARejectedRefreshMidSessionRaisesSessionEndedOnce()
    {
        var client = new FakeAuthClient();
        var session = NewSession(client);
        Assert.Equal(BootstrapOutcome.Authenticated, await session.BootstrapAsync());

        var raised = 0;
        session.SessionEnded += () => raised++;
        client.RefreshFailure = AuthFailure.RefreshRejected;

        var first = await Assert.ThrowsAsync<AuthException>(() => session.ForceRefreshAsync());
        await Assert.ThrowsAsync<AuthException>(() => session.ForceRefreshAsync());

        Assert.Equal(AuthFailure.RefreshRejected, first.Failure);
        Assert.Equal(1, raised);
    }

    [Theory]
    [InlineData(AuthFailure.Transport)]
    [InlineData(AuthFailure.Server)]
    public async Task BeingOfflineDoesNotEndTheSession(AuthFailure failure)
    {
        var client = new FakeAuthClient();
        var session = NewSession(client);
        await session.BootstrapAsync();

        var raised = 0;
        session.SessionEnded += () => raised++;
        client.RefreshFailure = failure;

        await Assert.ThrowsAsync<AuthException>(() => session.ForceRefreshAsync());

        Assert.Equal(0, raised);
    }

    /// <summary>Bootstrap reports the same rejection as Unauthenticated and shows the login itself.</summary>
    [Fact]
    public async Task ARejectionAtBootstrapIsNotASessionEnding()
    {
        var client = new FakeAuthClient { RefreshFailure = AuthFailure.RefreshRejected };
        var session = NewSession(client);
        var raised = 0;
        session.SessionEnded += () => raised++;

        Assert.Equal(BootstrapOutcome.Unauthenticated, await session.BootstrapAsync());
        Assert.Equal(0, raised);
    }

    /// <summary>A new sign-in re-arms the notification for that session.</summary>
    [Fact]
    public async Task ANewSignInReArmsTheEvent()
    {
        var client = new FakeAuthClient();
        var session = NewSession(client);
        await session.BootstrapAsync();
        var raised = 0;
        session.SessionEnded += () => raised++;

        client.RefreshFailure = AuthFailure.RefreshRejected;
        await Assert.ThrowsAsync<AuthException>(() => session.ForceRefreshAsync());

        client.RefreshFailure = null;
        await session.LoginAsync("person@example.com", "password");
        client.RefreshFailure = AuthFailure.RefreshRejected;
        await Assert.ThrowsAsync<AuthException>(() => session.ForceRefreshAsync());

        Assert.Equal(2, raised);
    }
}

/// <summary>
/// The AppDelegate half, on the IL — it cannot be constructed in a test. Each assertion pins one
/// connection that, if lost, would either delete unsent work or upload it under the wrong account.
/// </summary>
public class UnsentDataWiringTests
{
    private static bool Calls(string method, string type, string callee) =>
        LaunchResolutionWiringTests.References(LaunchResolutionWiringTests.Body(method), type, callee);

    [Theory]
    [InlineData(nameof(BufferStore))]
    [InlineData(nameof(ImageBufferStore))]
    [InlineData(nameof(ActivitySampleStore))]
    public void SignOutNoLongerClearsUnsentData(string store) =>
        Assert.False(
            Calls("SignOutAsync", store, "Clear"),
            $"AppDelegate.SignOutAsync clears {store} again — unsent work would be deleted on sign-out.");

    [Fact]
    public void SignOutDrainsUntilSettled() =>
        Assert.True(
            Calls("SignOutAsync", nameof(FinalDrain), nameof(FinalDrain.RunAsync)),
            "AppDelegate.SignOutAsync no longer drains repeatedly — one flush is only one batch.");

    /// <summary>
    /// The engines must not run while signed out: a login applies its token before the SignedIn
    /// handler runs, and an engine already ticking would upload the previous account's records under
    /// it in that gap.
    /// </summary>
    [Theory]
    [InlineData("Start")]
    [InlineData("SignOutAsync")]
    public void TheEnginesAreNotStartedBeforeTheBuffersAreClaimed(string method)
    {
        var body = method == "Start"
            ? typeof(AppDelegate).GetMethod("Start")!
            : LaunchResolutionWiringTests.Body(method);

        Assert.False(
            LaunchResolutionWiringTests.References(body, nameof(SyncEngine), nameof(SyncEngine.Start)),
            $"AppDelegate.{method} starts the sync engine before any account has claimed the buffers.");
    }

    /// <summary>The claim discards someone else's records BEFORE the engines start.</summary>
    [Fact]
    public void TheClaimPrecedesTheEngines()
    {
        var body = LaunchResolutionWiringTests.Body("ClaimUnsentData");
        var claim = LaunchResolutionWiringTests.FirstReference(body, nameof(UnsentDataOwnership), nameof(UnsentDataOwnership.Claim));
        var start = LaunchResolutionWiringTests.FirstReference(body, nameof(SyncEngine), nameof(SyncEngine.Start));

        Assert.True(claim >= 0, "ClaimUnsentData no longer consults the owner marker.");
        Assert.True(start > claim, "ClaimUnsentData starts the engines before deciding whose the buffers are.");
    }

    /// <summary>An interactive sign-in claims before it does anything else for the new account.</summary>
    [Fact]
    public void ASignInClaimsBeforeProceeding()
    {
        var body = LaunchResolutionWiringTests.Body("OnSignedIn");
        var claim = LaunchResolutionWiringTests.FirstReference(body, nameof(AppDelegate), "ClaimUnsentData");
        var proceed = LaunchResolutionWiringTests.FirstReference(body, nameof(AppDelegate), "ProceedToPolicyAsync");

        Assert.True(claim >= 0 && proceed > claim, "AppDelegate.OnSignedIn must claim the buffers before proceeding.");
    }

    [Fact]
    public void TheLaunchClaimsTheBuffers() =>
        Assert.True(
            Calls("BootstrapAsync", nameof(AppDelegate), "ClaimUnsentData"),
            "AppDelegate.BootstrapAsync no longer claims the buffers — nothing would sync after launch.");

    [Fact]
    public void ASessionEndedByTheServerRunsSignOut()
    {
        Assert.True(
            Calls("WireEvents", nameof(AuthSession), "add_SessionEnded"),
            "AppDelegate no longer listens for AuthSession.SessionEnded.");
        Assert.True(
            Calls("EndSessionAsync", nameof(AppDelegate), "SignOutAsync"),
            "AppDelegate.EndSessionAsync no longer runs the sign-out path.");
    }
}
