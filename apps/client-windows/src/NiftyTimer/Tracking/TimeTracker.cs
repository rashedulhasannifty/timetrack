using NiftyTimer.Storage;
using NiftyTimer.Sync;

namespace NiftyTimer.Tracking;

/// <summary>
/// PRD §6.1 — manual time tracking. Each contiguous span is one TimeEntry keyed by a
/// client-minted UUIDv7. Pause = close the current entry; Resume = open a new one (the data model
/// is one startTime/endTime per entry, so paused time is simply excluded). <c>clock</c>/
/// <c>idGen</c> are injected for deterministic tests. This unit is UI-free and network-free; the
/// completed entry is enqueued to the durable buffer and the sync engine takes it from there.
///
/// Not a capture path: manual tracking does NOT route through <see cref="Policy.AckGate"/>
/// (CLAUDE.md §1) — readiness is enforced upstream in <see cref="App.MenuViewModel"/>.
///
/// UI-thread-only, like the Swift original.
/// </summary>
public sealed class TimeTracker
{
    private readonly ITimeEntryBuffer _buffer;
    private readonly ILiveSpanRecorder _liveSpan;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Func<DateTimeOffset, string> _idGen;

    public TimeTracker(
        ITimeEntryBuffer buffer,
        Func<DateTimeOffset>? clock = null,
        Func<DateTimeOffset, string>? idGen = null,
        ILiveSpanRecorder? liveSpan = null)
    {
        _buffer = buffer;
        _liveSpan = liveSpan ?? new NoopLiveSpan();
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _idGen = idGen ?? (now => UuidV7.Generate(now));
    }

    public enum EntrySource
    {
        Manual,
        Auto,
    }

    /// <summary>What the person says they were doing. Free text, theirs, and optional.</summary>
    public sealed record Selection(string? ProjectId, string? TaskId, string? Note = null);

    /// <summary>
    /// Observer of each closed span. Invoked after the entry is enqueued, on the calling
    /// (UI) thread.
    ///
    /// Carries the whole span, not just its bounds, because the close has to be publishable: the
    /// server's one-running-entry index is only released when it hears the entry ended, and every
    /// close here is immediately followed by an open (project switch, resume, away resolution).
    /// </summary>
    public event Action<ClosedSpan>? SpanClosed;

    /// <summary>
    /// Observer of each span OPENING — this is what drives the live publish so the dashboard
    /// shows time accruing rather than only appearing on Stop.
    /// </summary>
    public event Action<string, DateTimeOffset, Selection, EntrySource>? SpanOpened;

    public TrackerState State { get; private set; } = TrackerState.Idle;

    public bool IsRunning => State is TrackerState.Tracking;

    public bool IsPaused => State is TrackerState.Paused;

    public void Start(string? projectId, string? taskId, string? note = null, EntrySource source = EntrySource.Manual)
    {
        if (State is TrackerState.Tracking)
        {
            return; // Already tracking — ignore a second start.
        }

        Open(new Selection(projectId, taskId, note), source);
    }

    /// <summary>
    /// Close the current entry. <paramref name="endTime"/> backdates the close (idle/sleep
    /// detected earlier); defaults to now. Manual Stop passes null; auto-stop passes the
    /// away-start.
    /// </summary>
    public void Stop(DateTimeOffset? endTime = null)
    {
        Close(endTime ?? _clock());
        State = TrackerState.Idle;
    }

    public void Pause()
    {
        if (State is not TrackerState.Tracking tracking)
        {
            return;
        }

        Close(_clock());
        State = new TrackerState.Paused(tracking.Selection);
    }

    /// <summary>
    /// Replace the selection a PAUSED session will resume under. <see cref="Resume"/> reopens
    /// from the selection stored in the paused state, so a project switch made while paused would
    /// otherwise be silently discarded on resume. No-op unless paused; never touches a running
    /// span.
    /// </summary>
    public void Reselect(Selection selection)
    {
        if (State is TrackerState.Paused)
        {
            State = new TrackerState.Paused(selection);
        }
    }

    public void Resume()
    {
        if (State is TrackerState.Paused paused)
        {
            Open(paused.Selection, EntrySource.Manual); // pause/resume is a manual-only affordance
        }
    }

    /// <summary>
    /// Replace the note on the RUNNING span, in place.
    ///
    /// Unlike a project switch this does NOT close and reopen the entry: the note describes what
    /// the person was doing, it does not re-attribute the time, so splitting the span at the
    /// moment they finished typing would produce two entries for one stretch of work. No-op
    /// unless tracking.
    /// </summary>
    public void SetNote(string? note)
    {
        if (State is TrackerState.Tracking tracking)
        {
            State = tracking with
            {
                Selection = tracking.Selection with { Note = note },
            };
        }
    }

