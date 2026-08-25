using NiftyTimer.Update;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The release scripts and the update feed agree on filenames only by convention, and a
/// convention that nothing checks is one a rename breaks silently. The failure is unusually
/// nasty: publishing still succeeds, the release looks correct on GitHub, and every installed
/// client simply stops seeing updates forever — with no error anywhere, because "no matching
/// asset" is indistinguishable from "no release yet".
///
/// So these read the actual scripts. They are string assertions over PowerShell, which is
/// unlovely, and they are the only thing tying the two halves together.
/// </summary>
public class PackagingContractTests
{
    private static string Script(string name)
    {
        // Walk up from the test binary to the client root; the scripts are not copied to output.
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "scripts")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        var path = Path.Combine(directory!.FullName, "scripts", name);
        Assert.True(File.Exists(path), $"{name} is missing — the release pipeline needs it.");
        return File.ReadAllText(path);
    }

    [Fact]
    public void TheReleaseScriptPublishesTheAssetNameTheFeedLooksFor()
    {
        Assert.Contains(GitHubReleaseFeed.AssetName, Script("release-assets.ps1"), StringComparison.Ordinal);
    }

    /// <summary>
    /// The feed refuses a release with no matching digest, so the sidecar is not optional. The
    /// script derives its name by appending .sha256 to the zip path, which is exactly how the
    /// feed derives the name it looks for.
    /// </summary>
    [Fact]
    public void TheReleaseScriptWritesAChecksumSidecar()
    {
        var script = Script("release-assets.ps1");

        Assert.Contains(".sha256", script, StringComparison.Ordinal);
        Assert.Contains("Get-FileHash -Algorithm SHA256", script, StringComparison.Ordinal);
        Assert.EndsWith(".sha256", GitHubReleaseFeed.ChecksumAssetName, StringComparison.Ordinal);
    }

    /// <summary>
    /// Production is the DEFAULT for packaging, and the direction of that default matters. A
    /// packaged build is the artifact employees run; one that silently talks to 127.0.0.1 starts
    /// cleanly, shows a tray icon, and records nothing at all.
    /// </summary>
    [Fact]
    public void PackagingDefaultsToProductionAndKeepsTheVersionPrefix()
    {
        var script = Script("package-app.ps1");

        Assert.Contains("https://timer.niftyitsolution.com/v1", script, StringComparison.Ordinal);
        Assert.Contains("EndsWith('/v1')", script, StringComparison.Ordinal);
    }

    /// <summary>
    /// The tray icons are copied by explicit name so a rename fails the package rather than
    /// shipping an app with no indicator (PRD 4.2).
    /// </summary>
    [Fact]
    public void PackagingCopiesTheTrayIconsByName()
    {
        var script = Script("package-app.ps1");

        Assert.Contains("tray-idle.ico", script, StringComparison.Ordinal);
        Assert.Contains("tray-tracking.ico", script, StringComparison.Ordinal);
    }

    /// <summary>
    /// Signing must be a no-op with a warning, not a failure, while the pilot is unsigned — a
    /// step that fails hard on a missing certificate gets commented out, and a commented-out step
    /// never gets switched back on.
    /// </summary>
    [Fact]
    public void SigningIsANoOpWithoutACertificate()
    {
        var script = Script("sign.ps1");

        Assert.Contains("Write-Warning", script, StringComparison.Ordinal);
        Assert.Contains("exit 0", script, StringComparison.Ordinal);

        // Timestamping is what keeps a signature valid past certificate expiry.
        Assert.Contains("/tr", script, StringComparison.Ordinal);
    }

    /// <summary>
    /// The Windows release must not go to the repo the Mac client reads. GitHub has one
    /// releases/latest per repository, so a Windows asset there becomes latest and every
    /// installed Mac client goes blind to updates.
    /// </summary>
    [Fact]
    public void TheUpdateRepoIsNotTheMacRepo()
    {
        Assert.DoesNotContain("timetrack-app", Script("package-app.ps1"), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("niftytimer-windows", Script("package-app.ps1"), StringComparison.Ordinal);
    }
}
