using NiftyTimer.Storage;

namespace NiftyTimer.Tracking;

/// <summary>
/// Applies the user's choice from the interrupted-time recovery prompt to BOTH records of the
/// span: the server's still-open row, and the local <c>live-span.json</c>.
///
/// Keep and Discard differ only in where the span is closed:
/// <list type="bullet">
///   <item><b>Keep</b> — at <c>LastAlive</c>, the last heartbeat, so downtime is never counted.</item>
///   <item><b>Discard</b> — at <c>StartTime</c>. A zero-duration row releases the one-open-entry
///   partial unique index slot and is filtered out of every list and export server-side. Never at
///   <c>LastAlive</c> — that would silently keep the time the user chose to discard.</item>
/// </list>
///
/// Both go through <see cref="TimeTracker.RecordSpan"/> → the durable buffer, which is retried by
/// the sync engine. On macOS, Discard once fired a single best-effort POST instead, and one failure
/// (offline at relaunch — the common case after a crash) cleared the local span while leaving the
/// server row open forever. Every later open-publish and every heartbeat then 409s against that
/// index, so live entries are permanently dead for that user while closed-entry time keeps
/// recording correctly — which is why nobody would notice. Nothing sweeps open rows server-side.
///
/// The stale-open-payload hazard that keeps <see cref="Sync.LiveEntryPublisher"/> off the buffer
/// does not apply here: a recovery payload is CLOSED, and the server's close is monotone, so an
/// open payload draining later cannot re-open it.
///
/// UI-thread-only, like <see cref="TimeTracker"/> itself.
/// </summary>
public sealed class LiveSpanRecovery
{
    private readonly TimeTracker _tracker;
    private readonly ILiveSpanRecorder _store;
    private readonly Func<string?> _currentUserId;

    public LiveSpanRecovery(TimeTracker tracker, ILiveSpanRecorder store, Func<string?> currentUserId)
    {
        _tracker = tracker;
        _store = store;
        _currentUserId = currentUserId;
    }

    public void Apply(AwayResolution action, LiveSpan span)
    {
        // Defence in depth (CLAUDE.md §1 cross-user integrity): the prompt is non-modal and can
        // outlive the user who opened it — left up across a sign-out and a different sign-in, say.
        // Re-check against the CURRENT signed-in user, resolved now rather than captured when the
        // prompt was built, so a stale action from a prior user's prompt can never be attributed to
        // whoever is signed in now. A span that is not ours is dropped locally, never enqueued.
        if (LiveSpanStore.ShouldRecover(span, _currentUserId()))
        {
            _tracker.RecordSpan(
                span.StartTime,
                action == AwayResolution.Keep ? span.LastAlive : span.StartTime,
                span.ProjectId,
                span.TaskId,
                TimeTracker.SourceFromToken(span.Source),
                id: span.EntryId);
        }

        _store.Clear();
    }
}
