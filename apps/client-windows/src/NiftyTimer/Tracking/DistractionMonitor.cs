using System.Globalization;
using NiftyTimer.Notifications;
using NiftyTimer.Policy;

namespace NiftyTimer.Tracking;

/// <summary>
/// The three admin-owned knobs behind the distraction nudge, read from the team policy
/// (<c>distractionAlertsEnabled</c> / <c>…ThresholdMinutes</c> / <c>…RepeatMinutes</c>). Clamped
/// here so a malformed policy can never turn the nudge into a per-sample alarm.
/// </summary>
public sealed record DistractionSettings
{
    /// <summary>No policy in hand — the server default is opt-in, so: silent.</summary>
    public static readonly DistractionSettings Off = new(false, 10, 5);

    public DistractionSettings(bool enabled, int thresholdMinutes, int repeatMinutes)
    {
        Enabled = enabled;
        ThresholdMinutes = Math.Max(1, thresholdMinutes);
        RepeatMinutes = Math.Max(0, repeatMinutes);
    }

    /// <summary>The team's master switch. Off ⇒ never nudge, whatever the app lists say.</summary>
    public bool Enabled { get; }

    /// <summary>Consecutive unproductive samples before the FIRST nudge of a streak.</summary>
    public int ThresholdMinutes { get; }

    /// <summary>Samples between re-nudges while the streak continues; <c>0</c> = once per streak.</summary>
    public int RepeatMinutes { get; }

    public static DistractionSettings From(PolicySettings settings) =>
        new(settings.DistractionAlertsEnabled, settings.DistractionThresholdMinutes, settings.DistractionRepeatMinutes);
}

/// <summary>
/// PRD §6.4 — the local distraction nudge (trust, not surveillance). Ported from the macOS client's
/// <c>DistractionMonitor</c>. A pure, timer-free decision unit fed one <see cref="Category"/> per
/// activity sample (~60s). It counts CONSECUTIVE <see cref="Category.Unproductive"/> samples and,
/// when the streak reaches the threshold, posts a local notification. Any other sample breaks the
/// streak and re-arms it.
///
/// NOTIFY-ONLY: no network, no disk, no logging, and no reference to the tracker. It sees a
/// category enum value and nothing else — never an app name, a window title, or key content
/// (CLAUDE.md §1).
///
/// With <c>RepeatMinutes</c> above zero an unbroken streak keeps reminding every N further samples
/// (threshold 10, repeat 5 → 10, 15, 20 …). A gentle recurring reminder, never a block.
///
/// Settings are read through a closure on EVERY tick, not captured at construction, so an admin's
/// edit reaches a running client on its next sample. Turning alerts off mid-streak drops the
/// streak, so re-enabling starts fresh rather than firing at once.
///
/// Threshold and repeat are counts of samples; with <see cref="Activity.ActivitySampler"/>'s 60s
/// window they are minutes. Change that interval and these bounds change meaning with it.
///
/// UI-thread-only, like the other monitors: the sampler's callback is marshalled before it lands.
/// </summary>
public sealed class DistractionMonitor
{
    /// <summary>
    /// The notification id. <see cref="LocalNotifier"/> exempts it from its repeat window: this
    /// monitor paces its own repeats from the team's policy, and a one-minute repeat an admin chose
    /// must not be swallowed by a five-minute backstop meant for monitors that re-arm by accident.
    /// </summary>
    public const string NotificationId = "distraction";

    private readonly ILocalNotifier _notifier;
    private readonly Func<DistractionSettings> _settings;
    private int _streak;
    private int? _lastFiredAt;

    public DistractionMonitor(ILocalNotifier notifier, Func<DistractionSettings> settings)
    {
        _notifier = notifier;
        _settings = settings;
    }

    public void Tick(Category category)
    {
        var policy = _settings();

        // Alerts off: no nudge, and no streak kept — re-enabling must not fire on the next sample
        // off the back of minutes counted while the team had the feature switched off.
        if (!policy.Enabled)
        {
            Stop();
            return;
        }

        if (category != Category.Unproductive)
        {
            _streak = 0;
            _lastFiredAt = null;
            return;
        }

        _streak++;

        // Already nudged this streak → only a repeat, and only if repeats are on. Otherwise the
        // first nudge waits for the threshold.
        var shouldFire = _lastFiredAt is { } last
            ? policy.RepeatMinutes > 0 && _streak - last >= policy.RepeatMinutes
            : _streak >= policy.ThresholdMinutes;

        if (!shouldFire)
        {
            return;
        }

        // The streak length, not the threshold — a repeat at 15 minutes must not claim 10.
        _notifier.Notify(
            NotificationId,
            "Time tracking",
            string.Create(CultureInfo.InvariantCulture, $"~{_streak} min on distracting apps or sites — refocus?"));
        _lastFiredAt = _streak;
    }

    /// <summary>
    /// Clear the streak and its fire history. Sign-out calls this so one person's streak never
    /// nudges the next person on the same machine.
    /// </summary>
    public void Stop()
    {
        _streak = 0;
        _lastFiredAt = null;
    }
}
