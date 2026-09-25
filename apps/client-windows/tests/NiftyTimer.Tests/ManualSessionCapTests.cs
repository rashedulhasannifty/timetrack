using System.Reflection;
using System.Text.Json;
using NiftyTimer.App;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The hole this closes: <see cref="ManualIdleMonitor"/> reads <c>GetLastInputInfo</c>, so it is
/// installed only inside the ack gate on the live-policy branch. A session where the policy fetch
/// never succeeds enables manual tracking (the stored ack marker allows it) and installs no idle
/// detection at all — and a forgotten timer is unbounded again, which is the 700-minute day.
/// </summary>
public class ManualSessionCapTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);
    private const int TwelveHours = 12 * 60 * 60;

    private sealed class Harness
    {
        public DateTimeOffset Now = T0;

        public BufferSpy Buffer { get; } = new();

        public TimeTracker Tracker { get; private set; } = null!;

        public ManualSessionCap Cap { get; private set; } = null!;

        public int Stops { get; private set; }

        public static Harness Build()
        {
            var h = new Harness();
            var n = 0;
            h.Tracker = new TimeTracker(h.Buffer, () => h.Now, _ => $"entry-{++n}");
            h.Cap = new ManualSessionCap(
                h.Tracker,
                TwelveHours,
                clock: () => h.Now,
                onTrackingStopped: () => h.Stops++);
            return h;
        }

        public IReadOnlyList<BufferKind> Kinds() => Buffer.Entries.Select(e => e.Kind).ToList();
    }

    private static IReadOnlyList<TimeEntryPayload> TimeEntries(Harness h) => h.Buffer.Entries
        .Where(e => e.Kind == BufferKind.TimeEntry)
        .Select(e => JsonSerializer.Deserialize<TimeEntryPayload>(e.Payload)!)
        .ToList();

    [Fact]
    public void AnEntryUnderTheCapIsLeftAlone()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);

        h.Now = T0.AddSeconds(TwelveHours - 1);
        h.Cap.Fire();

        Assert.IsType<TrackerState.Tracking>(h.Tracker.State); // a working day is not to be cut short
        Assert.Empty(TimeEntries(h));
        Assert.Equal(0, h.Stops);
    }

    [Fact]
    public void AnEntryAtTheCapIsClosedAtTheDeadline()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", "t1");

        h.Now = T0.AddSeconds(TwelveHours);
        h.Cap.Fire();

        Assert.Equal(TrackerState.Idle, h.Tracker.State);
        var closed = Assert.Single(TimeEntries(h));
        Assert.Equal("2026-08-25T09:00:00Z", closed.StartTime);
        Assert.Equal("2026-08-25T21:00:00Z", closed.EndTime);
        Assert.Equal(1, h.Stops); // the tray cannot see a stop performed on the tracker
    }

    /// <summary>
    /// The whole point of a deadline rather than "stop now": a PC asleep from hour three to hour
    /// twenty wakes to a single very late tick. Closing at <c>now</c> would hand the timesheet the
    /// twenty-hour span this type exists to prevent.
    /// </summary>
    [Fact]
    public void ALateTickStillClosesAtTheDeadlineNotAtNow()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);

        h.Now = T0.AddHours(20); // noticed eight hours late
        h.Cap.Fire();

        Assert.Equal("2026-08-25T21:00:00Z", Assert.Single(TimeEntries(h)).EndTime);
    }

    /// <summary>
    /// No idle window is written. <see cref="ManualIdleMonitor"/> can say when input stopped
    /// because it was watching; this type was not, so it makes no claim about where the person was.
    /// </summary>
    [Fact]
    public void NoIdleWindowIsInvented()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);

        h.Now = T0.AddSeconds(TwelveHours);
        h.Cap.Fire();

        Assert.All(h.Kinds(), kind => Assert.Equal(BufferKind.TimeEntry, kind));
    }

    /// <summary>
    /// An AUTO span is the auto layer's to close, on its own terms — and it only exists when the
    /// gate opened, which is the case where this type is redundant anyway.
    /// </summary>
    [Fact]
    public void AnAutoSessionIsIgnored()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null, source: TimeTracker.EntrySource.Auto);

        h.Now = T0.AddHours(24);
        h.Cap.Fire();

        Assert.IsType<TrackerState.Tracking>(h.Tracker.State);
    }

    [Fact]
    public void NothingRunningIsANoOp()
    {
        var h = Harness.Build();

        h.Now = T0.AddHours(24);
        h.Cap.Fire();

        Assert.Equal(TrackerState.Idle, h.Tracker.State);
        Assert.Empty(h.Buffer.Entries);
        Assert.Equal(0, h.Stops);
    }

    /// <summary>
    /// A paused session is a break the person already took; the tracker is not tracking, so there
    /// is no open span to cap.
    /// </summary>
    [Fact]
    public void APausedSessionIsIgnored()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Tracker.Pause();

        h.Now = T0.AddHours(24);
        h.Cap.Fire();

        Assert.IsType<TrackerState.Paused>(h.Tracker.State);
        Assert.Single(TimeEntries(h)); // only the span the pause closed
    }

    /// <summary>
    /// The cap is a property of the entry, not of the day: whatever they start next gets its own
    /// twelve hours rather than inheriting the first one's.
    /// </summary>
    [Fact]
    public void TheNextEntryGetsItsOwnTwelveHours()
    {
        var h = Harness.Build();
        h.Tracker.Start("p1", null);
        h.Now = T0.AddSeconds(TwelveHours);
        h.Cap.Fire();
        Assert.Equal(TrackerState.Idle, h.Tracker.State);

        h.Tracker.Start("p2", null);
        h.Now = T0.AddSeconds((2 * TwelveHours) - 1);
        h.Cap.Fire();
        Assert.IsType<TrackerState.Tracking>(h.Tracker.State); // the second entry measures its own age

        h.Now = T0.AddSeconds(2 * TwelveHours);
        h.Cap.Fire();
        Assert.Equal(TrackerState.Idle, h.Tracker.State);
        Assert.Equal(2, TimeEntries(h).Count);
    }
}

