import Foundation

/// PRD §6.2 / §7.4 — durable, file-backed binary buffer for captured screenshots. Mirrors
/// `BufferStore`'s durability model (atomic write-tmp-then-rename, startup sweep of `.tmp-*`,
/// one file per record) but stores raw JPEG bytes, not JSON — screenshots are binary multipart
/// (2.2a §13), so they get their own store and their own uploader/engine. The filename
/// `<capturedAtMillis>__<uuidv7>.jpg` carries FIFO order, identity (the server `id`), AND the
/// capture time (half the server PK `[id, timestamp]` + the partition key) WITHOUT reading the
/// file — so the capture time is stamped once and reused verbatim on every upload retry.
final class ImageBufferStore {
    static let shared = ImageBufferStore(directory: ImageBufferStore.defaultDirectory())

    private let directory: URL
    private let clock: () -> Date

    init(directory: URL, clock: @escaping () -> Date = Date.init) {
        self.directory = directory
        self.clock = clock
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        sweepTemporaries()
    }

    /// ~/Library/Application Support/TimeTrack/screenshots/
    static func defaultDirectory() -> URL {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TimeTrack/screenshots", isDirectory: true)
    }

    /// Atomic enqueue: write `.tmp-<id>`, then rename to `<capturedAtMillis>__<id>.jpg`.
    func enqueue(id: String, capturedAt: Date, jpeg: Data) {
        let millis = Int64(capturedAt.timeIntervalSince1970 * 1000)
        let dst = directory.appendingPathComponent("\(millis)__\(id).jpg")
        let tmp = directory.appendingPathComponent(".tmp-\(id)")
        do {
            try jpeg.write(to: tmp, options: .atomic)
            try? FileManager.default.removeItem(at: dst)
            try FileManager.default.moveItem(at: tmp, to: dst)
        } catch {
            try? FileManager.default.removeItem(at: tmp)
        }
    }

    /// FIFO (capture time asc) records, up to `limit`. Returns file URLs — callers read bytes lazily.
    func take(limit: Int) -> [(id: String, capturedAt: Date, url: URL)] {
        allRecords().prefix(limit).map {
            (id: $0.id,
             capturedAt: Date(timeIntervalSince1970: Double($0.capturedAtMillis) / 1000),
             url: $0.url)
        }
    }

    func remove(id: String) {
        for rec in allRecords() where rec.id == id {
            try? FileManager.default.removeItem(at: rec.url)
        }
    }

    /// Age-bound (drop older than `maxAge`) then count-bound (trim oldest beyond `maxCount`).
    /// Images are large, so unlike the JSON buffer this also caps by count.
    func prune(olderThan maxAge: TimeInterval, maxCount: Int) {
        let cutoff = Int64(clock().addingTimeInterval(-maxAge).timeIntervalSince1970 * 1000)
        var records = allRecords()
        for rec in records where rec.capturedAtMillis < cutoff {
            try? FileManager.default.removeItem(at: rec.url)
        }
        records = records.filter { $0.capturedAtMillis >= cutoff }
        if records.count > maxCount {
            for rec in records.prefix(records.count - maxCount) {
                try? FileManager.default.removeItem(at: rec.url)
            }
        }
    }

    func clear() {
        for rec in allRecords() { try? FileManager.default.removeItem(at: rec.url) }
    }

    // MARK: - internals

    private struct Record { let url: URL; let capturedAtMillis: Int64; let id: String }

    private func contents() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    }

    private func parse(_ url: URL) -> Record? {
        let name = url.lastPathComponent
        guard name.hasSuffix(".jpg") else { return nil }
        let parts = String(name.dropLast(4)).components(separatedBy: "__")  // strip ".jpg"
        guard parts.count == 2, let millis = Int64(parts[0]) else { return nil }
        return Record(url: url, capturedAtMillis: millis, id: parts[1])
    }

    private func allRecords() -> [Record] {
        contents().compactMap(parse)
            .sorted { ($0.capturedAtMillis, $0.id) < ($1.capturedAtMillis, $1.id) }
    }

    private func sweepTemporaries() {
        for url in contents() where url.lastPathComponent.hasPrefix(".tmp-") {
            try? FileManager.default.removeItem(at: url)
        }
    }
}
