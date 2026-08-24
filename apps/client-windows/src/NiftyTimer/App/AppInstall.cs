namespace NiftyTimer.App;

/// <summary>
/// Which install of the app this process is: the released build, or a side-by-side dev/staging
/// build carrying its own app id.
///
/// Everything the client persists is keyed off this — the %LOCALAPPDATA% container and the
/// name of the DPAPI-protected token file. Sharing the container between installs is not merely
/// untidy, it is LOSSY: both processes drain the same durable buffers (take → upload → remove),
/// so a dev build pointed at localhost would upload the released app's pending records to the
/// dev server and then delete them. Real recorded time, gone. This mirrors
/// <c>apps/client-macos/Sources/TimeTrack/App/AppInstall.swift</c>.
/// </summary>
public static class AppInstall
{
    /// <summary>
    /// Must match the default of APP_ID in scripts/package-app.ps1. If that default changes,
    /// change it here in the same commit or every released install silently re-homes its state.
    /// </summary>
    public const string ProductionAppId = "com.niftyitsolution.niftytimer";

    /// <summary>
    /// Null for the released install, a short tag otherwise.
    ///
    /// A checkout run with <c>dotnet run</c> has no packaged appsettings, so the app id is
    /// absent there. That is treated as a dev install rather than silently borrowing
    /// production's state — running from a checkout is the single most likely way to collide
    /// with a real install on the same machine.
    /// </summary>
    public static string? Variant(string? appId)
    {
        if (string.IsNullOrEmpty(appId))
        {
            return "dev";
        }

        if (appId == ProductionAppId)
        {
            return null;
        }

        // "com.niftyitsolution.niftytimer.dev" → "dev". An app id from somewhere else entirely
        // is used whole: still unique, which is the only thing that matters.
        var tail = appId.StartsWith(ProductionAppId + ".", StringComparison.Ordinal)
            ? appId[(ProductionAppId.Length + 1)..]
            : appId;
        return Sanitized(tail);
    }

    /// <summary>The folder under %LOCALAPPDATA%.</summary>
    public static string SupportDirectoryName(string? appId)
    {
        var variant = Variant(appId);
        return variant is null ? "NiftyTimer" : $"NiftyTimer-{variant}";
    }

    /// <summary>
    /// The file holding the DPAPI-protected refresh token. Shared between installs, a dev
    /// sign-in would overwrite the released app's token and sign the employee out of production.
    /// </summary>
    public static string TokenFileName(string? appId)
    {
        var variant = Variant(appId);
        return variant is null ? "refresh.bin" : $"refresh-{variant}.bin";
    }

    /// <summary>
    /// Whether this build is the released one. The self-updater is gated on it: a dev build
    /// swapping itself for the latest public release would destroy the very build under test.
    /// </summary>
    public static bool IsProduction(string? appId) => Variant(appId) is null;

    /// <summary>
    /// %LOCALAPPDATA%\&lt;container&gt;[\subpath] — the one place any store should ask for its
    /// directory.
    /// </summary>
    public static string SupportDirectory(string? appId, string? subpath = null)
    {
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            SupportDirectoryName(appId));
        return subpath is null ? root : Path.Combine(root, subpath);
    }

    /// <summary>
    /// A folder name, so anything that could split a path is folded away. App ids do not
    /// contain these in practice; this is here so a typo cannot escape the container.
    /// </summary>
    private static string Sanitized(string s)
    {
        var chars = s.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (chars[i] is '/' or '\\' or ':')
            {
                chars[i] = '-';
            }
        }

        return new string(chars);
    }
}
