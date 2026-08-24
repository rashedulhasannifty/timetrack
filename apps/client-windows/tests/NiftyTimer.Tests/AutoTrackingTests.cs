using System.Text;
using System.Text.Json;
using NiftyTimer.App;
using NiftyTimer.Storage;
using NiftyTimer.Sync;
using NiftyTimer.Tests.Support;
using NiftyTimer.Tracking;
using Xunit;

namespace NiftyTimer.Tests;

/// <summary>
/// The coordinator that turns idle decisions into TimeEntry and IdleEvent writes in auto mode.
/// </summary>
public class AutoTrackingCoordinatorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private sealed class Harness
    {
        public DateTimeOffset Now = T0;

        public BufferSpy Buffer { get; } = new();

        public TimeTracker Tracker { get; private set; } = null!;

        public AutoTrackingCoordinator Coordinator { get; private set; } = null!;

        public TimeTracker.Selection Selection { get; set; } = new("p1", "t1");

        public List<int> Prompts { get; } = [];

        public List<int> IdleNudges { get; } = [];

        public Action<AwayResolution>? Resolve { get; private set; }

        public static Harness Build()
        {
            var h = new Harness();
            var n = 0;
            h.Tracker = new TimeTracker(h.Buffer, () => h.Now, _ => $"entry-{++n}");
            var m = 0;
            h.Coordinator = new AutoTrackingCoordinator(
                h.Tracker,
                h.Buffer,
                thresholdSeconds: 300,
                currentSelection: () => h.Selection,
                presentAwayPrompt: (minutes, resolve) =>
                {
                    h.Prompts.Add(minutes);
                    h.Resolve = resolve;
                },
                clock: () => h.Now,
                idGen: _ => $"idle-{++m}",
                onIdleThresholdCrossed: seconds => h.IdleNudges.Add(seconds));
            return h;
        }

        public IReadOnlyList<IdleEventPayload> IdleEvents() => Buffer.Entries
            .Where(e => e.Kind == BufferKind.IdleEvent)
            .Select(e => JsonSerializer.Deserialize<IdleEventPayload>(e.Payload)!)
            .ToList();

        public IReadOnlyList<TimeEntryPayload> TimeEntries() => Buffer.Entries
            .Where(e => e.Kind == BufferKind.TimeEntry)
            .Select(e => JsonSerializer.Deserialize<TimeEntryPayload>(e.Payload)!)
            .ToList();
    }

    [Fact]
    public void ActivatingOpensAnAutoSpanUnderTheCurrentSelection()
    {
        var h = Harness.Build();

        h.Coordinator.Activate();

        var tracking = Assert.IsType<TrackerState.Tracking>(h.Tracker.State);
        Assert.Equal(TimeTracker.EntrySource.Auto, tracking.Source);
        Assert.Equal("p1", tracking.Selection.ProjectId);
        Assert.Equal("t1", tracking.Selection.TaskId);
    }

    [Fact]
    public void GoingIdleClosesTheAutoSpanAtTheAwayStart()
    {
        var h = Harness.Build();
        h.Coordinator.Activate();

        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600); // away since 09:20

        var entry = Assert.Single(h.TimeEntries());
        Assert.Equal("2026-08-25T09:00:00Z", entry.StartTime);
        Assert.Equal("2026-08-25T09:20:00Z", entry.EndTime);
        Assert.Equal("AUTO", entry.Source);
        Assert.Equal(600, Assert.Single(h.IdleNudges));
    }

    [Fact]
    public void KeepBridgesTheAwayWindowAsItsOwnAutoEntryAndReopens()
    {
        var h = Harness.Build();
        h.Coordinator.Activate();
        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600);
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0);

        h.Resolve!(AwayResolution.Keep);

        var entries = h.TimeEntries();
        Assert.Equal(2, entries.Count);

        var bridge = entries[1];
        Assert.Equal("2026-08-25T09:20:00Z", bridge.StartTime);
        Assert.Equal("2026-08-25T09:40:00Z", bridge.EndTime);
        Assert.Equal("AUTO", bridge.Source);

        Assert.Equal("KEPT", Assert.Single(h.IdleEvents()).ResolvedAction);
        Assert.IsType<TrackerState.Tracking>(h.Tracker.State); // a fresh span is open again
    }

    [Fact]
    public void DiscardWritesNoBridgeButStillRecordsTheDecision()
    {
        var h = Harness.Build();
        h.Coordinator.Activate();
        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600);
        h.Now = T0.AddMinutes(40);
        h.Coordinator.Tick(0);

        h.Resolve!(AwayResolution.Discard);

        Assert.Single(h.TimeEntries()); // just the closed span; no bridge
        Assert.Equal("DISCARDED", Assert.Single(h.IdleEvents()).ResolvedAction);
    }

    [Fact]
    public void DeactivatingMidAwayRecordsUnresolved()
    {
        var h = Harness.Build();
        h.Coordinator.Activate();
        h.Now = T0.AddMinutes(30);
        h.Coordinator.Tick(600);

        h.Now = T0.AddMinutes(50);
        h.Coordinator.Deactivate();

        var idle = Assert.Single(h.IdleEvents());
        Assert.Equal("UNRESOLVED", idle.ResolvedAction);
        Assert.Equal("2026-08-25T09:20:00Z", idle.StartTime);
        Assert.Equal("2026-08-25T09:50:00Z", idle.EndTime);
    }

    /// <summary>
    /// The core boundary between the two modes: a manually started entry is the user's own action,
    /// so the auto layer stands down entirely for its duration. Not by checking a flag at the point
    /// of stopping, but by refusing the signal at the edge — so there is no away cycle to go wrong.
    /// </summary>
    [Fact]
    public void TheAutoLayerStandsDownDuringAManualSpan()
    {
        var h = Harness.Build();
        h.Coordinator.Activate();
        h.Tracker.Stop();
        h.Tracker.Start("p2", null); // MANUAL

        h.Now = T0.AddMinutes(60);
        h.Coordinator.Tick(9999);
        h.Coordinator.MarkAway();

        Assert.IsType<TrackerState.Tracking>(h.Tracker.State); // still running
        Assert.Empty(h.IdleEvents());
        Assert.Empty(h.Prompts);
    }

    /// <summary>
    /// Paused counts as a manual session. Without this an away→resume cycle could resolve and open
    /// an AUTO entry straight over the paused state — Start only guards against a second start
    /// while already tracking, not against starting while paused.
    /// </summary>
    [Fact]
    public void TheAutoLayerStandsDownWhilePaused()
    {
        var h = Harness.Build();
        h.Coordinator.Activate();
        h.Tracker.Stop();
        h.Tracker.Start("p2", null);
        h.Tracker.Pause();

        h.Coordinator.Tick(9999);
        h.Coordinator.MarkAway();
        h.Coordinator.Resume();

        Assert.IsType<TrackerState.Paused>(h.Tracker.State);
        Assert.Empty(h.IdleEvents());
    }

    /// <summary>
    /// Sleep and lock skip the idle nudge: the person did not drift off, they shut the lid. Telling
    /// them they have been idle is noise about something they just did on purpose.
    /// </summary>
    [Fact]
    public void SleepAndLockDoNotFireTheIdleNudge()
    {
        var h = Harness.Build();
        h.Coordinator.Activate();

        h.Coordinator.MarkAway();

        Assert.Single(h.TimeEntries()); // the span still closed
        Assert.Empty(h.IdleNudges);
    }

    [Fact]
    public void ThePromptIsToldWholeMinutesAndNeverZero()
    {
        var h = Harness.Build();
        h.Coordinator.Activate();
        h.Now = T0.AddSeconds(310);
        h.Coordinator.Tick(310);
        h.Now = T0.AddSeconds(320);
        h.Coordinator.Tick(0);

        Assert.Equal(5, Assert.Single(h.Prompts)); // 320s ≈ 5 min
    }
}

