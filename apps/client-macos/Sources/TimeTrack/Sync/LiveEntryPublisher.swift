import Foundation

/// Publishes the CURRENTLY RUNNING entry (`endTime: null`) so the dashboard can show time
/// accruing instead of only appearing on Stop (spec §4.1).
///
/// Deliberately does NOT go through `BufferStore`: that buffer appends one file per enqueue
/// (`{millis}__{kind}__{id}.json`), so the same id enqueued twice leaves two records, and a
/// stale OPEN payload draining after the close would null a real `endTime`. That hazard is
/// specific to the open payloads this type sends — a CLOSED payload is safe to buffer, and the
/// recovery close does exactly that (see `LiveSpanRecovery`).
///
/// Best-effort for any INDIVIDUAL publish: one failure is swallowed, because the authoritative
/// record is still the CLOSED entry that `TimeTracker.close` enqueues to the buffer, so offline
/// behaviour is unchanged. Not a capture path: no AckGate (manual tracking is gated upstream by
/// `MenuViewModel.isReady`).
///
/// A SUSTAINED failure is different, and is surfaced. Swallowing those without a word is how a
/// stranded open row on the server hid for hours: the clock ran on the Mac, the dashboard showed
/// the person as tracking (activity samples are a separate path and kept flowing), and their
/// tracked time silently stopped moving. Nobody could have known from either end. After
/// `failureThreshold` consecutive failures — heartbeats are a minute apart, so this is minutes,
/// not a blip — the menu bar says so.
final class LiveEntryPublisher {
    private let uploader: Uploading
    /// Raised once publishing has failed `failureThreshold` times in a row, cleared by the first
    /// success. Fires only on CHANGE, so the menu bar isn't rewritten every heartbeat. Assigned
    /// after construction (like `StatusItemController.onOpen`) because the object that handles it
    /// does not exist yet while AppDelegate is still initialising its stored properties.
    var onBlockedChanged: (Bool) -> Void = { _ in }
    private let failureThreshold: Int

    private var consecutiveFailures = 0
    private var isBlocked = false

    /// Main-thread only, like `MenuViewModel`: every caller is either the heartbeat timer or a
    /// span-open callback, both of which run there.
    init(uploader: Uploading, failureThreshold: Int = 3) {
        self.uploader = uploader
        self.failureThreshold = max(1, failureThreshold)
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

    /// Re-publish from the persisted span. Called each heartbeat tick while tracking so the
    /// server's `heartbeatAt` stays fresh and the entry keeps showing as running.
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

    private func send(_ payload: TimeEntryPayload) async {
        guard let data = try? JSONEncoder().encode(payload) else { return }
        // Nothing here stops tracking or loses data — the closed entry still goes through the
        // buffer. What the outcome decides is whether the person is TOLD that the running entry
        // is not reaching the server.
        switch await uploader.upload(data) {
        case .success:
            consecutiveFailures = 0
            setBlocked(false)
        case .permanent, .transient, .authFailed:
            // A 409 (a stranded open row the server won't let us replace), a 5xx, an expired
            // session — from here they are the same fact: the running entry is not being
            // recorded. One is noise; several in a row is worth saying out loud.
            consecutiveFailures += 1
            if consecutiveFailures >= failureThreshold { setBlocked(true) }
        }
    }

    private func setBlocked(_ blocked: Bool) {
        guard blocked != isBlocked else { return }
        isBlocked = blocked
        onBlockedChanged(blocked)
    }
}
