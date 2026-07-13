import Foundation

/// The persisted in-progress span. `source` is `TimeTracker.Source.rawValue`; `lastAlive` is bumped
/// by the heartbeat; `userId` is stamped so recovery can refuse a span from a different user.
struct LiveSpan: Codable, Equatable {
    let entryId: String
    let startTime: Date
    let projectId: String?
    let taskId: String?
    let source: String
    var lastAlive: Date
    let userId: String?
}

/// The seam `TimeTracker` calls on open/close. `NoopLiveSpan` keeps existing tests + the pure-unit
/// posture unchanged; `LiveSpanStore` is the real persister.
protocol LiveSpanRecording {
    func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection, source: TimeTracker.Source)
    func clear()
}

struct NoopLiveSpan: LiveSpanRecording {
    func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection, source: TimeTracker.Source) {}
    func clear() {}
}

/// PRD §7.5 spirit — persists the CURRENT in-progress span so a crash / quit-while-tracking doesn't
/// lose it. One overwritten JSON file under Application Support; the heartbeat keeps `lastAlive`
/// current so recovery closes the span near its true end (never counting downtime). Hand-rolled
/// Foundation JSON, no dependency. Not a capture path — no AckGate.
final class LiveSpanStore: LiveSpanRecording {
    private let fileURL: URL
    private let clock: () -> Date
    private let currentUserId: () -> String?

    init(fileURL: URL, clock: @escaping () -> Date = Date.init, currentUserId: @escaping () -> String?) {
        self.fileURL = fileURL
        self.clock = clock
        self.currentUserId = currentUserId
    }

    /// ~/Library/Application Support/TimeTrack/live-span.json
    static func defaultURL() -> URL {
        let dir = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TimeTrack", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("live-span.json")
    }

    func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection, source: TimeTracker.Source) {
        write(LiveSpan(entryId: entryId, startTime: startTime,
                       projectId: selection.projectId, taskId: selection.taskId,
                       source: source.rawValue, lastAlive: startTime, userId: currentUserId()))
    }

    func heartbeat(at now: Date) {
        guard var span = load() else { return }
        span.lastAlive = now
        write(span)
    }

    func load() -> LiveSpan? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(LiveSpan.self, from: data)
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    /// Recover only if the span belongs to the current user (or predates userId stamping).
    static func shouldRecover(span: LiveSpan, currentUserId: String?) -> Bool {
        guard let owner = span.userId else { return true }
        return owner == currentUserId
    }

    private func write(_ span: LiveSpan) {
        if let data = try? JSONEncoder().encode(span) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }
}
