using Microsoft.Win32;

namespace NiftyTimer.Notifications;

/// <summary>
/// Whether Windows will show this client's notifications at all — the counterpart of the macOS
/// client's "notifications not authorized" check.
///
/// Reads the global "Get notifications from apps and other senders" switch: the <c>ToastEnabled</c>
/// DWORD under <c>HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications</c>, which is 0
/// when the person has turned notifications off. With it off, the tray balloons this client sends
/// are dropped without a trace.
///
/// Absent means never changed, and the default is on. Anything unreadable counts as on too: the
/// fallback card exists so a nudge is not LOST, and guessing "off" would double every nudge on a
/// machine where the balloon was going to show anyway.
///
/// Deliberately not Focus Assist / Do Not Disturb. That is the person asking for quiet, and a card
/// on top of their presentation would be the opposite of what they asked for — nor do macOS's
/// Focus modes trigger the Mac fallback.
/// </summary>
public static class SystemNotifications
{
    private const string PushNotificationsKey =
        @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\PushNotifications";

    public static bool AreEnabled()
    {
        try
        {
            return Resolve(Registry.GetValue(PushNotificationsKey, "ToastEnabled", null) as int?);
        }
        catch (Exception e) when (e is System.Security.SecurityException or IOException or UnauthorizedAccessException)
        {
            return true;
        }
    }

    /// <summary>Only an explicit 0 means off.</summary>
    internal static bool Resolve(int? toastEnabled) => toastEnabled != 0;
}
