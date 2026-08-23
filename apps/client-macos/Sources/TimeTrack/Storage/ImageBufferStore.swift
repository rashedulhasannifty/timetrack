import Foundation

/// The multi-display grouping stamped on a buffered capture: which tick it belongs to, and where
/// it sat in that tick. Nil for records written by a build older than multi-display capture.
struct CaptureGroup: Equatable {
    let id: String
    let displayIndex: Int
    let displayCount: Int
}

/// PRD §6.2 / §7.4 — durable, file-backed binary buffer for captured screenshots. Mirrors
/// `BufferStore`'s durability model (atomic write-tmp-then-rename, startup sweep of `.tmp-*`,
/// one file per record) but stores raw JPEG bytes, not JSON — screenshots are binary multipart
/// (2.2a §13), so they get their own store and their own uploader/engine. The filename
/// `<capturedAtMillis>__<uuidv7>__<groupId>__<displayIndex>__<displayCount>.jpg` carries FIFO
/// order, identity (the server `id`), the capture time (half the server PK `[id, timestamp]` +
/// the partition key), AND the multi-display grouping — all WITHOUT reading the file, so the
/// capture time is stamped once and reused verbatim on every upload retry.
///
/// The two-component form `<capturedAtMillis>__<uuidv7>.jpg` is still parsed: it is what the
/// build currently on pilot Macs writes, and those pending captures must still drain after an
/// update rather than being silently dropped on the floor. They carry no group, which is
/// accurate — they were single main-display grabs.
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

    /// ~/Library/Application Support/<container>/screenshots/ — the container is per-install, so
    /// a dev build never drains the released app's pending captures. See `AppInstall`.
    static func defaultDirectory() -> URL {
        AppInstall.supportDirectory("screenshots")
    }

    /// Atomic enqueue: write `.tmp-<id>`, then rename to the encoded record name.
    ///
    /// `group` is nil only for a capture with no display context to record. Every current caller
    /// passes one; the parameter stays optional so a record can still be written (and drained) in
    /// the shape the previous build used.
    func enqueue(id: String, capturedAt: Date, jpeg: Data, group: CaptureGroup? = nil) {
        let millis = Int64(capturedAt.timeIntervalSince1970 * 1000)
        let dst = directory.appendingPathComponent(Self.filename(millis: millis, id: id, group: group))
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
    func take(limit: Int) -> [(id: String, capturedAt: Date, group: CaptureGroup?, url: URL)] {
        allRecords().prefix(limit).map {
            (id: $0.id,
             capturedAt: Date(timeIntervalSince1970: Double($0.capturedAtMillis) / 1000),
             group: $0.group,
             url: $0.url)
        }
    }

    /// Screenshots still waiting to upload. Directory listing only, no image is read.
    func pendingCount() -> Int {
        take(limit: Int.max).count
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

    private struct Record {
        let url: URL; let capturedAtMillis: Int64; let id: String; let group: CaptureGroup?
    }

    /// The record name. Underscore-pair separated; a UUID contains no `__`, so the components
    /// can never be ambiguous.
    static func filename(millis: Int64, id: String, group: CaptureGroup?) -> String {
        guard let group else { return "\(millis)__\(id).jpg" }
        return "\(millis)__\(id)__\(group.id)__\(group.displayIndex)__\(group.displayCount).jpg"
    }

    private func contents() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    }

    private func parse(_ url: URL) -> Record? {
        let name = url.lastPathComponent
        guard name.hasSuffix(".jpg") else { return nil }
        let parts = String(name.dropLast(4)).components(separatedBy: "__")  // strip ".jpg"
        guard let millis = Int64(parts.first ?? "") else { return nil }
        // Two components: written by a build older than multi-display capture. Still drainable,
        // and genuinely ungrouped — it was a single main-display grab.
        if parts.count == 2 {
            return Record(url: url, capturedAtMillis: millis, id: parts[1], group: nil)
        }
        guard parts.count == 5, let index = Int(parts[3]), let count = Int(parts[4]) else {
            return nil
        }
        return Record(url: url, capturedAtMillis: millis, id: parts[1],
                      group: CaptureGroup(id: parts[2], displayIndex: index, displayCount: count))
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
