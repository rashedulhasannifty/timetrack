import Foundation

/// PRD §7.5 — one-way (client→server) sync. `syncNow()` drains the durable buffer through the
/// uploaders: timeEntry records to `uploader`, then idleEvent records to `idleUploader`; each is
/// removed on confirmed success (2xx). Idempotent on the UUIDv7, so a retried record is a no-op. A
/// transient/auth failure stops the cycle (time-entry failures skip the idle pass) and the caller
/// backs off; a permanent 4xx record is dropped so a poison record can't wedge the queue. Stale
/// records still age-prune each cycle. Not a capture path → not gated by AckGate. The
/// timer/scheduling glue is build-verified; `syncNow()`/`drain` are unit-tested.
final class SyncEngine {
    private let buffer: BufferStore
    private let uploader: Uploading
    private let idleUploader: Uploading
    private let backoff: BackoffPolicy
    private let intervalSeconds: TimeInterval
    private let batchLimit: Int
    private let maxAge: TimeInterval

    private var timer: Timer?
    private var started = false
    private var isDraining = false

    init(buffer: BufferStore, uploader: Uploading, idleUploader: Uploading,
         backoff: BackoffPolicy = BackoffPolicy(),
         intervalSeconds: TimeInterval = 90, batchLimit: Int = 50,
         maxAge: TimeInterval = 7 * 24 * 3600) {
        self.buffer = buffer
        self.uploader = uploader
        self.idleUploader = idleUploader
        self.backoff = backoff
        self.intervalSeconds = intervalSeconds
        self.batchLimit = batchLimit
        self.maxAge = maxAge
    }

    func start() {
        guard !started else { return }
        started = true
        scheduleNext(after: 0)   // kick immediately
    }

    func stop() {
        started = false
        timer?.invalidate()
        timer = nil
    }

    /// One drain pass. Returns true if it stopped early on a transient/auth failure (the scheduler
    /// then waits a backoff delay). Safe to call directly — sign-out does a best-effort final drain.
    @discardableResult
    func syncNow() async -> Bool {
        guard !isDraining else { return false }
        isDraining = true
        defer { isDraining = false }

        buffer.prune(olderThan: maxAge)

        // Time entries first; a transient/auth failure there stops the whole cycle (the
        // session is likely unusable, so the idle pass would fail too) and the caller backs off.
        if await drain(kind: .timeEntry, using: uploader) { return true }
        if await drain(kind: .idleEvent, using: idleUploader) { return true }
        return false
    }

    /// One drain pass for a single buffer kind. Returns true if it stopped early on a
    /// transient/auth failure. Each record is removed on confirmed success (2xx) or dropped
    /// on a permanent 4xx (a poison record can't wedge the queue). Idempotent on the UUIDv7.
    private func drain(kind: BufferKind, using uploader: Uploading) async -> Bool {
        for record in buffer.take(kind: kind, limit: batchLimit) {
            switch await uploader.upload(record.payload) {
            case .success:
                buffer.remove(id: record.id)
                backoff.reset()
            case .permanent:
                buffer.remove(id: record.id)   // drop the poison record so it can't wedge the queue
            case .transient, .authFailed:
                return true                    // stop this cycle; caller backs off
            }
        }
        return false
    }

    // MARK: - self-scheduling timer glue (build-verified)

    private func runCycle() async {
        let backedOff = await syncNow()
        guard started else { return }
        scheduleNext(after: backedOff ? backoff.nextDelay() : intervalSeconds)
    }

    private func scheduleNext(after delay: TimeInterval) {
        timer?.invalidate()
        let t = Timer(timeInterval: max(0.001, delay), repeats: false) { [weak self] _ in
            Task { await self?.runCycle() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }
}
