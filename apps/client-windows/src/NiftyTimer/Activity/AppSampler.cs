using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using NiftyTimer.Policy;

namespace NiftyTimer.Activity;

/// <summary>
/// What one look at the foreground tells us. A plain carrier — no behaviour, no hardware.
/// </summary>
public sealed record AppSnapshot(string AppName, string? BundleId, string? WindowTitle);

/// <summary>The foreground-observation seam. Tests substitute a fake.</summary>
public interface IAppSampling
{
    Task<AppSnapshot> SampleAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Samples the foreground application and — only when the team policy allows it — its window
/// title.
///
/// **The <c>bundleId</c> convention is permanent, so it is worth stating plainly.**
/// <c>ObservedAppsSchema</c> surfaces whatever the client sends straight into the admin's rule
/// picker, so an inconsistent convention pollutes that picker forever and cannot be cleaned up
/// without touching every team's saved rules. This client sends **the lowercased executable
/// filename without its extension** — <c>code</c>, <c>chrome</c>, <c>devenv</c> — as
/// <c>bundleId</c>, and the executable's <c>FileDescription</c> (falling back to that same
/// filename) as <c>appName</c>. Full paths were rejected because they vary per machine and would
/// fragment the picker into one entry per install location; AUMIDs were rejected because most
/// Win32 applications have none.
///
/// The macOS client sends a reverse-DNS bundle id (<c>com.microsoft.VSCode</c>) for the same
/// application, so a mixed-platform team sees both forms in the picker. That is unavoidable
/// without a schema change, and harmless: <see cref="Categorizer"/> matches a rule against the
/// bundleId OR the display name, so a single rule on the display name covers both platforms.
///
/// Takes the <see cref="AckGate"/> and reads through it. The window title is the most
/// privacy-sensitive thing this client reads, so re-checking acknowledgement immediately before
/// the read — rather than relying on a check made further up the tick — is worth one extra policy
/// fetch per sample. The gate publishes the fetched policy to <see cref="LivePolicy"/> BEFORE
/// running the body, so <c>captureWindowTitles</c> is read from the very fetch that authorized
/// this read and cannot be a stale snapshot.
///
/// The title is never logged (CLAUDE.md §1 lists <c>windowTitle</c> in the redact set).
/// </summary>
public sealed class AppSampler : IAppSampling
{
    /// <summary>Server schema bound: <c>windowTitle: z.string().max(120)</c>.</summary>
    internal const int MaxTitleLength = 120;

    /// <summary>Server schema bound: <c>appName: z.string().max(200)</c>.</summary>
    internal const int MaxAppNameLength = 200;

    /// <summary>Server schema bound: <c>bundleId: z.string().max(255)</c>.</summary>
    internal const int MaxBundleIdLength = 255;

    /// <summary>What we report when the foreground cannot be identified — a locked session, a
    /// secure desktop, or a process we are not permitted to open. Never an empty string: the
    /// server requires an <c>appName</c>, and a sample that says "we were watching but could not
    /// tell" is more honest than no sample at all.</summary>
    internal const string UnknownApp = "Unknown";

    private readonly AckGate _ackGate;
    private readonly LivePolicy _livePolicy;
    private readonly Func<ForegroundProcess?> _readForeground;

    public AppSampler(AckGate ackGate, LivePolicy livePolicy, Func<ForegroundProcess?>? readForeground = null)
    {
        _ackGate = ackGate;
        _livePolicy = livePolicy;
        _readForeground = readForeground ?? ReadForegroundFromSystem;
    }

    public Task<AppSnapshot> SampleAsync(CancellationToken cancellationToken = default) =>
        _ackGate.WithCaptureAllowedAsync(
            _ =>
            {
                // Read AFTER the gate has published, so the flag comes from the same fetch that
                // authorized the read rather than from whatever was current a minute ago.
                var captureWindowTitles = _livePolicy.Current.CaptureWindowTitles;
                return Task.FromResult(Describe(_readForeground(), captureWindowTitles));
            },
            cancellationToken);

    /// <summary>
    /// Pure shaping of a raw foreground reading into the wire snapshot — truncation, the
    /// <c>bundleId</c> convention, and the title opt-out. Separated from the Win32 calls so all of
    /// it is unit-testable.
    /// </summary>
    internal static AppSnapshot Describe(ForegroundProcess? foreground, bool captureWindowTitles)
    {
        if (foreground is not { } process)
        {
            return new AppSnapshot(UnknownApp, null, null);
        }

        var stem = Path.GetFileNameWithoutExtension(process.ExecutablePath);
        if (string.IsNullOrWhiteSpace(stem))
        {
            return new AppSnapshot(UnknownApp, null, captureWindowTitles ? Truncate(process.WindowTitle, MaxTitleLength) : null);
        }

        var bundleId = Truncate(stem.ToLowerInvariant(), MaxBundleIdLength);
        var appName = Truncate(
            string.IsNullOrWhiteSpace(process.FileDescription) ? stem : process.FileDescription,
            MaxAppNameLength) ?? UnknownApp;

        // A policy that opts out of titles must yield an explicit null, not an empty string — the
        // server distinguishes "no title" from "a title that happens to be blank".
        var title = captureWindowTitles ? Truncate(process.WindowTitle, MaxTitleLength) : null;

        return new AppSnapshot(appName, bundleId, title);
    }

    private static string? Truncate(string? value, int max)
    {
        if (string.IsNullOrEmpty(value))
        {
            return null;
        }

        return value.Length <= max ? value : value[..max];
    }

    /// <summary>
    /// The raw reading, before any policy or truncation is applied. <c>WindowTitle</c> is captured
    /// unconditionally here and discarded in <see cref="Describe"/> when the policy says so —
    /// the alternative, branching inside the Win32 layer, is what makes the opt-out untestable.
    /// </summary>
    public sealed record ForegroundProcess(string ExecutablePath, string? FileDescription, string? WindowTitle);

    private static ForegroundProcess? ReadForegroundFromSystem()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
        {
            return null; // locked session, or the secure desktop has focus
        }

        _ = GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0)
        {
            return null;
        }

        var path = ExecutablePathOf(pid);
        if (path is null)
        {
            return null;
        }

        return new ForegroundProcess(path, FileDescriptionOf(path), WindowTitleOf(hwnd));
    }

    private static string? ExecutablePathOf(uint pid)
    {
        // QUERY_LIMITED_INFORMATION rather than QUERY_INFORMATION: it is the minimum that returns
        // an image path, and unlike the broader right it succeeds against processes running at a
        // higher integrity level, which is most of the interesting foreground on a managed laptop.
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, pid);
        if (handle == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            var buffer = new StringBuilder(1024);
            var size = (uint)buffer.Capacity;
            return QueryFullProcessImageName(handle, 0, buffer, ref size) ? buffer.ToString() : null;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private static string? FileDescriptionOf(string path)
    {
        try
        {
            return FileVersionInfo.GetVersionInfo(path).FileDescription;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException)
        {
            // An app with no version resource, or one we cannot read. The filename stem is a fine
            // display name and Describe falls back to it.
            return null;
        }
    }

    private static string? WindowTitleOf(IntPtr hwnd)
    {
        var length = GetWindowTextLength(hwnd);
        if (length <= 0)
        {
            return null;
        }

        var buffer = new StringBuilder(length + 1);
        return GetWindowText(hwnd, buffer, buffer.Capacity) > 0 ? buffer.ToString() : null;
    }

    private const int ProcessQueryLimitedInformation = 0x1000;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(int desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder exeName, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
