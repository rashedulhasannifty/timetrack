import Foundation

/// PRD §6.3 — counts keyboard/mouse EVENTS per interval to derive an activity %. There is
/// NO code path here that reads key content, and there must never be one (CLAUDE.md §1).
/// A sibling Categorizer maps app/site → PRODUCTIVE | UNPRODUCTIVE | NEUTRAL client-side.
final class EventCounter {
    private(set) var keyEvents = 0
    private(set) var pointerEvents = 0

    /// Records that an input event occurred. The event's CONTENT is never inspected.
    func recordKeyEvent() { keyEvents += 1 }
    func recordPointerEvent() { pointerEvents += 1 }

    /// Consumes the current counts and resets for the next interval.
    func drain() -> (keys: Int, pointer: Int) {
        defer { keyEvents = 0; pointerEvents = 0 }
        return (keyEvents, pointerEvents)
    }
}
