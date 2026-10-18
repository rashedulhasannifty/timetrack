using Microsoft.Win32;
using NiftyTimer.App;

namespace NiftyTimer.Policy;

/// <summary>
/// Where the login item currently stands, independent of the registry so the decision in
/// <see cref="LoginItemSync"/> is testable without touching the real machine.
///
/// None of these is macOS's <c>requiresApproval</c> — "registered once, then switched off by the
/// employee". Windows has no equivalent read: Task Manager records enable/disable in an
/// undocumented binary blob under <c>Explorer\StartupApproved\Run</c>, keyed by the value NAME,
/// and its absence is indistinguishable from never having registered. The same guarantee is
/// reached a different way — see <see cref="LoginItemSync"/>.
/// </summary>
public enum LoginItemStatus
{
    /// <summary>The value exists and launches this executable.</summary>
    Registered,

    NotRegistered,

    /// <summary>
    /// The value exists but launches some other path — a copy that was moved, or unzipped again
    /// into a different folder. Windows runs the missing path at login, fails, and says nothing.
    /// </summary>
    PointsElsewhere,
}

/// <summary>
/// The Windows login-item seam.
///
/// The app opens at login whatever the team's <c>autoStartOnLogin</c> says: that setting selects
/// the tracking MODE (automatic or manual), and a manual tracker that is not running cannot remind
/// anyone to start it. A value under <c>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</c> is the supported
/// per-user way and is deliberately VISIBLE: it appears in Task Manager › Startup apps, where the
/// employee can disable it, and in Settings › Apps › Startup. No service, no scheduled task, and
/// nothing running as SYSTEM (CLAUDE.md §1).
///
/// NOT a capture path — this only launches the app, it touches no hardware API — so it does not
/// route through <see cref="AckGate"/> and must not be made to.
/// </summary>
public interface ILoginItemControl
{
    LoginItemStatus Status { get; }

    /// <summary>Create the value, or overwrite one that launches a different path.</summary>
    void Register();
}

/// <summary>
/// The real thing: this process's own executable, under the current user's <c>Run</c> key.
///
/// The value NAME is variant-scoped through <see cref="AppInstall.LoginItemName"/>, exactly as the
/// state container and the token file are. A shared name would have a dev build and a released
/// install overwrite each other's entry on alternate launches, so whichever ran last would decide
/// which one starts at login.
/// </summary>
public sealed class RunKeyLoginItem : ILoginItemControl
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";

    private readonly string _valueName;
    private readonly string _command;

    public RunKeyLoginItem(string? appId, string? executablePath = null)
    {
        _valueName = AppInstall.LoginItemName(appId);

        // Quoted: Program Files paths contain spaces, and an unquoted command line would have
        // Windows try "C:\Program" first.
        var path = executablePath ?? Environment.ProcessPath ?? string.Empty;
        _command = $"\"{path}\"";
    }

    public LoginItemStatus Status
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            return StatusOf(key?.GetValue(_valueName) as string, _command);
        }
    }

    /// <summary>
    /// The pure half of <see cref="Status"/>. Paths on Windows are case-insensitive, so a value
    /// differing only in case still launches this executable and is left alone.
    /// </summary>
    internal static LoginItemStatus StatusOf(string? registeredCommand, string command)
    {
        if (registeredCommand is null)
        {
            return LoginItemStatus.NotRegistered;
        }

        return string.Equals(registeredCommand, command, StringComparison.OrdinalIgnoreCase)
            ? LoginItemStatus.Registered
            : LoginItemStatus.PointsElsewhere;
    }

    public void Register()
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath)
            ?? throw new InvalidOperationException("The Run key could not be opened.");
        key.SetValue(_valueName, _command, RegistryValueKind.String);
    }
}

/// <summary>
/// Makes sure this executable opens at login. Run on every launch that resolves a policy, so it is
/// idempotent by construction — "already registered" is the common case and costs nothing.
///
/// It does not consult <c>autoStartOnLogin</c>. Tying the login item to that setting meant a team
/// in the default, manual mode never had the app running after a restart: nobody was there to be
/// nudged into starting the clock, so the day simply went unrecorded.
///
/// What it deliberately does NOT do:
///
/// <list type="bullet">
/// <item><b>It never rewrites a value that already launches this executable.</b> This is how the
/// "don't fight the user" guarantee is reached without reading Task Manager's undocumented approval
/// blob: disabling a startup app there LEAVES the Run value in place and flips a bit stored under
/// the same value name elsewhere, so the disable survives every subsequent launch untouched.</item>
/// <item><b>It rewrites a value that launches a DIFFERENT path, and only that.</b> The app ships as
/// a zip; unzipping a new copy into another folder used to leave login pointing at the old one,
/// which Windows runs, fails to find, and reports nowhere. Rewriting the value's data keeps its
/// name, so a Task Manager disable — keyed by that name — still holds after the repair.</item>
/// <item><b>It cannot take effect on the login already in progress.</b> Registration only runs
/// while the app is open, so a new install starts at login from the employee's NEXT login.</item>
/// <item><b>It never blocks a launch.</b> A registry failure — a locked hive, group policy — leaves
/// the item as it was and reports <see cref="Outcome.Failed"/>. The employee can still open the app
/// and work.</item>
/// </list>
///
/// The one case genuinely weaker than macOS: an employee who DELETES the value by hand in regedit
/// leaves no trace to distinguish from never having registered, so the next launch recreates it.
/// Task Manager — the affordance people actually use — disables rather than deletes, and that is
/// respected.
/// </summary>
public static class LoginItemSync
{
    public enum Outcome
    {
        Unchanged,
        Registered,

        /// <summary>The value launched another path and now launches this one.</summary>
        Repaired,
        Failed,
    }

    public static Outcome Apply(ILoginItemControl item)
    {
        try
        {
            switch (item.Status)
            {
                case LoginItemStatus.Registered:
                    return Outcome.Unchanged;

                case LoginItemStatus.PointsElsewhere:
                    item.Register();
                    return Outcome.Repaired;

                default:
                    item.Register();
                    return Outcome.Registered;
            }
        }
        catch (Exception e) when (e is UnauthorizedAccessException
            or System.Security.SecurityException
            or IOException
            or InvalidOperationException)
        {
            return Outcome.Failed;
        }
    }
}
