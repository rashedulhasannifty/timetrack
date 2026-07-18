import Foundation

/// PRD §7.5 — one-way (client→server) BATCH drain of the durable activity-sample buffer. Mirrors
/// `ScreenshotSyncEngine` but posts one batch (≤500) per cycle: the whole batch is removed on 201,
/// dropped on a permanent 4xx (poison can't wedge the queue), or kept on transient/auth (caller backs
/// off). One batch per cycle (the timer reschedules) so a failed file-delete can never spin a re-take
/// loop. Stale samples age/count-prune each cycle. Not a capture path → not AckGate-gated.
final class ActivityBatchSyncEngine {
    private let store: ActivitySampleBuffering
    private let uploader: ActivitySampleUploading
    private let backoff: BackoffPolicy
    private let intervalSeconds: TimeInterval
    private let batchLimit: Int
    private let maxAge: TimeInterval
    private let maxCount: Int

    private var timer: Timer?
    private var started = false
    private var isDraining = false
    private var currentCycle: Task<Void, Never>?

    init(store: ActivitySampleBuffering, uploader: ActivitySampleUploading,
         backoff: BackoffPolicy = BackoffPolicy(),
         intervalSeconds: TimeInterval = 90, batchLimit: Int = 500,
         maxAge: TimeInterval = 7 * 24 * 3600, maxCount: Int = 5000) {
        self.store = store
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

    /// One drain pass (one batch). Returns true if it stopped early on transient/auth.
    @discardableResult
    func syncNow() async -> Bool {
        guard !isDraining else { return false }
        isDraining = true
        defer { isDraining = false }

        store.prune(olderThan: maxAge, maxCount: maxCount)

        let batch = store.take(limit: batchLimit)
        guard !batch.isEmpty else { return false }
        switch await uploader.upload(batch) {
        case .success:
            store.remove(ids: batch.map(\.id))
            backoff.reset()
            return false
        case .permanent:
            store.remove(ids: batch.map(\.id))
            return false
        case .transient, .authFailed:
            return true
        }
    }

    /// Await any drain already in flight (used by sign-out teardown before clearing the buffer).
    func finishInFlight() async { await currentCycle?.value }

    // MARK: - self-scheduling timer glue (build-verified)

    private func runCycle() async {
        let backedOff = await syncNow()
        guard started else { return }
        scheduleNext(after: backedOff ? backoff.nextDelay() : intervalSeconds)
    }

    private func scheduleNext(after delay: TimeInterval) {
        timer?.invalidate()
        let t = Timer(timeInterval: max(0.001, delay), repeats: false) { [weak self] _ in
            self?.currentCycle = Task { await self?.runCycle() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }
}
