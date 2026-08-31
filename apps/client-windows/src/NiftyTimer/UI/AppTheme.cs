using Microsoft.Win32;

namespace NiftyTimer.UI;

/// <summary>Which appearance the shell is using.</summary>
public enum AppTheme
{
    Light,
    Dark,
}

/// <summary>
/// Reads the shell's app appearance. Split from <see cref="ThemeWatcher"/> so the tri-state
/// reading — and specifically what an ABSENT value means — is testable without a registry.
/// </summary>
public static class ThemeResolver
{
    private const string PersonalizeKey =
        @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

    /// <summary>
    /// 1 is light, 0 is dark. Anything else — including the value being absent, which is the case
    /// on an install that has never opened the personalisation page — is light, because light is
    /// the Windows default and guessing dark would paint the app against a light desktop.
    /// </summary>
    public static AppTheme Resolve(int? appsUseLightTheme) =>
        appsUseLightTheme == 0 ? AppTheme.Dark : AppTheme.Light;

    public static AppTheme FromRegistry() =>
        Resolve(Registry.GetValue(PersonalizeKey, "AppsUseLightTheme", null) as int?);
}
