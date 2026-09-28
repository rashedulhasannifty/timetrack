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
    /// <summary>How long a download may go without receiving a byte before it is abandoned.</summary>
    internal static readonly TimeSpan DefaultStallTimeout = TimeSpan.FromSeconds(60);

    private readonly HttpClient _http;
    private readonly string _installDirectory;
    private readonly string _runningExecutable;
    private readonly TimeSpan _stallTimeout;
    private readonly string _logPath;

    public UpdateInstaller(
        HttpClient http,
        string? installDirectory = null,
        string? runningExecutable = null,
        TimeSpan? stallTimeout = null,
        string? logPath = null)
    {
        _http = http;
        _stallTimeout = stallTimeout ?? DefaultStallTimeout;
        _logPath = logPath ?? Path.Combine(Path.GetTempPath(), "niftytimer-update.log");
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
        await DownloadAsync(manifest.ZipUrl, zipPath, cancellationToken).ConfigureAwait(false);

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
    /// Stream the zip to disk, bounded by silence rather than by total time.
    ///
    /// 0.1.0 fetched it with a plain <c>GetAsync</c>, which reads the whole body before returning —
    /// inside the app's shared 30-second HTTP timeout. The zip is about 63 MB, so on any connection
    /// slower than roughly 17 Mbit/s every update failed after half a minute. Now only the wait for
    /// headers falls under that timeout; the body is streamed, and it is abandoned only when no data
    /// arrives for the stall timeout — a slow link finishes, a dead one fails.
    /// </summary>
    private async Task DownloadAsync(Uri url, string path, CancellationToken cancellationToken)
    {
        using var stall = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        stall.CancelAfter(_stallTimeout);
        try
        {
            using var response = await _http
                .GetAsync(url, HttpCompletionOption.ResponseHeadersRead, stall.Token)
                .ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                throw new UpdateInstallException(
                    UpdateInstallFailure.Download,
                    $"Download returned {(int)response.StatusCode}.");
            }

            await using var source = await response.Content.ReadAsStreamAsync(stall.Token).ConfigureAwait(false);
            await using var file = File.Create(path);
            var buffer = new byte[81920];
            int read;
            while ((read = await source.ReadAsync(buffer, stall.Token).ConfigureAwait(false)) > 0)
            {
                await file.WriteAsync(buffer.AsMemory(0, read), stall.Token).ConfigureAwait(false);

                // Data arrived, so the connection is alive: push the deadline out again.
                stall.CancelAfter(_stallTimeout);
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new UpdateInstallException(
                UpdateInstallFailure.Download,
                $"The download received no data for {_stallTimeout.TotalSeconds.ToString("0", CultureInfo.InvariantCulture)} seconds.");
        }
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
    /// install aside, copies the staged build in, relaunches, and on any failure puts the old
    /// install back. Renaming rather than deleting is what makes the rollback possible: if the
    /// copy in fails, the previous build is still there under a different name and is restored.
    ///
    /// The script starts in the temp folder, never in the install folder. It used to inherit this
    /// process's working directory — the install folder whenever the app was opened by
    /// double-clicking it — and Windows refuses to rename a folder that is any process's current
    /// directory. Every update then failed, rolled back without a word, and relaunched the old build.
    /// Each step is written to the update log, so a failure is never silent again.
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
            WorkingDirectory = Path.GetTempPath(),
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
                     "-Log", _logPath,
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
          [Parameter(Mandatory=$true)][string]$Relaunch,
          [string]$Log = (Join-Path ([IO.Path]::GetTempPath()) 'niftytimer-update.log')
        )
        $ErrorActionPreference = 'Stop'

        # Never stand in the install folder: Windows refuses to rename a folder that is any
        # process's current directory. Set-Location alone moves only PowerShell's own location,
        # not the process's, so the process directory is set as well.
        $neutral = [IO.Path]::GetTempPath()
        [Environment]::CurrentDirectory = $neutral
        Set-Location -LiteralPath $neutral

        function Write-Log([string]$Message) {
          try {
            $folder = Split-Path -Parent $Log
            if ($folder -and -not (Test-Path -LiteralPath $folder)) {
              New-Item -ItemType Directory -Force -Path $folder | Out-Null
            }
            Add-Content -LiteralPath $Log -Value ((Get-Date).ToString('o') + ' ' + $Message)
          } catch { }
        }

        # Antivirus commonly holds a freshly written file for a moment; a short retry rides it out.
        function Invoke-WithRetry([scriptblock]$Action, [string]$What) {
          for ($attempt = 1; $attempt -le 10; $attempt++) {
            try { & $Action; return }
            catch {
              Write-Log ("$What failed (attempt $attempt): " + $_.Exception.Message)
              if ($attempt -eq 10) { throw }
              Start-Sleep -Milliseconds 500
            }
          }
        }

        Write-Log "update: install=$Install staged=$Staged"

        # Wait for the app to exit; its image is locked until then. Bounded so a hung process
        # cannot leave a swap script running forever.
        for ($i = 0; $i -lt 60; $i++) {
          if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { break }
          Start-Sleep -Milliseconds 500
        }

        # Still alive means hung on the way out. It closed its span and flushed before handing over,
        # so ending it loses nothing — and relaunching beside it would meet its single-instance lock
        # and exit, leaving no copy running at all.
        if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
          Write-Log 'the app did not exit; ending it'
          Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
          Wait-Process -Id $ProcessId -Timeout 10 -ErrorAction SilentlyContinue
        }

        $backup = "$Install.previous"
        $movedAside = $false
        $swapped = $false
        try {
          if (Test-Path -LiteralPath $backup) {
            Invoke-WithRetry { Remove-Item -LiteralPath $backup -Recurse -Force } 'clearing an old backup'
          }
          Invoke-WithRetry { Move-Item -LiteralPath $Install -Destination $backup -Force } 'moving the current install aside'
          $movedAside = $true

          # Copied, not moved: the staged build sits in the temp folder, which can be on another drive.
          Invoke-WithRetry { Copy-Item -LiteralPath $Staged -Destination $Install -Recurse -Force } 'copying the new build in'
          if (-not (Test-Path -LiteralPath $Relaunch)) { throw "the new build has no $Relaunch" }
          $swapped = $true
          Write-Log 'update installed'
        } catch {
          Write-Log ('update failed: ' + $_.Exception.Message)
        }

        # Roll back only what this script moved. A partial copy goes first so the previous install
        # can take its place again.
        if ($movedAside -and -not $swapped) {
          try {
            if (Test-Path -LiteralPath $Install) {
              Invoke-WithRetry { Remove-Item -LiteralPath $Install -Recurse -Force } 'clearing a partial copy'
            }
            Invoke-WithRetry { Move-Item -LiteralPath $backup -Destination $Install -Force } 'restoring the previous install'
            Write-Log 'rolled back to the previous install'
          } catch {
            Write-Log ("ROLLBACK FAILED; the previous install is still at ${backup}. " + $_.Exception.Message)
          }
        }

        # The backup is deleted only once the new build is confirmed in place. On any other path it
        # may be the only copy of the app left on disk.
        if ($swapped) {
          Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
          Remove-Item -LiteralPath $Staged -Recurse -Force -ErrorAction SilentlyContinue
        }

        if (Test-Path -LiteralPath $Relaunch) {
          Start-Process -FilePath $Relaunch -WorkingDirectory $neutral
          Write-Log "relaunched $Relaunch"
        } else {
          Write-Log "nothing to relaunch at $Relaunch"
        }
        """;
}
