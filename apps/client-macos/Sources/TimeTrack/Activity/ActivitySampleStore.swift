import Foundation

/// PRD §7.5 — durable, file-backed JSON buffer for activity samples. Mirrors `ImageBufferStore`'s
/// durability model (atomic write-tmp-then-rename, `.tmp-` sweep on init, one file per record,
/// FIFO by filename-encoded millis) but stores JSON and drains in BATCHES (its own uploader/engine),
/// so it is separate from the one-POST-per-record `BufferStore`. Filename `<createdMillis>__<id>.json`
/// carries order + identity without reading the file.
protocol ActivitySampleBuffering {
    func enqueue(_ sample: ActivitySample)
    func take(limit: Int) -> [ActivitySample]
    func remove(ids: [String])
    func prune(olderThan maxAge: TimeInterval, maxCount: Int)
    func clear()
}

final class ActivitySampleStore: ActivitySampleBuffering {
    static let shared = ActivitySampleStore(directory: ActivitySampleStore.defaultDirectory())

    private let directory: URL
    private let clock: () -> Date

    init(directory: URL, clock: @escaping () -> Date = Date.init) {
        self.directory = directory
        self.clock = clock
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        sweepTemporaries()
    }

    /// ~/Library/Application Support/<container>/activity/ — per-install; see `AppInstall`.
    static func defaultDirectory() -> URL {
        AppInstall.supportDirectory("activity")
    }

    func enqueue(_ sample: ActivitySample) {
        guard let payload = try? JSONEncoder().encode(sample) else { return }
        let millis = Int64(clock().timeIntervalSince1970 * 1000)
        let dst = directory.appendingPathComponent("\(millis)__\(sample.id).json")
        let tmp = directory.appendingPathComponent(".tmp-\(sample.id)")
        do {
            try payload.write(to: tmp, options: .atomic)
            try? FileManager.default.removeItem(at: dst)
            try FileManager.default.moveItem(at: tmp, to: dst)
        } catch {
            try? FileManager.default.removeItem(at: tmp)
        }
    }

    func take(limit: Int) -> [ActivitySample] {
        allRecords().prefix(limit).compactMap { rec in
            guard let data = try? Data(contentsOf: rec.url) else { return nil }
            return try? JSONDecoder().decode(ActivitySample.self, from: data)
        }
    }

    func remove(ids: [String]) {
        let set = Set(ids)
        for rec in allRecords() where set.contains(rec.id) {
            try? FileManager.default.removeItem(at: rec.url)
        }
    }

    /// Age-bound (drop older than `maxAge`) then count-bound (trim oldest beyond `maxCount`).
    func prune(olderThan maxAge: TimeInterval, maxCount: Int) {
        let cutoff = Int64(clock().addingTimeInterval(-maxAge).timeIntervalSince1970 * 1000)
        var records = allRecords()
        for rec in records where rec.createdMillis < cutoff {
            try? FileManager.default.removeItem(at: rec.url)
        }
        records = records.filter { $0.createdMillis >= cutoff }
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

    private struct Record { let url: URL; let createdMillis: Int64; let id: String }

    private func contents() -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    }

    private func parse(_ url: URL) -> Record? {
        let name = url.lastPathComponent
        guard name.hasSuffix(".json") else { return nil }
        let parts = String(name.dropLast(5)).components(separatedBy: "__")
        guard parts.count == 2, let millis = Int64(parts[0]) else { return nil }
        return Record(url: url, createdMillis: millis, id: parts[1])
    }

    private func allRecords() -> [Record] {
        contents().compactMap(parse).sorted { ($0.createdMillis, $0.id) < ($1.createdMillis, $1.id) }
    }

    private func sweepTemporaries() {
        for url in contents() where url.lastPathComponent.hasPrefix(".tmp-") {
            try? FileManager.default.removeItem(at: url)
        }
    }
}
