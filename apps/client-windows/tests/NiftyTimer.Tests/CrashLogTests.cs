using NiftyTimer.App;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The local record of errors nothing else caught. The file is the client's first log sink, so the
/// never-log list in CLAUDE.md §4 is pinned here as behaviour: tokens and the account name must not
/// reach it even when an exception message carries them.
/// </summary>
public class CrashLogTests
{
    private static string NewDirectory() =>
        Path.Combine(Path.GetTempPath(), "niftytimer-tests", Guid.NewGuid().ToString("n"));

    [Fact]
    public void AnExceptionIsRecordedWithItsTypeMessageAndWhereItSurfaced()
    {
        var log = new CrashLog(NewDirectory());

        log.Write(new InvalidOperationException("Shell_NotifyIcon(NIM_ADD) failed"), "UI thread");

        var text = File.ReadAllText(log.FilePath);
        Assert.Contains("UI thread", text, StringComparison.Ordinal);
        Assert.Contains(nameof(InvalidOperationException), text, StringComparison.Ordinal);
        Assert.Contains("Shell_NotifyIcon(NIM_ADD) failed", text, StringComparison.Ordinal);
    }

    [Fact]
    public void EachEntryCarriesTheTimeAndTheBuild()
    {
        var log = new CrashLog(NewDirectory(), () => new DateTimeOffset(2026, 9, 15, 8, 30, 0, TimeSpan.Zero));

        log.Write("something happened");

        var text = File.ReadAllText(log.FilePath);
        Assert.Contains("2026-09-15T08:30:00.0000000+00:00", text, StringComparison.Ordinal);
        Assert.Contains($"v{BuildStamp.Version}", text, StringComparison.Ordinal);
    }

    [Fact]
    public void ATokenInAMessageIsNeverWritten()
    {
        const string jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl";
        var log = new CrashLog(NewDirectory());

        log.Write(new InvalidOperationException($"refresh failed: Bearer s3cr3t-access and {jwt}"), "UI thread");

        var text = File.ReadAllText(log.FilePath);
        Assert.DoesNotContain("s3cr3t-access", text, StringComparison.Ordinal);
        Assert.DoesNotContain(jwt, text, StringComparison.Ordinal);
        Assert.Contains("refresh failed", text, StringComparison.Ordinal);
    }

    [Fact]
    public void TheAccountNameInAProfilePathIsNeverWritten()
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        Assert.False(string.IsNullOrEmpty(profile), "Precondition: this machine has a user profile path.");
        var log = new CrashLog(NewDirectory());

        log.Write(new IOException($"could not read {Path.Combine(profile, "AppData", "Local", "x.json")}"), "UI thread");

        var text = File.ReadAllText(log.FilePath);
        Assert.DoesNotContain(profile, text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("%USERPROFILE%", text, StringComparison.Ordinal);
    }

    /// <summary>A crash loop must not be able to fill the disk.</summary>
    [Fact]
    public void AFullLogRotatesInsteadOfGrowing()
    {
        var directory = NewDirectory();
        Directory.CreateDirectory(directory);
        var log = new CrashLog(directory);
        File.WriteAllText(log.FilePath, new string('x', (int)CrashLog.MaxBytes + 1));

        log.Write("the next entry");

        Assert.True(File.Exists(log.FilePath + ".1"), "The full log was not rotated aside.");
        Assert.True(new FileInfo(log.FilePath).Length < CrashLog.MaxBytes, "The live log kept growing past its cap.");
    }

    /// <summary>A log that cannot be written must not become a second failure on top of the first.</summary>
    [Fact]
    public void AnUnwritableLocationIsNotASecondFailure()
    {
        var blocker = Path.Combine(Path.GetTempPath(), "niftytimer-tests", Guid.NewGuid().ToString("n"));
        Directory.CreateDirectory(Path.GetDirectoryName(blocker)!);
        File.WriteAllText(blocker, "a file where the log directory should be");
        var log = new CrashLog(Path.Combine(blocker, "logs"));

        var thrown = Record.Exception(() => log.Write("anything"));

        Assert.Null(thrown);
    }
}
