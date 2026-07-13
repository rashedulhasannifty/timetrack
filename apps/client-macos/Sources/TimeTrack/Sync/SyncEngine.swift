import Foundation

/// PRD §7.5 — one-way (client→server) sync. `syncNow()` drains the durable buffer's timeEntry
/// records through the uploader; each is removed on confirmed success (2xx). Idempotent on the
/// UUIDv7, so a retried record is a no-op. A transient/auth failure stops the cycle and the caller
/// backs off; a permanent 4xx record is dropped so a poison record can't wedge the queue. idleEvent
/// records are left buffered (no server endpoint yet) and age-pruned. A self-scheduling timer runs
/// cycles at `intervalSeconds`, or after `backoff.nextDelay()` on failure. Not a capture path → not
/// gated by AckGate. The timer/scheduling glue is build-verified; `syncNow()` is unit-tested.
final class SyncEngine {
    private let buffer: BufferStore
    private let uploader: Uploading
    private let backoff: BackoffPolicy
    private let intervalSeconds: TimeInterval
    private let batchLimit: Int
    private let maxAge: TimeInterval

    private var timer: Timer?
    private var started = false
    private var isDraining = false

    init(buffer: BufferStore, uploader: Uploading, backoff: BackoffPolicy = BackoffPolicy(),
         intervalSeconds: TimeInterval = 90, batchLimit: Int = 50,
         maxAge: TimeInterval = 7 * 24 * 3600) {
        self.buffer = buffer
        self.uploader = uploader
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

        for record in buffer.take(kind: .timeEntry, limit: batchLimit) {
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
