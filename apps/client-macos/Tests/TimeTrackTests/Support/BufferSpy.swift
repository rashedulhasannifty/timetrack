import Foundation
@testable import TimeTrack

final class BufferSpy: TimeEntryBuffering {
    private(set) var entries: [(id: String, kind: BufferKind, payload: Data)] = []
    func enqueue(id: String, kind: BufferKind, payload: Data) {
        entries.append((id: id, kind: kind, payload: payload))
    }

    /// Decodes an enqueued payload into a loose dictionary for field assertions.
    func object(at index: Int) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: entries[index].payload)) as? [String: Any] ?? [:]
    }
}
