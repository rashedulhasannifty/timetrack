namespace NiftyTimer.Tracking;

/// <summary>What the user chose for an away window (or an interrupted span). PRD §6.1.</summary>
public enum AwayResolution
{
    Keep,
    Discard,
}

/// <summary>
/// How an away duration is described to the user. Rounds to whole minutes and never says zero — a
/// prompt asking about "0 minutes" reads as a bug, and the window is real however short it is.
/// </summary>
public static class AwayMinutes
{
    public static int Of(int seconds) => Math.Max(1, (int)Math.Round(seconds / 60.0, MidpointRounding.AwayFromZero));
}

/// <summary>
/// The state shared by <see cref="IdleMonitor"/> and <see cref="ManualIdleMonitor"/>. Closed
/// hierarchy — no other cases exist. Records, so equality is by value and tests can assert on
/// state directly.
///
/// <c>Away</c> means input demonstrably stopped at <c>Since</c>; <c>Awaiting</c> means the person
/// came back at <c>Until</c> and the keep/discard question is outstanding.
/// </summary>
public abstract record IdleState
{
    private IdleState()
    {
    }

    public static IdleState Inactive { get; } = new InactiveState();

    public static IdleState Active { get; } = new ActiveState();

    public sealed record InactiveState : IdleState;

    public sealed record ActiveState : IdleState;

    public sealed record Away(DateTimeOffset Since) : IdleState;

    public sealed record Awaiting(DateTimeOffset Since, DateTimeOffset Until) : IdleState;
}
