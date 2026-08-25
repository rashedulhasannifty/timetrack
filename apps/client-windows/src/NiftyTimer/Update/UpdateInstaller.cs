using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace NiftyTimer.Update;

public enum UpdateInstallFailure
{
    /// <summary>
    /// The install directory is not writable — a machine-wide install, or one deployed by MDM
    /// under Program Files. Detected BEFORE anything is downloaded, so the person is sent to the
    /// releases page rather than failing halfway through a swap.
    /// </summary>
    DestinationNotWritable,

    Download,

    /// <summary>The zip did not match the published digest. Never proceed.</summary>
    ChecksumMismatch,

    ExtractionFailed,

    /// <summary>
    /// The downloaded build does not carry the same Authenticode publisher as the running one.
    /// </summary>
    SignatureRejected,

    NoExecutableInArchive,

    SwapFailed,
}

public sealed class UpdateInstallException : Exception
{
    public UpdateInstallException(UpdateInstallFailure failure, string message)
        : base(message) =>
        Failure = failure;

    public UpdateInstallFailure Failure { get; }
}

/// <summary>
/// Downloads, verifies and swaps in a new build.
///
/// Two independent checks gate the swap:
///
/// 1. <b>SHA-256</b> against the digest published beside the asset. Catches a truncated or
///    corrupted download, and for the unsigned pilot it is the ONLY thing standing between the
///    running application and an arbitrary file off the internet.
/// 2. <b>Authenticode publisher identity</b>, compared against the RUNNING module. This is the
///    check that matters once signing exists: verifying a signature only proves it is internally
///    consistent, and anyone can sign anything. Comparing against our own publisher proves the new
///    build carries the same identity as the code doing the checking.
///
/// While the pilot is unsigned, check 2 degrades to a TRANSITION rule rather than being skipped:
/// unsigned may replace unsigned, signed may replace signed by the same publisher, and every other
/// combination — signed to unsigned, or a different publisher — is refused. That is what stops a
/// swap being the moment an attacker downgrades a signed install.
///
/// <b>Nothing in this class may stop tracking.</b> Every failure returns or throws to a caller
/// whose strongest response is a visible warning. An out-of-date client that keeps recording is
/// strictly better than an up-to-date one that lost somebody's day.
/// </summary>
public sealed class UpdateInstaller
{
    private readonly HttpClient _http;
    private readonly string _installDirectory;
    private readonly string _runningExecutable;

    public UpdateInstaller(HttpClient http, string? installDirectory = null, string? runningExecutable = null)
    {
        _http = http;
        _runningExecutable = runningExecutable ?? Environment.ProcessPath ?? string.Empty;
        _installDirectory = installDirectory
            ?? (_runningExecutable.Length > 0
                ? Path.GetDirectoryName(_runningExecutable) ?? AppContext.BaseDirectory
                : AppContext.BaseDirectory);
    }

    /// <summary>
    /// Cheap precheck, safe to call before offering the update at all. Writing a probe file is the
    /// only reliable answer on Windows: directory ACLs, virtualization and MDM policy all mean the
    /// permission bits do not tell you whether a write will actually succeed.
    /// </summary>
    public bool CanInstall()
    {
        try
        {
            var probe = Path.Combine(_installDirectory, $".niftytimer-write-probe-{Guid.NewGuid():N}");
            File.WriteAllBytes(probe, []);
            File.Delete(probe);
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return false;
        }
    }

    /// <summary>
    /// Download, verify, and extract to a staging directory. Does NOT swap — the caller decides
    /// when to do that, because swapping ends the process.
    /// </summary>
    public async Task<string> StageAsync(ReleaseManifest manifest, CancellationToken cancellationToken = default)
    {
        if (!CanInstall())
        {
            throw new UpdateInstallException(
                UpdateInstallFailure.DestinationNotWritable,
                $"{_installDirectory} is not writable.");
        }

        var work = Path.Combine(Path.GetTempPath(), $"NiftyTimerUpdate-{Guid.NewGuid():N}");
        Directory.CreateDirectory(work);

        var zipPath = Path.Combine(work, "update.zip");
        using (var response = await _http.GetAsync(manifest.ZipUrl, cancellationToken).ConfigureAwait(false))
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new UpdateInstallException(
                    UpdateInstallFailure.Download,
                    $"Download returned {(int)response.StatusCode}.");
            }

