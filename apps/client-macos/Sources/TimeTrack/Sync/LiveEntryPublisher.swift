import Foundation

/// Publishes the CURRENTLY RUNNING entry (`endTime: null`) so the dashboard can show time
/// accruing instead of only appearing on Stop (spec §4.1).
///
/// Deliberately does NOT go through `BufferStore`: that buffer appends one file per enqueue
/// (`{millis}__{kind}__{id}.json`), so the same id enqueued twice leaves two records, and a
/// stale open payload draining after the close would null a real `endTime`.
///
/// Best-effort by design. Every failure is swallowed — the authoritative record is still the
/// CLOSED entry that `TimeTracker.close` enqueues to the buffer, so offline behaviour is
/// unchanged. Not a capture path: no AckGate (manual tracking is gated upstream by
/// `MenuViewModel.isReady`).
final class LiveEntryPublisher {
    private let uploader: Uploading

    init(uploader: Uploading) {
        self.uploader = uploader
    }

    func publish(entryId: String, start: Date, selection: TimeTracker.Selection,
                 source: TimeTracker.Source) async {
        await send(TimeEntryPayload(
            id: entryId,
            projectId: selection.projectId,
            taskId: selection.taskId,
            startTime: TimeEntryPayload.iso.string(from: start),
            endTime: nil,
            source: source.rawValue,
            note: nil
        ))
    }

    /// Re-publish from the persisted span — used by the heartbeat, which is the only thing that
    /// knows the span survived a restart of the publish path.
    func publish(_ span: LiveSpan) async {
        await send(TimeEntryPayload(
            id: span.entryId,
            projectId: span.projectId,
            taskId: span.taskId,
            startTime: TimeEntryPayload.iso.string(from: span.startTime),
            endTime: nil,
            source: span.source,
            note: nil
        ))
    }

    /// Close the server row for a span the user chose to DISCARD, by ending it at its own start.
    /// A zero-duration row releases the one-open-entry index slot and is filtered out of every
    /// list and export server-side (spec §4.4). Used by recovery Discard.
    func publishDiscarded(_ span: LiveSpan) async {
        let at = TimeEntryPayload.iso.string(from: span.startTime)
        await send(TimeEntryPayload(
            id: span.entryId,
            projectId: span.projectId,
            taskId: span.taskId,
            startTime: at,
            endTime: at,
            source: span.source,
            note: nil
        ))
    }

    private func send(_ payload: TimeEntryPayload) async {
        guard let data = try? JSONEncoder().encode(payload) else { return }
        // The result is intentionally discarded. A 409 means a stranded open row already
        // exists; a 429/5xx means the API is busy. Neither is a reason to stop tracking, and
        // neither loses data — the closed entry still goes through the buffer.
        _ = await uploader.upload(data)
    }
}
