import Foundation

/// The buffer seam. `BufferStore` (PRD §7.5) already has this method; the protocol lets
/// tests substitute a spy.
protocol TimeEntryBuffering {
    func enqueue(id: String, payload: Data)
}

extension BufferStore: TimeEntryBuffering {}

/// PRD §6.1 — manual time tracking. Each contiguous span is one TimeEntry keyed by a
/// client-minted UUIDv7. Pause = close the current entry; Resume = open a new one (the
/// data model is one startTime/endTime per entry, so paused time is simply excluded).
/// `clock`/`idGen` are injected for deterministic tests. This unit is UI-free and
/// network-free; the completed entry is enqueued to the buffer (sync is 1.7d).
///
/// Not a capture path: manual tracking does NOT route through AckGate (CLAUDE.md §1) —
/// readiness is enforced upstream in MenuViewModel.
final class TimeTracker {
    struct Selection: Equatable {
        let projectId: String?
        let taskId: String?
    }

    enum State: Equatable {
        case idle
        case tracking(entryId: String, startedAt: Date, selection: Selection)
        case paused(selection: Selection)
    }

    private let buffer: TimeEntryBuffering
    private let clock: () -> Date
    private let idGen: (Date) -> String
    private(set) var state: State = .idle

    init(
        buffer: TimeEntryBuffering,
        clock: @escaping () -> Date = Date.init,
        idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) }
    ) {
        self.buffer = buffer
        self.clock = clock
        self.idGen = idGen
    }

    var isRunning: Bool { if case .tracking = state { return true } else { return false } }
    var isPaused: Bool { if case .paused = state { return true } else { return false } }

    func start(projectId: String?, taskId: String?) {
        guard case .tracking = state else {
            open(Selection(projectId: projectId, taskId: taskId))
            return
        }
        // Already tracking — ignore a second start.
    }

    func stop() {
        close()
        state = .idle
    }

    func pause() {
        guard case let .tracking(_, _, selection) = state else { return }
        close()
        state = .paused(selection: selection)
    }

    func resume() {
        guard case let .paused(selection) = state else { return }
        open(selection)
    }

    private func open(_ selection: Selection) {
        let now = clock()
        state = .tracking(entryId: idGen(now), startedAt: now, selection: selection)
    }

    private func close() {
        guard case let .tracking(id, startedAt, selection) = state else { return }
        let payload = TimeEntryPayload(
            id: id,
            projectId: selection.projectId,
            taskId: selection.taskId,
            startTime: Self.iso.string(from: startedAt),
            endTime: Self.iso.string(from: clock()),
            source: "MANUAL",
            note: nil
        )
        if let data = try? JSONEncoder().encode(payload) {
            buffer.enqueue(id: id, payload: data)
        }
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}

/// Matches `CreateTimeEntrySchema` in @timetrack/contracts. projectId/taskId are `.nullable()`
/// (present, may be null) → encoded with `encodeNil`; note is `.optional()` → omitted when nil.
private struct TimeEntryPayload: Encodable {
    let id: String
    let projectId: String?
    let taskId: String?
    let startTime: String
    let endTime: String
    let source: String
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id, projectId, taskId, startTime, endTime, source, note
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        if let projectId { try c.encode(projectId, forKey: .projectId) } else { try c.encodeNil(forKey: .projectId) }
        if let taskId { try c.encode(taskId, forKey: .taskId) } else { try c.encodeNil(forKey: .taskId) }
        try c.encode(startTime, forKey: .startTime)
        try c.encode(endTime, forKey: .endTime)
        try c.encode(source, forKey: .source)
        try c.encodeIfPresent(note, forKey: .note)
    }
}
