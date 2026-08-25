using NiftyTimer.Update;
using Xunit;

namespace NiftyTimer.Tests;

public class AppVersionTests
{
    /// <summary>
    /// The whole reason this type exists instead of comparing strings. Text ordering puts
    /// "0.10.0" before "0.9.0", which would strand every install on the older build at exactly the
    /// point version numbers start being interesting.
    /// </summary>
    [Fact]
    public void TenComesAfterNine()
    {
        Assert.True(AppVersion.Parse("0.9.0") < AppVersion.Parse("0.10.0"));
        Assert.False(AppVersion.Parse("0.10.0") < AppVersion.Parse("0.9.0"));
    }

    [Fact]
    public void MissingComponentsReadAsZero()
    {
        Assert.Equal(AppVersion.Parse("0.2"), AppVersion.Parse("0.2.0"));
        Assert.Equal(AppVersion.Parse("1"), AppVersion.Parse("1.0.0"));
    }

    [Fact]
    public void EqualVersionsHashTheSame()
    {
        Assert.Equal(AppVersion.Parse("0.2")!.GetHashCode(), AppVersion.Parse("0.2.0")!.GetHashCode());
    }

    /// <summary>GitHub tags carry a leading v, and ours carry a pilot suffix.</summary>
    [Theory]
    [InlineData("v0.2.0")]
    [InlineData("V0.2.0")]
    [InlineData("0.2.0-windows-pilot")]
    [InlineData("0.2.0+build.7")]
    [InlineData("  0.2.0  ")]
    public void LeadingVAndSuffixesAreTolerated(string raw)
    {
        Assert.Equal(AppVersion.Parse("0.2.0"), AppVersion.Parse(raw));
    }

    /// <summary>
    /// An unparseable version must be null, never a zero version. Null means "cannot compare";
    /// a zero version would mean "older than everything published", which is how you nag every
    /// developer running a local build, forever.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("v")]
    [InlineData("nightly")]
    [InlineData("1.x.0")]
    [InlineData("-1.0.0")]
    public void UnparseableVersionsAreNull(string raw)
    {
        Assert.Null(AppVersion.Parse(raw));
    }

    [Fact]
    public void ComparisonWalksComponentsNumerically()
    {
        Assert.True(AppVersion.Parse("1.2.3") < AppVersion.Parse("1.2.10"));
        Assert.True(AppVersion.Parse("1.2.3") < AppVersion.Parse("1.3.0"));
        Assert.True(AppVersion.Parse("1.2.3") < AppVersion.Parse("2.0.0"));
        Assert.True(AppVersion.Parse("1.2.3") >= AppVersion.Parse("1.2.3"));
    }
}

public class UpdateEvaluatorTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-08-25T09:00:00Z", null);

    private static ReleaseManifest Release(string version, DateTimeOffset publishedAt) =>
        new(AppVersion.Parse(version)!, publishedAt, new Uri("https://example.test/a.zip"), new string('a', 64));

    [Fact]
    public void ANewerBuildPublishedRecentlyIsAvailable()
    {
        var status = new UpdateEvaluator().Evaluate(
            AppVersion.Parse("0.1.0"),
            Release("0.2.0", Now.AddDays(-1)),
            Now);

        Assert.IsType<UpdateStatus.Available>(status);
        Assert.False(status.IsOverdue);
    }

    [Fact]
    public void ANewerBuildPastTheGraceperiodIsOverdue()
    {
        var status = new UpdateEvaluator(graceDays: 7).Evaluate(
            AppVersion.Parse("0.1.0"),
            Release("0.2.0", Now.AddDays(-8)),
            Now);

        Assert.True(status.IsOverdue);
    }

    [Fact]
    public void TheSameOrANewerRunningBuildIsCurrent()
    {
        var evaluator = new UpdateEvaluator();

        Assert.IsType<UpdateStatus.UnknownOrCurrent>(
            evaluator.Evaluate(AppVersion.Parse("0.2.0"), Release("0.2.0", Now.AddDays(-9)), Now));
        Assert.IsType<UpdateStatus.UnknownOrCurrent>(
            evaluator.Evaluate(AppVersion.Parse("0.3.0"), Release("0.2.0", Now.AddDays(-9)), Now));
    }

    /// <summary>
    /// A local build whose version does not parse must be treated as "cannot tell", never as
    /// "older than everything" — otherwise every developer is nagged on every launch.
    /// </summary>
    [Fact]
    public void AnUnreadableRunningVersionIsNeverReportedAsOutOfDate()
    {
        var status = new UpdateEvaluator().Evaluate(null, Release("9.9.9", Now.AddDays(-30)), Now);

        Assert.IsType<UpdateStatus.UnknownOrCurrent>(status);
    }

    [Fact]
    public void AFailedCheckSaysNothing()
    {
        Assert.IsType<UpdateStatus.UnknownOrCurrent>(
            new UpdateEvaluator().Evaluate(AppVersion.Parse("0.1.0"), null, Now));
    }

    /// <summary>
    /// Clock skew, or a tag backdated by a release script, gives a negative elapsed. That must
    /// fall through to Available rather than escalating straight to overdue.
    /// </summary>
    [Fact]
    public void AReleaseDatedInTheFutureDoesNotEscalate()
    {
        var status = new UpdateEvaluator().Evaluate(
            AppVersion.Parse("0.1.0"),
            Release("0.2.0", Now.AddDays(3)),
            Now);

        Assert.IsType<UpdateStatus.Available>(status);
    }

    /// <summary>
    /// The invariant that matters most in this whole subsystem: there is no status that stops
    /// tracking. Asserted structurally, because the tempting future addition is a "blocked" state.
    /// </summary>
    [Fact]
    public void ThereIsNoStatusThatCouldStopTracking()
    {
        var states = typeof(UpdateStatus).GetNestedTypes()
            .Where(t => t.IsSubclassOf(typeof(UpdateStatus)))
            .Select(t => t.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(["Available", "Overdue", "UnknownOrCurrent"], states);
    }
}

