using NiftyTimer.Tracking;

namespace NiftyTimer.App;

/// <summary>
/// What the end of the Windows session — shut down, restart, signing out of Windows — does to a
/// running clock.
///
/// Before this, nothing: <see cref="AppDelegate.Dispose"/> does not close the live span, so
/// <c>live-span.json</c> survived the shutdown and the next morning opened on "Recover interrupted
/// time?" for a day that had ended normally — where Discard throws away the whole span, not just
/// the night. A shutdown is not an interruption; it is where the day ended.
///
/// Called from <c>NiftyTimerApp.OnSessionEnding</c>. WPF raises that on the UI thread, where
/// <see cref="TimeTracker"/> lives, and shuts the application down itself straight after, so the
/// work here must be synchronous. Closing a span is a local file write; the upload drains on the
/// next launch.
/// </summary>
public static class SessionEndClose
{
    /// <summary>
    /// Close a running span. Away time nobody has confirmed does not count, by the same rule as
    /// <see cref="ManualIdleMonitor.AwayLimit"/>: a span the person had walked away from stops where
    /// they left, and a prompt they came back to but never answered is answered with its default,
    /// Discard — keeping the time worked since they returned.
    /// </summary>
    public static void Apply(TimeTracker tracker, ManualIdleCoordinator? manual)
    {
        manual?.AnswerOpenPromptForSessionEnd();

        if (tracker.State is not TrackerState.Tracking)
        {
            return;
        }

        tracker.Stop(manual?.AwayStartOfLiveEntry);
    }
}
