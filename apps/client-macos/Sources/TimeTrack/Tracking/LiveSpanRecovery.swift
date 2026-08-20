import Foundation

/// Applies the user's choice from the interrupted-time recovery prompt (spec §4.4) to BOTH
/// records of the span: the server's still-open row, and the local `live-span.json`.
///
/// Keep and Discard differ only in where the span is closed:
///  - **Keep** — at `lastAlive`, the last heartbeat, so downtime is never counted.
///  - **Discard** — at `startTime`. A zero-duration row releases the one-open-entry partial
///    unique index slot and is filtered out of every list and export server-side. Never at
///    `lastAlive` — that would silently KEEP the time the user chose to discard.
///
/// Both go through `TimeTracker.recordSpan` → `BufferStore`, which is durable and retried by the
/// sync engine. Discard used to fire a single best-effort POST instead, and a single failure
/// (offline at relaunch) cleared the local span while leaving the server row open FOREVER: every
/// later open-publish and every 60s heartbeat then 409s against that index, so the live-entry
/// feature is silently and permanently dead for that user — while closed-entry time keeps
/// recording correctly, which is why nobody would notice. Nothing sweeps open rows server-side.
///
/// The stale-open-payload hazard that keeps `LiveEntryPublisher` off the buffer does NOT apply
/// here: a recovery payload is CLOSED, and the server's close is monotone (an open payload
/// draining later cannot re-open it).
///
/// Main-thread only, like `TimeTracker` itself.
struct LiveSpanRecovery {
    private let tracker: TimeTracker
    private let store: LiveSpanRecording
    private let currentUserId: () -> String?

    init(tracker: TimeTracker, store: LiveSpanRecording, currentUserId: @escaping () -> String?) {
        self.tracker = tracker
        self.store = store
        self.currentUserId = currentUserId
    }

    func apply(_ action: AwayResolution, to span: LiveSpan) {
        // Defense-in-depth (CLAUDE.md §1 cross-user integrity): the prompt is non-modal and can
        // outlive the user who opened it (e.g. left open across a sign-out/sign-in). Re-check
        // against the CURRENT logged-in user, not the one captured when the prompt was built, so
        // a stale action from a prior user's prompt can never be attributed to whoever is signed
        // in now. A span that is not ours is dropped locally and never enqueued.
        if LiveSpanStore.shouldRecover(span: span, currentUserId: currentUserId()) {
            tracker.recordSpan(
                id: span.entryId,
                start: span.startTime,
                end: action == .keep ? span.lastAlive : span.startTime,
                projectId: span.projectId,
                taskId: span.taskId,
                source: TimeTracker.Source(rawValue: span.source) ?? .manual
            )
        }
        store.clear()
    }
}
