import Foundation

/// PRD §7.4/§7.5 — one-way (client→server) drain of the durable image buffer. Mirrors `SyncEngine`
/// but for a single binary kind and its own multipart uploader (2.2a mandates a separate path).
/// Each image is removed on confirmed success (201), dropped on a permanent 4xx (poison can't wedge
/// the queue), or kept on transient/auth (caller backs off). Stale images age/count-prune each cycle.
/// Not a capture path → not AckGate-gated; safe on both the online and offline-marker branches.
///
/// An actor for the same reason as `SyncEngine`: one owner for the in-flight pass, so sign-out's
/// flush joins a running pass instead of being turned away by it.
actor ScreenshotSyncEngine {
    private let buffer: ImageBufferStore
    private let uploader: ScreenshotUploading
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

    init(buffer: ImageBufferStore, uploader: ScreenshotUploading,
         backoff: BackoffPolicy = BackoffPolicy(),
         intervalSeconds: TimeInterval = 90, batchLimit: Int = 20,
         maxAge: TimeInterval = 7 * 24 * 3600, maxCount: Int = 500,
         onAuthFailed: @escaping () -> Void = {}) {
        self.buffer = buffer
        self.uploader = uploader
        self.backoff = backoff
        self.intervalSeconds = intervalSeconds
        self.batchLimit = batchLimit
        self.maxAge = maxAge
        self.maxCount = maxCount
        self.onAuthFailed = onAuthFailed
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

    /// One drain pass. Returns true if it stopped early on a transient/auth failure. A call that
    /// lands mid-pass joins the running pass.
    @discardableResult
    func syncNow() async -> Bool {
        guard !retired else { return false }
        if let inFlight { return await inFlight.value }
        let pass = Task { await self.drainPass() }
        inFlight = pass
        let backedOff = await pass.value
        inFlight = nil
        return backedOff
    }

    /// Await the pass already in flight, if any.
    func finishInFlight() async { _ = await inFlight?.value }

    /// Sign-out: same contract as `SyncEngine.flushForSignOut` — drain until empty or no
    /// progress, keep the rest on disk, retire the engine.
    func flushForSignOut(maxPasses: Int = 100) async {
        stop()
        await finishInFlight()
        var pending = buffer.pendingCount()
        var passes = 0
        while pending > 0, passes < maxPasses {
            passes += 1
            let backedOff = await syncNow()
            let after = buffer.pendingCount()
            if backedOff || after >= pending { break }
            pending = after
        }
        retired = true
    }

    private func drainPass() async -> Bool {
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
            case .transient:
                return true
            case .authFailed:
                onAuthFailed()
                return true
            }
        }
        return false
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
