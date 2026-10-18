using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Net.Http;
using System.Runtime.InteropServices;
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
    /// The downloaded build does not carry the same Authenticode publisher as the running one, or
    /// it carries a signature that does not verify against its own contents (tampered).
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

        var candidate = AuthenticodeOf(executable);
        if (candidate.Status == AuthenticodeStatus.Invalid)
        {
            throw new UpdateInstallException(
                UpdateInstallFailure.SignatureRejected,
                "The downloaded build carries an Authenticode signature that does not verify.");
        }

        if (!TransitionAllowed(AuthenticodeOf(_runningExecutable), candidate))
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
    /// The full transition rule over verified signatures. A signature that is present but does not
    /// verify — on either side — is refused outright: it is never treated as "unsigned", because
    /// that would let a tampered build ride the unsigned-to-unsigned pilot rule. Otherwise the
    /// thumbprints decide, exactly as <see cref="PublisherTransitionAllowed"/> describes.
    /// </summary>
    internal static bool TransitionAllowed(AuthenticodeResult running, AuthenticodeResult candidate) =>
        running.Status != AuthenticodeStatus.Invalid
        && candidate.Status != AuthenticodeStatus.Invalid
        && PublisherTransitionAllowed(running.Thumbprint, candidate.Thumbprint);

    /// <summary>
    /// Verify the embedded Authenticode signature of <paramref name="path"/> and, only once it
    /// verifies, read the signer's thumbprint.
    ///
    /// The previous implementation handed the executable to <c>X509CertificateLoader</c>, which
    /// reads certificate files, not signed PE images: it threw for every executable, so every build
    /// — signed or not — read as "unsigned", and nothing ever checked the signature against the
    /// file's contents. A signed install would have accepted an unsigned or tampered update.
    ///
    /// Three outcomes, kept distinct:
    ///
    /// - <b>Unsigned</b> — the file is not a PE image, or its PE header carries no certificate
    ///   table. Presence is read from the header, not inferred from a WinVerifyTrust error code, so
    ///   a damaged signature can never be mistaken for an absent one.
    /// - <b>Signed</b> — WinVerifyTrust verified the signature over the file's contents. Chain
    ///   TRUST is deliberately not required (see <see cref="Classify"/>): identity is pinned by
    ///   thumbprint against the running build, so a pilot signed by a self-issued certificate is
    ///   still a signed build.
    /// - <b>Invalid</b> — a signature is present and does not verify (bad digest, malformed
    ///   signature, revoked or explicitly distrusted signer). The update is refused.
    ///
    /// Only the embedded signature is considered; catalog signing is not consulted, because a
    /// release zip carries no catalog.
    /// </summary>
    internal static AuthenticodeResult AuthenticodeOf(string path)
    {
        if (path.Length == 0 || !File.Exists(path))
        {
            return AuthenticodeResult.Unsigned;
        }

        bool hasSignature;
        try
        {
            hasSignature = HasEmbeddedSignature(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return AuthenticodeResult.Unsigned;
        }

        if (!hasSignature)
        {
            return AuthenticodeResult.Unsigned;
        }

        if (Classify(hasEmbeddedSignature: true, VerifyEmbeddedSignature(path)) != AuthenticodeStatus.Signed)
        {
            return AuthenticodeResult.Invalid;
        }

        try
        {
            // Reads the signer of the embedded PKCS#7 — the same signature WinVerifyTrust has just
            // verified. This is not a certificate-file load, so it is outside SYSLIB0057's scope;
            // the suppression only guards against a later SDK widening that obsoletion.
#pragma warning disable SYSLIB0057
            using var signer = X509Certificate.CreateFromSignedFile(path);
#pragma warning restore SYSLIB0057
            var thumbprint = signer.GetCertHashString();
            return string.IsNullOrEmpty(thumbprint)
                ? AuthenticodeResult.Invalid
                : AuthenticodeResult.Signed(thumbprint);
        }
        catch (Exception e) when (e is CryptographicException or IOException or UnauthorizedAccessException)
        {
            // It verified a moment ago and now its signer cannot be read: refuse, never "unsigned".
            return AuthenticodeResult.Invalid;
        }
    }

    /// <summary>
    /// Map a WinVerifyTrust result to an outcome. Pure, so the decision is testable without signing.
    ///
    /// Accepted as <see cref="AuthenticodeStatus.Signed"/>: success, and the chain-trust results
    /// that say only "this certificate does not lead to a root this machine trusts". WinVerifyTrust
    /// checks the signature against the file's digest before it evaluates the chain, so those
    /// results still mean the contents are intact. Everything else with a signature present — bad
    /// digest, malformed signature, revoked, explicitly distrusted, expired without a timestamp —
    /// is <see cref="AuthenticodeStatus.Invalid"/>. With no signature present, the result code is
    /// irrelevant: the file is unsigned.
    /// </summary>
    internal static AuthenticodeStatus Classify(bool hasEmbeddedSignature, int winVerifyTrustResult)
    {
        if (!hasEmbeddedSignature)
        {
            return AuthenticodeStatus.Unsigned;
        }

        return winVerifyTrustResult switch
        {
            0 => AuthenticodeStatus.Signed,
            CertEUntrustedRoot or CertEChaining or CertEUntrustedTestRoot => AuthenticodeStatus.Signed,
            _ => AuthenticodeStatus.Invalid,
        };
    }

    /// <summary>
    /// Whether the file is a PE image with a non-empty certificate table
    /// (IMAGE_DIRECTORY_ENTRY_SECURITY) — where an embedded Authenticode signature lives. Anything
    /// that is not a well-formed PE header reads as unsigned: a file that cannot hold an embedded
    /// signature does not have one.
    /// </summary>
    internal static bool HasEmbeddedSignature(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var reader = new BinaryReader(stream);
        try
        {
            if (stream.Length < 0x40 || reader.ReadUInt16() != 0x5A4D)
            {
                return false; // no "MZ"
            }

            stream.Position = 0x3C;
            var peOffset = reader.ReadInt32();
            if (peOffset <= 0 || peOffset > stream.Length - 24)
            {
                return false;
            }

            stream.Position = peOffset;
            if (reader.ReadUInt32() != 0x00004550)
            {
                return false; // no "PE\0\0"
            }

            var optionalHeader = peOffset + 4 + 20; // PE signature + COFF file header
            stream.Position = optionalHeader;
            int directoryCountOffset;
            int directoriesOffset;
            switch (reader.ReadUInt16())
            {
                case 0x10B: // PE32
                    directoryCountOffset = 92;
                    directoriesOffset = 96;
                    break;
                case 0x20B: // PE32+
                    directoryCountOffset = 108;
                    directoriesOffset = 112;
                    break;
                default:
                    return false;
            }

            const int securityDirectory = 4;
            stream.Position = optionalHeader + directoryCountOffset;
            if (reader.ReadUInt32() <= securityDirectory)
            {
                return false;
            }

            stream.Position = optionalHeader + directoriesOffset + (securityDirectory * 8);
            var offset = reader.ReadUInt32();
            var size = reader.ReadUInt32();
            return offset != 0 && size != 0;
        }
        catch (EndOfStreamException)
        {
            return false;
        }
    }

    private const int CertEUntrustedRoot = unchecked((int)0x800B0109);
    private const int CertEChaining = unchecked((int)0x800B010A);
    private const int CertEUntrustedTestRoot = unchecked((int)0x800B010D);

    /// <summary>WINTRUST_ACTION_GENERIC_VERIFY_V2 — the Authenticode policy provider.</summary>
    private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    /// <summary>
    /// WinVerifyTrust over the file's embedded signature: no UI, no revocation lookup, and URL
    /// retrieval restricted to the cache, so a verification can never hang on the network.
    /// </summary>
    private static int VerifyEmbeddedSignature(string path)
    {
        var pathPointer = Marshal.StringToHGlobalUni(path);
        var fileInfoPointer = IntPtr.Zero;
        try
        {
            var fileInfo = new WinTrustFileInfo
            {
                StructSize = (uint)Marshal.SizeOf<WinTrustFileInfo>(),
                FilePath = pathPointer,
            };
            fileInfoPointer = Marshal.AllocHGlobal(Marshal.SizeOf<WinTrustFileInfo>());
            Marshal.StructureToPtr(fileInfo, fileInfoPointer, false);

            var data = new WinTrustData
            {
                StructSize = (uint)Marshal.SizeOf<WinTrustData>(),
                UIChoice = WtdUINone,
                RevocationChecks = WtdRevokeNone,
                UnionChoice = WtdChoiceFile,
                FileInfo = fileInfoPointer,
                StateAction = WtdStateActionIgnore,
                ProvFlags = WtdCacheOnlyUrlRetrieval,
            };
            var action = GenericVerifyV2;
            return WinVerifyTrust(new IntPtr(-1), ref action, ref data);
        }
        finally
        {
            if (fileInfoPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(fileInfoPointer);
            }

            Marshal.FreeHGlobal(pathPointer);
        }
    }

    private const uint WtdUINone = 2;
    private const uint WtdRevokeNone = 0;
    private const uint WtdChoiceFile = 1;
    private const uint WtdStateActionIgnore = 0;
    private const uint WtdCacheOnlyUrlRetrieval = 0x00001000;

    [StructLayout(LayoutKind.Sequential)]
    internal struct WinTrustFileInfo
    {
        public uint StructSize;
        public IntPtr FilePath;
        public IntPtr File;
        public IntPtr KnownSubject;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct WinTrustData
    {
        public uint StructSize;
        public IntPtr PolicyCallbackData;
        public IntPtr SipClientData;
        public uint UIChoice;
        public uint RevocationChecks;
        public uint UnionChoice;
        public IntPtr FileInfo;
        public uint StateAction;
        public IntPtr StateData;
        public IntPtr UrlReference;
        public uint ProvFlags;
        public uint UIContext;
        public IntPtr SignatureSettings;
    }

    [DllImport("wintrust.dll", CharSet = CharSet.Unicode)]
    private static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref WinTrustData data);

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

internal enum AuthenticodeStatus
{
    /// <summary>No embedded signature at all.</summary>
    Unsigned,

    /// <summary>An embedded signature that verifies against the file's contents.</summary>
    Signed,

    /// <summary>A signature is present and does not verify. Never treated as unsigned.</summary>
    Invalid,
}

/// <summary>The outcome of checking a file's Authenticode signature. The thumbprint is set only when signed.</summary>
internal readonly record struct AuthenticodeResult(AuthenticodeStatus Status, string? Thumbprint)
{
    public static AuthenticodeResult Unsigned => new(AuthenticodeStatus.Unsigned, null);

    public static AuthenticodeResult Invalid => new(AuthenticodeStatus.Invalid, null);

    public static AuthenticodeResult Signed(string thumbprint) => new(AuthenticodeStatus.Signed, thumbprint);
}
