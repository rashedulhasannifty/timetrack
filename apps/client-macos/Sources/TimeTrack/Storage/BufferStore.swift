import Foundation

/// PRD §7.5 — local write-buffer with ≥24h capacity so capture survives an unreachable
/// backend. The shipped implementation uses GRDB (SQLite); this in-memory stand-in keeps
/// the module compiling until that dependency is added.
final class BufferStore {
    private var pending: [String: Data] = [:]

    /// Records are keyed by a client-minted UUIDv7 — the same key the API upserts on.
    func enqueue(id: String, payload: Data) {
        pending[id] = payload
    }

    func take(_ limit: Int) -> [(id: String, payload: Data)] {
        pending.prefix(limit).map { (id: $0.key, payload: $0.value) }
    }

    func remove(id: String) {
        pending[id] = nil
    }
}
