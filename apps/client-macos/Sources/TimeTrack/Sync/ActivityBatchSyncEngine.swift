import Foundation

/// PRD §7.5 — one-way (client→server) BATCH drain of the durable activity-sample buffer. Mirrors
/// `ScreenshotSyncEngine` but posts one batch (≤500) per cycle: the whole batch is removed on 201,
/// dropped on a permanent 4xx (poison can't wedge the queue), or kept on transient/auth (caller backs
/// off). One batch per cycle (the timer reschedules) so a failed file-delete can never spin a re-take
/// loop. Stale samples age/count-prune each cycle. Not a capture path → not AckGate-gated.
///
/// A 422 or 413 does NOT drop the batch: one bad sample (say, a title the server measures as too
/// long) used to take up to 500 good ones with it. `BatchSplitter` halves the next batch instead,
/// cycle by cycle, until the offending sample is alone — then only it is dropped. Still one batch
/// per cycle. Any other permanent 4xx drops the batch as before.
///
/// An actor for the same reason as `SyncEngine`: one owner for the in-flight pass, so sign-out's
/// flush joins a running pass instead of being turned away by it.
actor ActivityBatchSyncEngine {
    private let store: ActivitySampleBuffering
    private let uploader: ActivitySampleUploading
    private let backoff: BackoffPolicy
    private let intervalSeconds: TimeInterval
    private let batchLimit: Int
    private let maxAge: TimeInterval
    private let maxCount: Int
    private let onAuthFailed: () -> Void

    private var timer: Timer?
    private var started = false
    private var inFlight: Task<Bool, Never>?
    private var retired = false
    private var splitter: BatchSplitter

    init(store: ActivitySampleBuffering, uploader: ActivitySampleUploading,
         backoff: BackoffPolicy = BackoffPolicy(),
         intervalSeconds: TimeInterval = 90, batchLimit: Int = 500,
         maxAge: TimeInterval = 7 * 24 * 3600, maxCount: Int = 5000,
         onAuthFailed: @escaping () -> Void = {}) {
        self.store = store
        self.uploader = uploader
        self.backoff = backoff
        self.intervalSeconds = intervalSeconds
        self.batchLimit = batchLimit
        self.maxAge = maxAge
        self.maxCount = maxCount
        self.onAuthFailed = onAuthFailed
        self.splitter = BatchSplitter(fullSize: batchLimit)
    }

    func start() {
        guard !started, !retired else { return }
        started = true
        scheduleNext(after: 0)
    }

    func stop() {
        started = false
        timer?.invalidate()
        timer = nil
    }

    /// One drain pass (one batch). Returns true if it stopped early on transient/auth. A call that
    /// lands mid-pass joins the running pass.
    @discardableResult
    func syncNow() async -> Bool {
        guard !retired else { return false }
        if let inFlight { return await inFlight.value }
        // The pass clears `inFlight` itself, on the actor, as its last step — so no caller can
        // ever join a pass that has already finished and mistake its stale result for a new one.
        let pass = Task { () -> Bool in
            let backedOff = await self.drainPass()
            self.inFlight = nil
            return backedOff
        }
        inFlight = pass
        return await pass.value
    }

    /// Await any drain already in flight.
    func finishInFlight() async { _ = await inFlight?.value }

    /// Sign-out: same contract as `SyncEngine.flushForSignOut`. One batch per pass still holds —
    /// the loop moves on only while each pass shrinks the buffer, so it cannot spin.
    func flushForSignOut(maxPasses: Int = 100) async {
        stop()
        await finishInFlight()
        var pending = store.pendingCount()
        var passes = 0
        while pending > 0, passes < maxPasses {
            passes += 1
            let backedOff = await syncNow()
            let after = store.pendingCount()
            if backedOff || after >= pending { break }
            pending = after
        }
        retired = true
    }

    private func drainPass() async -> Bool {
        store.prune(olderThan: maxAge, maxCount: maxCount)

        let batch = store.take(limit: min(batchLimit, splitter.size))
        guard !batch.isEmpty else { return false }
        switch await uploader.upload(batch) {
        case .success:
            store.remove(ids: batch.map(\.id))
            splitter.accepted()
            backoff.reset()
            return false
        case .permanent(let status) where BatchSplitter.isSplittable(status: status):
            // Something in the batch was refused. Keep it and send half next cycle, until the
            // refused sample is on its own; only then drop it.
            if splitter.rejected(count: batch.count) { store.remove(ids: batch.map(\.id)) }
            return false
        case .permanent:
            store.remove(ids: batch.map(\.id))
            return false
        case .transient:
            return true
        case .authFailed:
            onAuthFailed()
            return true
        }
    }

    // MARK: - self-scheduling timer glue (build-verified)

    private func runCycle() async {
        guard started else { return }
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
