using NiftyTimer.Tracking;

namespace NiftyTimer.Sync;

/// <summary>
/// Publishes the CURRENTLY RUNNING entry (<c>endTime: null</c>) so the dashboard can show time
/// accruing instead of only appearing on Stop. The server stamps <c>heartbeatAt</c> on every
/// upsert; there is no dedicated heartbeat route, so keeping an entry alive means re-POSTing the
/// same open entry on a cadence. Miss the server's freshness window
/// (<c>TRACKING_FRESHNESS_SECONDS</c>, 300s by default) and every reporting query silently
/// truncates the live time — which is why the heartbeat runs at 60s.
///
/// Deliberately does NOT go through the durable buffer: the buffer appends one file per enqueue,
/// so the same id enqueued twice leaves two records, and a stale OPEN payload draining after the
/// close would null a real <c>endTime</c>. That hazard is specific to the open payloads this type
/// sends — a CLOSED payload is safe to buffer, and that is what <see cref="TimeTracker"/> does.
///
/// Best-effort for any INDIVIDUAL publish: one failure is swallowed, because the authoritative
/// record is still the CLOSED entry the tracker enqueues, so offline behaviour is unchanged.
///
/// A SUSTAINED failure is different, and is surfaced. Swallowing those without a word is how a
/// stranded open row on the server hid for hours: the clock ran on the laptop, the dashboard
/// showed the person as tracking, and their tracked time silently stopped moving.
/// </summary>
public sealed class LiveEntryPublisher
{
    private readonly IUploader _uploader;
    private readonly int _failureThreshold;
    private readonly Lock _chain = new();

    private Task _tail = Task.CompletedTask;
    private int _consecutiveFailures;
    private bool _isBlocked;
    private bool _closePending;

    public LiveEntryPublisher(IUploader uploader, int failureThreshold = 3)
    {
        _uploader = uploader;
        _failureThreshold = Math.Max(1, failureThreshold);
    }

    /// <summary>
    /// Raised once publishing has failed <c>failureThreshold</c> times in a row, cleared by the
    /// first success. Fires only on CHANGE, so the tray isn't rewritten every heartbeat.
    /// </summary>
    public event Action<bool>? BlockedChanged;

    /// <summary>
    /// The server refused to open the entry because this user already has a FRESH running entry
    /// on another machine (HTTP 409 against the <c>time_entries_one_running_per_user</c> partial
    /// unique index). Carries the id of the entry that was refused.
    ///
    /// This is the one collision a second client platform introduces, and it is a definite answer
    /// rather than a flaky link — so it short-circuits the consecutive-failure counter entirely.
    /// Routing it through <see cref="BlockedChanged"/> would show the user a vague "not
    /// recording" warning twice before anything told them the actual reason.
    ///
    /// The entry id is not decoration. Publishing is fire-and-forget, so a 409 can land after its
    /// span has already been superseded — switching project while tracking closes one span and
    /// opens another within the same second. Without the id the handler would roll back whatever
    /// span happens to be running when the late answer arrives, which is the wrong one.
    /// </summary>
    public event Action<string>? ConflictDetected;

    public Task PublishAsync(
        string entryId,
        DateTimeOffset start,
        TimeTracker.Selection selection,
        TimeTracker.EntrySource source,
        CancellationToken cancellationToken = default) =>
        EnqueueAsync(
            new TimeEntryPayload
            {
                Id = entryId,
                ProjectId = selection.ProjectId,
                TaskId = selection.TaskId,
                StartTime = UuidV7.Iso(start),
                EndTime = null,
                Source = TimeTracker.SourceToken(source),
                Note = null,
            },
            cancellationToken);

    /// <summary>
    /// Tell the server a span ended, without waiting for the buffer's next drain.
    ///
    /// The buffer is still the authoritative record and still uploads this entry — this is purely
    /// about latency, and the latency matters because the server allows one open entry per USER.
    /// Until it hears the close, that slot is held: the very next open, which for a project switch
    /// or a resolved away window is milliseconds later, is refused with a 409 the client would
    /// report as "already tracking on another machine". There is no other machine.
    ///
    /// Safe to send, unlike an open payload: the server's close is monotone, so a duplicate close
    /// arriving later from the buffer cannot re-open or alter it.
    /// </summary>
    public Task PublishCloseAsync(ClosedSpan span, CancellationToken cancellationToken = default) =>
        EnqueueAsync(
            new TimeEntryPayload
            {
                Id = span.EntryId,
                ProjectId = span.Selection.ProjectId,
                TaskId = span.Selection.TaskId,
                StartTime = UuidV7.Iso(span.Start),
                EndTime = UuidV7.Iso(span.End),
                Source = TimeTracker.SourceToken(span.Source),
                Note = span.Selection.Note,
            },
            cancellationToken);

