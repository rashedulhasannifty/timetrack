import Foundation

/// PRD §6.1/§6.4 — mirror of `IdleEventSchema` in @timetrack/contracts. On resume from idle
/// the client records the away window and how it was resolved. `KEPT` counts the away time
/// (a bridge TimeEntry covers it); `DISCARDED` drops it; `UNRESOLVED` is emitted when the app
/// tears down mid-away (no bridge — the fail-safe, idle not counted). Buffered like a
/// TimeEntry and drained by SyncEngine to POST /v1/idle-events.
enum ResolvedAction: String, Encodable {
    case kept = "KEPT"
    case discarded = "DISCARDED"
    case unresolved = "UNRESOLVED"
}

struct IdleEventPayload: Encodable {
    let id: String
    let startTime: String   // ISO8601
    let endTime: String     // ISO8601
    let resolvedAction: ResolvedAction
}
