using Microsoft.Win32;
using NiftyTimer.App;

namespace NiftyTimer.Policy;

/// <summary>
/// Where the login item currently stands, independent of the registry so the decision in
/// <see cref="LoginItemSync"/> is testable without touching the real machine.
///
/// **Two states, where macOS has three.** <c>SMAppService</c> reports a distinct
/// <c>requiresApproval</c> — "registered once, then switched off by the employee" — and the macOS
/// client uses it to never re-register over the user's own choice. Windows has no equivalent read:
/// Task Manager records enable/disable in an undocumented binary blob under
/// <c>Explorer\StartupApproved\Run</c>, and its absence is indistinguishable from never having
/// registered. Rather than name a third case this platform cannot populate, the same guarantee is
/// reached a different way — see <see cref="LoginItemSync"/>.
/// </summary>
public enum LoginItemStatus
{
    Registered,
    NotRegistered,
}

/// <summary>
/// The Windows login-item seam.
///
/// <c>autoStartOnLogin</c> selects the tracking MODE, but a tray app cannot start tracking on a
/// machine that never opened it — so the team setting also has to make the app *be running* at
/// login. A value under <c>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</c> is the supported
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

    void Register();

    void Unregister();
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
            return key?.GetValue(_valueName) is null
                ? LoginItemStatus.NotRegistered
                : LoginItemStatus.Registered;
        }
    }

    public void Register()
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath)
            ?? throw new InvalidOperationException("The Run key could not be opened.");
        key.SetValue(_valueName, _command, RegistryValueKind.String);
    }

    public void Unregister()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
        key?.DeleteValue(_valueName, throwOnMissingValue: false);
    }
}

/// <summary>
/// Brings the machine's login item in line with the team policy. Run on every launch that resolves
/// a policy, so it is idempotent by construction — "already in the wanted state" is the common case
/// and costs nothing.
///
/// Three things it deliberately does NOT do:
///
/// <list type="bullet">
/// <item><b>It never rewrites a value that already exists.</b> This is how the "don't fight the
/// user" guarantee is reached without reading Task Manager's undocumented approval blob: disabling
/// a startup app there LEAVES the Run value in place and flips a bit elsewhere, so an existing
/// value means "already handled" and the disable survives every subsequent launch untouched.</item>
/// <item><b>It cannot take effect on the login already in progress.</b> Registration only runs
/// while the app is open, so an admin who flips the toggle today reaches the employee at their NEXT
/// login. Inherent to a login item; the dashboard copy says so.</item>
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
        Unregistered,
        Failed,
    }

    public static Outcome Apply(bool autoStartOnLogin, ILoginItemControl item)
    {
        try
        {
            if (autoStartOnLogin)
            {
                if (item.Status is LoginItemStatus.Registered)
                {
                    return Outcome.Unchanged;
                }

                item.Register();
                return Outcome.Registered;
            }

            if (item.Status is LoginItemStatus.NotRegistered)
            {
                return Outcome.Unchanged;
            }

            item.Unregister();
            return Outcome.Unregistered;
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