public class ReleaseFeedParsingTests
{
    private const string Release = """
        {
          "tag_name": "v0.3.0-windows-pilot",
          "published_at": "2026-08-20T12:00:00Z",
          "assets": [
            { "name": "NiftyTimer-windows-pilot.zip",
              "browser_download_url": "https://example.test/NiftyTimer-windows-pilot.zip" },
            { "name": "NiftyTimer-windows-pilot.zip.sha256",
              "browser_download_url": "https://example.test/NiftyTimer-windows-pilot.zip.sha256" }
          ]
        }
        """;

    [Fact]
    public void ItReadsTheVersionDateAndBothAssets()
    {
        var parsed = GitHubReleaseFeed.ParseRelease(Release);

        Assert.Equal(AppVersion.Parse("0.3.0"), parsed.Version);
        Assert.Equal(DateTimeOffset.Parse("2026-08-20T12:00:00Z", null), parsed.PublishedAt);
        Assert.EndsWith("NiftyTimer-windows-pilot.zip", parsed.ZipUrl.ToString(), StringComparison.Ordinal);
        Assert.EndsWith(".sha256", parsed.ChecksumUrl.ToString(), StringComparison.Ordinal);
    }

    /// <summary>
    /// A release with no checksum sidecar is refused outright. For the unsigned pilot the digest
    /// is the only thing standing between the running app and an arbitrary download, so a release
    /// missing it must fail rather than degrade to "install it anyway".
    /// </summary>
    [Fact]
    public void AReleaseMissingTheChecksumAssetIsRefused()
    {
        var json = Release.Replace("NiftyTimer-windows-pilot.zip.sha256", "notes.txt", StringComparison.Ordinal);

        var e = Assert.Throws<UpdateFeedException>(() => GitHubReleaseFeed.ParseRelease(json));
        Assert.Equal(UpdateFeedFailure.Malformed, e.Failure);
    }

    [Fact]
    public void AReleaseMissingTheZipIsRefused()
    {
        var json = Release.Replace(
            "\"name\": \"NiftyTimer-windows-pilot.zip\"",
            "\"name\": \"NiftyTimer-macos-pilot.zip\"",
            StringComparison.Ordinal);

        Assert.Throws<UpdateFeedException>(() => GitHubReleaseFeed.ParseRelease(json));
    }

    [Fact]
    public void ATagThatIsNotAVersionIsRefused()
    {
        var json = Release.Replace("v0.3.0-windows-pilot", "nightly", StringComparison.Ordinal);

        Assert.Throws<UpdateFeedException>(() => GitHubReleaseFeed.ParseRelease(json));
    }

    [Theory]
    [InlineData("abc123")]
    [InlineData("")]
    [InlineData("zzzz567890123456789012345678901234567890123456789012345678901234")]
    public void ANonDigestChecksumAssetIsRejected(string text)
    {
        Assert.Null(GitHubReleaseFeed.ParseChecksum(text));
    }

    /// <summary>Accepts both a bare digest and sha256sum-style output.</summary>
    [Fact]
    public void ItAcceptsEitherChecksumFormat()
    {
        var digest = new string('a', 64);

        Assert.Equal(digest, GitHubReleaseFeed.ParseChecksum(digest));
        Assert.Equal(digest, GitHubReleaseFeed.ParseChecksum($"{digest}  NiftyTimer-windows-pilot.zip\n"));
        Assert.Equal(digest, GitHubReleaseFeed.ParseChecksum(digest.ToUpperInvariant()));
    }
}

public class UpdateInstallerTests
{
    /// <summary>
    /// The transition rule for the unsigned pilot. Unsigned may replace unsigned; a publisher may
    /// replace itself. Signed to unsigned is refused, because accepting it would make the update
    /// path the exact mechanism an attacker needs to downgrade a signed install.
    /// </summary>
    [Fact]
    public void UnsignedMayReplaceUnsigned()
    {
        Assert.True(UpdateInstaller.PublisherTransitionAllowed(null, null));
    }

    [Fact]
    public void APublisherMayReplaceItself()
    {
        Assert.True(UpdateInstaller.PublisherTransitionAllowed("ABC123", "abc123"));
    }

    [Fact]
    public void SignedMayNotBecomeUnsigned()
    {
        Assert.False(UpdateInstaller.PublisherTransitionAllowed("ABC123", null));
    }

    [Fact]
    public void UnsignedMayNotBecomeSigned()
    {
        Assert.False(UpdateInstaller.PublisherTransitionAllowed(null, "ABC123"));
    }

    [Fact]
    public void ADifferentPublisherIsRefused()
    {
        Assert.False(UpdateInstaller.PublisherTransitionAllowed("ABC123", "DEF456"));
    }

    /// <summary>
    /// The swap has to survive its own failure. Renaming the old install aside rather than
    /// deleting it is what makes that possible — the script must restore it if the move in fails.
    /// </summary>
    [Fact]
    public void TheSwapScriptWaitsForTheProcessAndCanRollBack()
    {
        var script = UpdateInstaller.SwapScript();

        Assert.Contains("Get-Process -Id $ProcessId", script, StringComparison.Ordinal);
        Assert.Contains("Move-Item -Force $Install $backup", script, StringComparison.Ordinal);
        Assert.Contains("Move-Item -Force $backup $Install", script, StringComparison.Ordinal);
        Assert.Contains("Start-Process -FilePath $Relaunch", script, StringComparison.Ordinal);
    }
}
