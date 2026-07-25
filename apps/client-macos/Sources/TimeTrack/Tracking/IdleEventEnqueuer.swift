import Foundation

/// Builds, encodes, and buffers one `IdleEventPayload`. Shared by the auto and manual idle
/// coordinators so the ISO formatting + buffer-kind live in exactly one place. `id` is the
/// caller's client-minted UUIDv7 (idempotency key), typically `idGen(from)`.
enum IdleEventEnqueuer {
    static func enqueue(into buffer: TimeEntryBuffering, id: String,
                        from: Date, to: Date, action: ResolvedAction) {
        let event = IdleEventPayload(
            id: id,
            startTime: iso.string(from: from),
            endTime: iso.string(from: to),
            resolvedAction: action
        )
        if let data = try? JSONEncoder().encode(event) {
            buffer.enqueue(id: id, kind: .idleEvent, payload: data)
        }
    }

    /// Matches `TimeTracker`'s ISO config (`[.withInternetDateTime]`).
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
