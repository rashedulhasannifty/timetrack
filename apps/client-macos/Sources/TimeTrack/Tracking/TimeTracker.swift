import Foundation

/// The buffer seam. `BufferStore` (PRD §7.5) already has this method; the protocol lets
/// tests substitute a spy.
protocol TimeEntryBuffering {
    func enqueue(id: String, kind: BufferKind, payload: Data)
}

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

    enum Source: String {
        case manual = "MANUAL"
        case auto = "AUTO"
    }

    enum State: Equatable {
        case idle
        case tracking(entryId: String, startedAt: Date, selection: Selection, source: Source)
        case paused(selection: Selection)
    }

    private let buffer: TimeEntryBuffering
    private let clock: () -> Date
    private let idGen: (Date) -> String
    private let liveSpan: LiveSpanRecording
    private(set) var state: State = .idle

    /// Optional observer of each closed span `[start, end]` (Slice 2.4 day accumulator). Default
    /// nil → no behavioural change and no call-site change. Invoked on the main thread (this type
    /// is main-thread-only), after the entry is enqueued.
    var onSpanClosed: ((_ start: Date, _ end: Date) -> Void)?

    /// Optional observer of each span OPENING (spec §4.1 live publish). Default nil → no
    /// behavioural change and no call-site change. Invoked on the main thread (this type is
    /// main-thread-only), after the live span is recorded.
    var onSpanOpened: ((_ entryId: String, _ start: Date, _ selection: Selection, _ source: Source) -> Void)?

    init(
        buffer: TimeEntryBuffering,
        clock: @escaping () -> Date = Date.init,
        idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) },
        liveSpan: LiveSpanRecording = NoopLiveSpan()
    ) {
        self.buffer = buffer
        self.clock = clock
        self.idGen = idGen
        self.liveSpan = liveSpan
    }

    var isRunning: Bool { if case .tracking = state { return true } else { return false } }
    var isPaused: Bool { if case .paused = state { return true } else { return false } }

    func start(projectId: String?, taskId: String?, source: Source = .manual) {
        guard case .tracking = state else {
            open(Selection(projectId: projectId, taskId: taskId), source: source)
            return
        }
        // Already tracking — ignore a second start.
    }

    /// Close the current entry. `endTime` backdates the close (idle/sleep detected earlier);
    /// defaults to `clock()`. Manual Stop passes nil; auto-stop passes the away-start.
    func stop(at endTime: Date? = nil) {
        close(at: endTime ?? clock())
        state = .idle
    }

    func pause() {
        guard case let .tracking(_, _, selection, _) = state else { return }
        close(at: clock())
        state = .paused(selection: selection)
    }

    func resume() {
        guard case let .paused(selection) = state else { return }
        open(selection, source: .manual)   // pause/resume is a manual-only affordance
    }

    /// Enqueue one already-complete entry without touching the live state. Used for the
    /// Keep-from-idle bridge span (PRD §6.1): the away window becomes its own AUTO entry.
    func recordSpan(id: String? = nil, start: Date, end: Date,
                    projectId: String?, taskId: String?, source: Source) {
        enqueue(id: id ?? idGen(start), projectId: projectId, taskId: taskId,
                start: start, end: end, source: source)
        onSpanClosed?(start, end)
    }

    private func open(_ selection: Selection, source: Source) {
        let now = clock()
        let id = idGen(now)
        state = .tracking(entryId: id, startedAt: now, selection: selection, source: source)
        liveSpan.begin(entryId: id, startTime: now, selection: selection, source: source)
        onSpanOpened?(id, now, selection, source)
    }

    private func close(at endTime: Date) {
        guard case let .tracking(id, startedAt, selection, source) = state else { return }
        enqueue(id: id, projectId: selection.projectId, taskId: selection.taskId,
                start: startedAt, end: endTime, source: source)
        liveSpan.clear()
        onSpanClosed?(startedAt, endTime)
    }

    private func enqueue(id: String, projectId: String?, taskId: String?,
                         start: Date, end: Date, source: Source) {
        let payload = TimeEntryPayload(
            id: id,
            projectId: projectId,
            taskId: taskId,
            startTime: TimeEntryPayload.iso.string(from: start),
            endTime: TimeEntryPayload.iso.string(from: end),
            source: source.rawValue,
            note: nil
        )
        if let data = try? JSONEncoder().encode(payload) {
            buffer.enqueue(id: id, kind: .timeEntry, payload: data)
        }
    }
}
