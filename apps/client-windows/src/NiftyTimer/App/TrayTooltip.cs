namespace NiftyTimer.App;

/// <summary>
/// The tray tooltip, and its warning precedence. The Windows counterpart of the macOS
/// <c>StatusItemController.tooltip</c> ladder, which the menu bar pairs with a ⚠ marker.
///
/// Warnings ride the tooltip rather than the icon: the icon carries one meaning — whether the clock
/// is running — and overloading it would make the always-visible indicator ambiguous about the
/// thing it exists to show. Most actionable first; Windows has only two of the Mac's four states,
/// because it has no Screen Recording or Automation permission to lose.
///
/// Pure, so the ordering is testable without a shell. Kept well under the 127 characters
/// <c>Shell_NotifyIcon</c> keeps.
/// </summary>
public static class TrayTooltip
{
    public static string For(bool isTracking, string elapsedLabel, bool liveSyncBlocked, bool updateOverdue)
    {
        var status = isTracking ? $"Nifty Timer — tracking {elapsedLabel}" : "Nifty Timer — not tracking";

        // Above the update: that one is advisory, this one means the time being tracked right now
        // is not showing up where anyone can see it.
        if (liveSyncBlocked)
        {
            return $"⚠ {status}\nNot reaching the server — still recorded locally";
        }

        if (updateOverdue)
        {
            return $"⚠ {status}\nAn update is available — open the menu";
        }

        return status;
    }
}
