import Foundation

/// PRD §7.5 — one-way (client→server) sync. `syncNow()` drains the durable buffer through the
/// uploaders: timeEntry records to `uploader`, then idleEvent records to `idleUploader`; each is
/// removed on confirmed success (2xx). Idempotent on the UUIDv7, so a retried record is a no-op. A
/// transient/auth failure stops the cycle (time-entry failures skip the idle pass) and the caller
/// backs off; a permanent 4xx record is dropped so a poison record can't wedge the queue. Idle
/// events still age-prune each cycle; time entries never do — they are payroll, and an entry that
/// cannot reach the server today (a revoked session, a long outage) must still be there when it can.
/// Not a capture path → not gated by AckGate.
///
/// An actor so the in-flight pass is one piece of state with one owner: the timer, a direct
/// `syncNow()`, and sign-out's `flushForSignOut()` all see the same `inFlight` task, and a caller
/// that arrives mid-pass JOINS it instead of returning early. (As a plain class the re-entry
/// guard was an unsynchronised Bool, and sign-out's final drain hit it and returned at once.)
actor SyncEngine {
    private let buffer: BufferStore
    private let uploader: Uploading
    private let idleUploader: Uploading
    private let backoff: BackoffPolicy
    private let intervalSeconds: TimeInterval
    private let batchLimit: Int
    private let maxAge: TimeInterval
    /// Called (fire-and-forget) when an upload reports `.authFailed` — the session itself was
    /// refused. The owner decides whether that ends the session; the engine only backs off.
    private let onAuthFailed: () -> Void

    private var timer: Timer?
    private var started = false
    private var inFlight: Task<Bool, Never>?
    /// Set once sign-out's flush completes. A retired engine never uploads again, so a late
    /// timer- or capture-triggered pass cannot reach the server under whoever signs in next.
    private var retired = false

    init(buffer: BufferStore, uploader: Uploading, idleUploader: Uploading,
         backoff: BackoffPolicy = BackoffPolicy(),
         intervalSeconds: TimeInterval = 90, batchLimit: Int = 50,
         maxAge: TimeInterval = 7 * 24 * 3600,
         onAuthFailed: @escaping () -> Void = {}) {
        self.buffer = buffer
        self.uploader = uploader
        self.idleUploader = idleUploader
        self.backoff = backoff
        self.intervalSeconds = intervalSeconds
        self.batchLimit = batchLimit
        self.maxAge = maxAge
        self.onAuthFailed = onAuthFailed
    }

    func start() {
        guard !started, !retired else { return }
        started = true
        scheduleNext(after: 0)   // kick immediately
    }

    func stop() {
        started = false
        timer?.invalidate()
        timer = nil
    }

    /// One drain pass. Returns true if it stopped early on a transient/auth failure (the scheduler
    /// then waits a backoff delay). A call that lands while a pass is running joins that pass and
    /// returns its result rather than starting a second one.
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

    /// Await the pass already in flight, if any.
    func finishInFlight() async { _ = await inFlight?.value }

    /// Sign-out: stop scheduling, wait for any pass already running, then drain pass after pass
    /// until the buffer is empty or a pass stops making progress (backed off, or nothing left the
    /// buffer). Whatever is still queued stays on disk for the same user's next session — it is
    /// never cleared here. The engine is retired afterwards.
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
        buffer.prune(kind: .idleEvent, olderThan: maxAge)

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
            case .transient:
                return true                    // stop this cycle; caller backs off
            case .authFailed:
                onAuthFailed()                 // the record stays; the session is the problem
                return true
            }
        }
        return false
    }

    // MARK: - self-scheduling timer glue (build-verified)

    private func runCycle() async {
        // A timer that fired just before stop() must not start a pass after it.
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
