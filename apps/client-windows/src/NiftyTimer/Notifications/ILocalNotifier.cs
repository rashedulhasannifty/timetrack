namespace NiftyTimer.Notifications;

/// <summary>
/// The seam every local notification goes through. The Windows toast implementation lands in S4;
/// this interface exists now so <see cref="Tracking.ManualNudgeMonitor"/> can be written and tested
/// against it.
///
/// Notifications are always advisory. Nothing behind this interface may stop, start, or alter
/// tracking — a nudge that silently changed what was recorded would be the stealth behaviour
/// CLAUDE.md §1 rules out.
/// </summary>
public interface ILocalNotifier
{
    void Notify(string id, string title, string body);
}
