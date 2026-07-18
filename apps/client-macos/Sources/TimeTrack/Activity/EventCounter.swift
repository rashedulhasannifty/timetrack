import CoreGraphics

/// PRD §6.3 — counts keyboard/mouse EVENTS to derive an activity %. Reads `CGEventSource`'s
/// cumulative per-type counters (maintained by the window server); there is NO code path that
/// taps, reads, or inspects an event's CONTENT, and there must never be one (CLAUDE.md §1).
/// Same content-free family as `WorkspaceObserver.secondsSinceLastEventType`. Counts are
/// cumulative since login; callers diff snapshots across sub-buckets (wrap-safe on UInt64).
protocol InputCounting {
    func snapshot() -> (keys: UInt64, pointer: UInt64)
}

final class EventCounter: InputCounting {
    private let source: CGEventSourceStateID
    init(source: CGEventSourceStateID = .combinedSessionState) { self.source = source }

    func snapshot() -> (keys: UInt64, pointer: UInt64) {
        let keys = count(.keyDown)
        let pointer = count(.mouseMoved) + count(.leftMouseDown) + count(.rightMouseDown)
            + count(.otherMouseDown) + count(.leftMouseDragged) + count(.rightMouseDragged)
            + count(.scrollWheel)
        return (keys: keys, pointer: pointer)
    }

    private func count(_ type: CGEventType) -> UInt64 {
        UInt64(CGEventSource.counterForEventType(source, eventType: type))
    }
}
