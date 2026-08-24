import Foundation

/// The kind of a buffered record — used to route on drain (SyncEngine syncs each kind to its own endpoint).
enum BufferKind: String {
    case timeEntry
    case idleEvent
}

/// PRD §7.5 — durable, file-backed offline write-buffer. One atomic file per record under
/// Application Support; the filename `<createdAtMillis>__<kind>__<uuidv7>.json` carries FIFO order,
/// routing, and identity, so listing the directory yields all three WITHOUT reading contents. The
/// file's content IS the raw payload the API upserts on (idempotent on the UUIDv7). Hand-rolled —
/// no SQLite dependency (CLAUDE.md §2); durability comes from write-temp-then-rename plus a startup
/// sweep of any `.tmp-*` left by a crash between write and rename. File-per-record gives natural
/// isolation: concurrent enqueue (main) and take/remove (sync task) touch different files.
final class BufferStore {
    static let shared = BufferStore(directory: BufferStore.defaultDirectory())

    private let directory: URL
    private let clock: () -> Date

    init(directory: URL, clock: @escaping () -> Date = Date.init) {
        self.directory = directory
        self.clock = clock
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        sweepTemporaries()
    }

    /// ~/Library/Application Support/<container>/buffer/ — per-install; see `AppInstall`.
    static func defaultDirectory() -> URL {
        AppInstall.supportDirectory("buffer")
    }

    /// Atomic enqueue: write to `.tmp-<id>`, then rename to the final `<millis>__<kind>__<id>.json`.
    func enqueue(id: String, kind: BufferKind, payload: Data) {
        let millis = Int64(clock().timeIntervalSince1970 * 1000)
        let dst = directory.appendingPathComponent("\(millis)__\(kind.rawValue)__\(id).json")
        let tmp = directory.appendingPathComponent(".tmp-\(id)")
        do {
            try payload.write(to: tmp, options: .atomic)
            try? FileManager.default.removeItem(at: dst)   // ids are unique; defensive
            try FileManager.default.moveItem(at: tmp, to: dst)
        } catch {
            try? FileManager.default.removeItem(at: tmp)
        }
    }

    /// FIFO (createdAt asc) records of `kind`, up to `limit`.
    func take(kind: BufferKind, limit: Int) -> [(id: String, payload: Data)] {
        allRecords()
            .filter { $0.kind == kind.rawValue }
            .prefix(limit)
            .compactMap { rec in
                guard let data = try? Data(contentsOf: rec.url) else { return nil }
                return (id: rec.id, payload: data)
            }
    }

    func remove(id: String) {
        for rec in allRecords() where rec.id == id {
            try? FileManager.default.removeItem(at: rec.url)
        }
    }

    /// Drops records created before `now - maxAge`, bounding the buffer against records that never
    /// deliver. Both kinds are drained and removed on 2xx, so only stuck records ever age out.
    func prune(olderThan maxAge: TimeInterval) {
        let cutoff = Int64(clock().addingTimeInterval(-maxAge).timeIntervalSince1970 * 1000)
        for rec in allRecords() where rec.createdAtMillis < cutoff {
            try? FileManager.default.removeItem(at: rec.url)
        }
    }

    func clear() {
        for rec in allRecords() { try? FileManager.default.removeItem(at: rec.url) }
    }

    // MARK: - internals

    private struct Record { let url: URL; let createdAtMillis: Int64; let kind: String; let id: String }

    private func contents() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    }

    /// How many records are still waiting to reach the server.
    ///
    /// Counted from the directory listing, not by reading any payload — the filename carries
    /// everything, which is the whole point of the naming scheme.
    func pendingCount() -> Int {
        allRecords().count
    }

    private func parse(_ url: URL) -> Record? {
        let name = url.lastPathComponent
        guard name.hasSuffix(".json") else { return nil }
        let parts = String(name.dropLast(5)).components(separatedBy: "__")  // strip ".json"
        guard parts.count == 3, let millis = Int64(parts[0]) else { return nil }
        return Record(url: url, createdAtMillis: millis, kind: parts[1], id: parts[2])
    }

    private func allRecords() -> [Record] {
        contents().compactMap(parse)
            .sorted { ($0.createdAtMillis, $0.id) < ($1.createdAtMillis, $1.id) }
    }

    private func sweepTemporaries() {
        for url in contents() where url.lastPathComponent.hasPrefix(".tmp-") {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

extension BufferStore: TimeEntryBuffering {}