    /// <summary>
    /// Re-publish the running span. Called on each heartbeat tick while tracking so the server's
    /// <c>heartbeatAt</c> stays fresh and the entry keeps showing as running.
    /// </summary>
    public Task HeartbeatAsync(TrackerState.Tracking span, CancellationToken cancellationToken = default) =>
        PublishAsync(span.EntryId, span.StartedAt, span.Selection, span.Source, cancellationToken);

    /// <summary>
    /// Serialize every publish into a single chain, in call order.
    ///
    /// Initiating the close first is not enough on its own: two fire-and-forget HTTP calls can
    /// complete in either order, and if the open overtakes the close then the server sees a second
    /// open against a still-held slot — the exact 409 this is meant to prevent, now intermittent
    /// and impossible to reproduce on demand. A chain makes the ordering a property of the code
    /// rather than of the network.
    /// </summary>
    private Task EnqueueAsync(TimeEntryPayload payload, CancellationToken cancellationToken)
    {
        lock (_chain)
        {
            // Continue off the tail whether or not it faulted — one failed publish must never
            // wedge the chain for the rest of the session.
            var next = _tail.ContinueWith(
                    _ => SendAsync(payload, cancellationToken),
                    CancellationToken.None,
                    TaskContinuationOptions.None,
                    TaskScheduler.Default)
                .Unwrap();

            _tail = next;
            return next;
        }
    }

    private async Task SendAsync(TimeEntryPayload payload, CancellationToken cancellationToken)
    {
        // Nothing here stops tracking or loses data by itself — the closed entry still goes
        // through the buffer. What the outcome decides is whether the person is TOLD that the
        // running entry is not reaching the server, and whether the clock has to be rolled back.
        var result = await _uploader.UploadAsync(payload.ToJsonUtf8(), cancellationToken).ConfigureAwait(false);
        var isClose = payload.EndTime is not null;

        switch (result)
        {
            case UploadResult.Success:
                // Cleared on ANY success, not just a close. An OPEN that succeeds is itself proof
                // the slot was free — the server would have refused it otherwise — so the doubt
                // this flag represents is settled either way. Clearing only on a close would leave
                // it stuck after the more common recovery (close fails, the next open goes
                // through), and a genuine second-machine conflict later would then be softened into
                // the vague "not recording" warning instead of naming the actual reason.
                _closePending = false;
                _consecutiveFailures = 0;
                SetBlocked(false);
                break;

            case UploadResult.Permanent { Status: 409 } when !_closePending:
                // Definite, and specific. Do not touch the failure counter: the rollback the
                // handler performs stops the clock, so there is nothing left to warn about.
                ConflictDetected?.Invoke(payload.Id);
                break;

            case UploadResult.Permanent { Status: 409 }:
                // A 409 while one of OUR OWN closes has not landed says nothing about another
                // machine — most likely we are holding our own slot, because the close that would
                // have released it failed on the way out. Accusing the user of tracking somewhere
                // else and stopping their clock over our own failed request is the worse of the two
                // wrong answers, so treat it as a transient failure instead.
                //
                // It heals without help: the buffer still carries that close, the next drain
                // delivers it, and the following heartbeat re-publishes the open successfully.
                goto default;

            default:
                // A 5xx, an expired session, no network — from here they are the same fact: the
                // running entry is not being recorded. One is noise; several in a row is worth
                // saying out loud.
                if (isClose)
                {
                    // Remember that the server may still believe this entry is open, so the 409 the
                    // next open is about to get can be read for what it is.
                    _closePending = true;
                }

                _consecutiveFailures++;
                if (_consecutiveFailures >= _failureThreshold)
                {
                    SetBlocked(true);
                }

                break;
        }
    }

    private void SetBlocked(bool blocked)
    {
        if (blocked == _isBlocked)
        {
            return;
        }

        _isBlocked = blocked;
        BlockedChanged?.Invoke(blocked);
    }
}