/// <summary>
/// Testing the decider alone would not cover the hole this closes, which is about WHERE the cap
/// gets installed. It has to be on the path an offline launch takes, or the one session that
/// actually needs it is the one session without it.
///
/// Companion to <see cref="OfflineCaptureUnreachableTests"/>, which asserts the opposite for
/// capture installers. Both can hold at once precisely because the cap observes nothing: it reads
/// the tracker and the clock, never the person.
/// </summary>
public class ManualSessionCapWiringTests
{
    private static MethodInfo Method(string name) =>
        typeof(AppDelegate).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)
        ?? throw new InvalidOperationException(
            $"AppDelegate.{name} is gone. If it was renamed, rename it here too — do not delete the guard.");

    [Fact]
    public void TheOfflineBranchReachesBecomeReady()
    {
        Assert.True(
            Calls(Method("ProceedOffline"), "BecomeReady"),
            "ProceedOffline no longer reaches BecomeReady, so the assertion below is checking the " +
            "wrong path.");
    }

    [Fact]
    public void BecomeReadyInstallsTheManualSessionCap()
    {
        Assert.True(
            Calls(Method("BecomeReady"), "InstallManualSessionCap"),
            "BecomeReady no longer installs ManualSessionCap. A launch whose policy fetch never " +
            "succeeds installs no idle detection at all, so without the cap a manual timer nobody " +
            "stops runs until the app is quit — the 700-minute day.");
    }

    /// <summary>
    /// The walk must be able to resolve SOMETHING, or the assertions above pass for the wrong
    /// reason on any future change that breaks token resolution.
    /// </summary>
    [Fact]
    public void TheReachabilityWalkIsNotVacuous()
    {
        Assert.False(Calls(Method("BecomeReady"), "AMethodNameThatCannotExist"));
        Assert.True(Calls(Method("BecomeReady"), "RecoverLiveSpanIfNeeded"));
    }

    /// <summary>
    /// Resolve every <c>call</c>/<c>callvirt</c> token in a method body and look for a name. A
    /// linear scan, not a decoder, so a byte that merely looks like an opcode is skipped.
    /// </summary>
    private static bool Calls(MethodInfo method, string methodName)
    {
        var il = method.GetMethodBody()?.GetILAsByteArray();
        if (il is null)
        {
            return false;
        }

        for (var i = 0; i < il.Length - 4; i++)
        {
            if (il[i] is not (0x28 or 0x6F))
            {
                continue;
            }

            try
            {
                if (method.Module.ResolveMethod(BitConverter.ToInt32(il, i + 1))?.Name == methodName)
                {
                    return true;
                }
            }
            catch (Exception e) when (e is ArgumentException or BadImageFormatException)
            {
                // A byte that merely looked like an opcode.
            }
        }

        return false;
    }
}