/// <summary>
/// The IdleEvent wire shape. Mirrors <c>IdleEventSchema</c>; bodies are parsed in Zod strict mode,
/// so the field set is exact.
/// </summary>
public class IdleEventPayloadTests
{
    private static readonly DateTimeOffset T0 = new(2026, 8, 25, 9, 0, 0, TimeSpan.Zero);

    private static string Json(ResolvedAction action, DateTimeOffset? to = null)
    {
        var buffer = new BufferSpy();
        IdleEventEnqueuer.Enqueue(buffer, "idle-1", T0, to ?? T0.AddMinutes(20), action);
        return Encoding.UTF8.GetString(Assert.Single(buffer.Entries).Payload);
    }

    [Fact]
    public void CarriesExactlyTheFourContractFields()
    {
        using var document = JsonDocument.Parse(Json(ResolvedAction.Kept));

        var names = document.RootElement.EnumerateObject().Select(p => p.Name).ToList();
        Assert.Equal(["id", "startTime", "endTime", "resolvedAction"], names);
    }

    /// <summary>
    /// The server's enum is uppercase. Serializing the C# enum name instead would produce "Kept",
    /// which is a 422 — and a 422 classifies as permanent, so the record would be silently dropped
    /// rather than retried. Every away window would vanish and nothing would look broken.
    /// </summary>
    [Theory]
    [InlineData(ResolvedAction.Kept, "KEPT")]
    [InlineData(ResolvedAction.Discarded, "DISCARDED")]
    [InlineData(ResolvedAction.Unresolved, "UNRESOLVED")]
    public void UsesTheServersUppercaseTokens(ResolvedAction action, string expected)
    {
        Assert.Contains($"\"resolvedAction\":\"{expected}\"", Json(action), StringComparison.Ordinal);
    }

    [Fact]
    public void FormatsInstantsAsInternetDateTime()
    {
        var json = Json(ResolvedAction.Kept);

        Assert.Contains("\"startTime\":\"2026-08-25T09:00:00Z\"", json, StringComparison.Ordinal);
        Assert.Contains("\"endTime\":\"2026-08-25T09:20:00Z\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public void IsBufferedAsAnIdleEventNotATimeEntry()
    {
        var buffer = new BufferSpy();

        IdleEventEnqueuer.Enqueue(buffer, "idle-1", T0, T0.AddMinutes(5), ResolvedAction.Kept);

        Assert.Equal(BufferKind.IdleEvent, Assert.Single(buffer.Entries).Kind);
    }

    /// <summary>
    /// A backwards clock step must not produce an inverted window: the server 422s it, which is
    /// permanent, so the record would be dropped rather than retried.
    /// </summary>
    [Fact]
    public void ClampsAnInvertedWindowRatherThanEmittingIt()
    {
        var json = Json(ResolvedAction.Unresolved, T0.AddMinutes(-10));

        Assert.Contains("\"startTime\":\"2026-08-25T09:00:00Z\"", json, StringComparison.Ordinal);
        Assert.Contains("\"endTime\":\"2026-08-25T09:00:00Z\"", json, StringComparison.Ordinal);
    }
}