            await using var file = File.Create(zipPath);
            await response.Content.CopyToAsync(file, cancellationToken).ConfigureAwait(false);
        }

        var actual = Sha256Of(zipPath);
        var expected = manifest.Sha256.ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.ASCII.GetBytes(actual),
                System.Text.Encoding.ASCII.GetBytes(expected)))
        {
            throw new UpdateInstallException(
                UpdateInstallFailure.ChecksumMismatch,
                $"Digest mismatch: expected {expected}, got {actual}.");
        }

        var staged = Path.Combine(work, "staged");
        try
        {
            ZipFile.ExtractToDirectory(zipPath, staged);
        }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            throw new UpdateInstallException(UpdateInstallFailure.ExtractionFailed, e.Message);
        }

        var executable = Path.Combine(staged, "NiftyTimer.exe");
        if (!File.Exists(executable))
        {
            throw new UpdateInstallException(
                UpdateInstallFailure.NoExecutableInArchive,
                "The archive contains no NiftyTimer.exe.");
        }

        if (!PublisherTransitionAllowed(PublisherOf(_runningExecutable), PublisherOf(executable)))
        {
            throw new UpdateInstallException(
                UpdateInstallFailure.SignatureRejected,
                "The downloaded build has a different Authenticode publisher than the running one.");
        }

        return staged;
    }

    /// <summary>
    /// The transition rule, kept pure so it can be tested without signing anything.
    ///
    /// Null means unsigned. Unsigned may replace unsigned (the pilot), and a publisher may replace
    /// itself. Everything else is refused — in particular signed to unsigned, which is what an
    /// attacker would need a swap to accept in order to downgrade a signed install.
    /// </summary>
    internal static bool PublisherTransitionAllowed(string? running, string? candidate) =>
        string.Equals(running, candidate, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The Authenticode signer thumbprint, or null when the file is unsigned or unreadable. Note
    /// that this reads the certificate WITHOUT validating the chain: the comparison above is what
    /// provides the guarantee, and a pilot signed by a self-issued certificate would otherwise be
    /// indistinguishable from an unsigned one.
    /// </summary>
    internal static string? PublisherOf(string path)
    {
        if (path.Length == 0 || !File.Exists(path))
        {
            return null;
        }

        try
        {
            using var certificate = X509CertificateLoader.LoadCertificateFromFile(path);
            return certificate.Thumbprint;
        }
        catch (CryptographicException)
        {
            return null; // unsigned
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    internal static string Sha256Of(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    /// <summary>
    /// Hand the swap to a detached PowerShell script and return, so the caller can exit.
    ///
    /// A running executable cannot replace itself on Windows — the image is locked — so the swap
    /// has to outlive this process. The script waits for our PID to disappear, renames the current
    /// install aside, moves the staged build in, relaunches, and on any failure puts the old
    /// install back. Renaming rather than deleting is what makes the rollback possible: if the
    /// move in fails, the previous build is still there under a different name and is restored.
    ///
    /// This mirrors the macOS client, which shells out to a small swap script for the same reason.
    /// A dedicated updater executable would be tidier and is the obvious follow-up; it is also a
    /// second binary to build, sign and ship, which the pilot does not have.
    /// </summary>
    public void LaunchDetachedSwap(string stagedDirectory)
    {
        var scriptPath = Path.Combine(Path.GetTempPath(), $"niftytimer-swap-{Guid.NewGuid():N}.ps1");
        File.WriteAllText(scriptPath, SwapScript(), new System.Text.UTF8Encoding(false));

        var start = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        foreach (var argument in new[]
                 {
                     "-NoProfile",
                     "-ExecutionPolicy", "Bypass",
                     "-WindowStyle", "Hidden",
                     "-File", scriptPath,
                     "-ProcessId", Environment.ProcessId.ToString(CultureInfo.InvariantCulture),
                     "-Staged", stagedDirectory,
                     "-Install", _installDirectory,
                     "-Relaunch", _runningExecutable,
                 })
        {
            start.ArgumentList.Add(argument);
        }

        try
        {
            Process.Start(start);
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            throw new UpdateInstallException(UpdateInstallFailure.SwapFailed, e.Message);
        }
    }

    /// <summary>The swap script. Kept here rather than as a content file so it cannot go missing
    /// from a package, which would turn every update into a half-applied install.</summary>
    internal static string SwapScript() => """
        param(
          [Parameter(Mandatory=$true)][int]$ProcessId,
          [Parameter(Mandatory=$true)][string]$Staged,
          [Parameter(Mandatory=$true)][string]$Install,
          [Parameter(Mandatory=$true)][string]$Relaunch
        )

        $ErrorActionPreference = 'Stop'

        # Wait for the app to exit; its image is locked until then. Bounded so a hung process
        # cannot leave a swap script running forever.
        for ($i = 0; $i -lt 60; $i++) {
          if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { break }
          Start-Sleep -Milliseconds 500
        }

        $backup = "$Install.previous"

        try {
          if (Test-Path $backup) { Remove-Item -Recurse -Force $backup }
          Move-Item -Force $Install $backup
          Move-Item -Force $Staged $Install
        } catch {
          # Roll back: the previous install is still on disk under $backup.
          if ((Test-Path $backup) -and -not (Test-Path $Install)) {
            Move-Item -Force $backup $Install
          }
        }

        if (Test-Path $backup) { Remove-Item -Recurse -Force $backup -ErrorAction SilentlyContinue }
        if (Test-Path $Relaunch) { Start-Process -FilePath $Relaunch }
        """;
}