    /// <summary>
    /// Enqueue one already-complete entry without touching the live state. Used for the
    /// Keep-from-idle bridge span (PRD §6.1), where the away window becomes its own AUTO entry,
    /// and by crash recovery to bank an interrupted span.
    ///
    /// Deliberately does NOT touch the live-span record. The span it writes is already closed, so
    /// there is nothing to protect against a crash; and recovery calls this while its own span is
    /// still on disk, so clearing here would race the caller's own Clear().
    /// </summary>
    public void RecordSpan(
        DateTimeOffset start,
        DateTimeOffset end,
        string? projectId,
        string? taskId,
        EntrySource source,
        string? note = null,
        string? id = null)
    {
        var entryId = id ?? _idGen(start);
        Enqueue(entryId, projectId, taskId, start, end, source, note);
        SpanClosed?.Invoke(
            new ClosedSpan(entryId, start, end, new Selection(projectId, taskId, note), source));
    }

    /// <summary>
    /// Abandon the span with this id WITHOUT recording it — the server refused to open it because
    /// another machine already holds the one-running-entry index (409). Nothing is enqueued: the
    /// index is held by the other machine's entry, so a zero-duration row here would be a
    /// fabricated record serving no purpose.
    ///
    /// Scoped to the id on purpose. The 409 arrives asynchronously, and a span can be superseded
    /// before the answer lands (switching project while tracking closes one span and opens
    /// another). Abandoning unconditionally would stop the wrong clock. Returns whether anything
    /// was abandoned.
    /// </summary>
    public bool AbandonRunningSpan(string entryId)
    {
        if (State is not TrackerState.Tracking tracking || tracking.EntryId != entryId)
        {
            return false;
        }

        // This is the one exit from Tracking that does not run through Close(), so the live-span
        // file has to be cleared here explicitly. Leaving it would resurrect the span the server
        // just refused: the next launch finds it, offers to recover it, and Keep enqueues a time
        // entry for work this machine was told it could not record.
        _liveSpan.Clear();
        State = TrackerState.Idle;
        return true;
    }

    internal static string SourceToken(EntrySource source) =>
        source == EntrySource.Auto ? "AUTO" : "MANUAL";

    /// <summary>
    /// Read a source back from its wire token. Anything unrecognised — a file written by a future
    /// build, or a truncated one — reads as MANUAL, which is the conservative answer: a MANUAL
    /// entry is never auto-stopped or bridged.
    /// </summary>
    internal static EntrySource SourceFromToken(string token) =>
        token == "AUTO" ? EntrySource.Auto : EntrySource.Manual;

    private void Open(Selection selection, EntrySource source)
    {
        var now = _clock();
        var id = _idGen(now);
        State = new TrackerState.Tracking(id, now, selection, source);
        _liveSpan.Begin(id, now, selection, source);
        SpanOpened?.Invoke(id, now, selection, source);
    }

    private void Close(DateTimeOffset endTime)
    {
        if (State is not TrackerState.Tracking tracking)
        {
            return;
        }

        Enqueue(
            tracking.EntryId,
            tracking.Selection.ProjectId,
            tracking.Selection.TaskId,
            tracking.StartedAt,
            endTime,
            tracking.Source,
            tracking.Selection.Note);

        // The span is now a durable, completed record — the crash-recovery copy has nothing left
        // to protect and must go, or the next launch would offer to recover a span already banked.
        _liveSpan.Clear();

        var safeEnd = endTime < tracking.StartedAt ? tracking.StartedAt : endTime;
        SpanClosed?.Invoke(
            new ClosedSpan(
                tracking.EntryId,
                tracking.StartedAt,
                safeEnd,
                tracking.Selection,
                tracking.Source));
    }

    private void Enqueue(
        string id,
        string? projectId,
        string? taskId,
        DateTimeOffset start,
        DateTimeOffset end,
        EntrySource source,
        string? note)
    {
        // Never emit an inverted span. Every caller orders its own pair, but the clock is the
        // system clock and a backwards STEP mid-span (an NTP correction, a hand-set clock, a wake
        // from sleep) can land `end` before `start`. The server rejects that with a 422, which the
        // uploader classifies as permanent — so the entry would be dropped and the person would
        // silently lose the time. Collapsing to zero keeps the record in a shape the product
        // already means something by and preserves the id, so the row still closes rather than
        // stranding open.
        var safeEnd = end < start ? start : end;

        var payload = new TimeEntryPayload
        {
            Id = id,
            ProjectId = projectId,
            TaskId = taskId,
            StartTime = UuidV7.Iso(start),
            EndTime = UuidV7.Iso(safeEnd),
            Source = SourceToken(source),
            Note = note,
        };

        _buffer.Enqueue(id, BufferKind.TimeEntry, payload.ToJsonUtf8());
    }
}

/// <summary>
/// A span that has just finished. Everything needed to write it, so an observer can publish the
/// close as well as tally it.
/// </summary>
public sealed record ClosedSpan(
    string EntryId,
    DateTimeOffset Start,
    DateTimeOffset End,
    TimeTracker.Selection Selection,
    TimeTracker.EntrySource Source);

/// <summary>The tracker's state. Closed hierarchy — no other cases exist.</summary>
public abstract record TrackerState
{
    private TrackerState()
    {
    }

    public static TrackerState Idle { get; } = new IdleState();

    public sealed record IdleState : TrackerState;

    public sealed record Tracking(
        string EntryId,
        DateTimeOffset StartedAt,
        TimeTracker.Selection Selection,
        TimeTracker.EntrySource Source) : TrackerState;

    public sealed record Paused(TimeTracker.Selection Selection) : TrackerState;
}
