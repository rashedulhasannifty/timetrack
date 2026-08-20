import Foundation

/// PRD §7.4/§7.5 — one-way (client→server) drain of the durable image buffer. Mirrors `SyncEngine`
/// but for a single binary kind and its own multipart uploader (2.2a mandates a separate path).
/// Each image is removed on confirmed success (201), dropped on a permanent 4xx (poison can't wedge
/// the queue), or kept on transient/auth (caller backs off). Stale images age/count-prune each cycle.
/// Not a capture path → not AckGate-gated; safe on both the online and offline-marker branches.
final class ScreenshotSyncEngine {
    private let buffer: ImageBufferStore
    private let uploader: ScreenshotUploading
    private let backoff: BackoffPolicy
    private let intervalSeconds: TimeInterval
    private let batchLimit: Int
    private let maxAge: TimeInterval
    private let maxCount: Int

    private var timer: Timer?
    private var started = false
    private var isDraining = false

    init(buffer: ImageBufferStore, uploader: ScreenshotUploading,
         backoff: BackoffPolicy = BackoffPolicy(),
         intervalSeconds: TimeInterval = 90, batchLimit: Int = 20,
         maxAge: TimeInterval = 7 * 24 * 3600, maxCount: Int = 500) {
        self.buffer = buffer
        self.uploader = uploader
        self.backoff = backoff
        self.intervalSeconds = intervalSeconds
        self.batchLimit = batchLimit
        self.maxAge = maxAge
        self.maxCount = maxCount
    }

    func start() {
        guard !started else { return }
        started = true
        scheduleNext(after: 0)
    }

    func stop() {
        started = false
        timer?.invalidate()
        timer = nil
    }

    /// One drain pass. Returns true if it stopped early on a transient/auth failure.
    @discardableResult
    func syncNow() async -> Bool {
        guard !isDraining else { return false }
        isDraining = true
        defer { isDraining = false }

        buffer.prune(olderThan: maxAge, maxCount: maxCount)

        for record in buffer.take(limit: batchLimit) {
            guard let jpeg = try? Data(contentsOf: record.url) else {
                buffer.remove(id: record.id)   // unreadable file can't be uploaded — drop it
                continue
            }
            switch await uploader.upload(id: record.id, capturedAt: record.capturedAt,
                                         group: record.group, jpeg: jpeg) {
            case .success:
                buffer.remove(id: record.id)
                backoff.reset()
            case .permanent:
                buffer.remove(id: record.id)
            case .transient, .authFailed:
                return true
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
