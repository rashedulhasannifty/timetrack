import Foundation

/// PRD §6.2 — the capture trigger. A single self-gating interval timer (mirrors the heartbeat
/// timer's `guard isTracking`): each tick, only while the clock runs and only through `AckGate`,
/// it grabs the screen, writes to the durable image buffer, and kicks the upload drain. Capture is
/// tied to time tracking (design decision: no screenshots on a stopped clock). The interval and
/// enablement are an install-time snapshot — the caller builds this only when `screenshotsEnabled`,
/// and ack-revocation is caught per tick by the gate. Never captures on a closed gate; a missing
/// Screen Recording permission surfaces a menu-bar warning and the timer keeps running so capture
/// self-heals once granted.
final class ScreenshotScheduler {
    private let ackGate: AckGate
    private let grabber: DisplayGrabbing
    private let buffer: ImageBufferStore
    private let intervalSeconds: TimeInterval
    private let isTracking: () -> Bool
    private let idGen: (Date) -> String
    private let clock: () -> Date
    private let onCaptured: () -> Void
    private let onPermissionDenied: () -> Void
    private let onCaptureSucceeded: () -> Void

    private var timer: Timer?
    private var started = false
    private var isCapturing = false
    private var currentCycle: Task<Void, Never>?

    init(ackGate: AckGate, grabber: DisplayGrabbing, buffer: ImageBufferStore,
         intervalMinutes: Int, isTracking: @escaping () -> Bool,
         idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) },
         clock: @escaping () -> Date = Date.init,
         onCaptured: @escaping () -> Void = {},
         onPermissionDenied: @escaping () -> Void = {},
         onCaptureSucceeded: @escaping () -> Void = {}) {
        self.ackGate = ackGate
        self.grabber = grabber
        self.buffer = buffer
        self.intervalSeconds = TimeInterval(intervalMinutes * 60)
        self.isTracking = isTracking
        self.idGen = idGen
        self.clock = clock
        self.onCaptured = onCaptured
        self.onPermissionDenied = onPermissionDenied
        self.onCaptureSucceeded = onCaptureSucceeded
    }

    func start() {
        guard !started else { return }
        started = true
        scheduleNext()
    }

    func stop() {
        started = false
        timer?.invalidate()
        timer = nil
    }

    /// One capture attempt. `isTracking` is checked BEFORE the gate so a stopped clock never
    /// triggers a policy fetch. The whole grab runs inside `AckGate.withCaptureAllowed`.
    func captureTick() async {
        guard !isCapturing else { return }
        guard isTracking() else { return }
        isCapturing = true
        defer { isCapturing = false }
        do {
            try await ackGate.withCaptureAllowed { [self] in
                let capturedAt = clock()
                let id = idGen(capturedAt)
                let jpeg = try await grabber.grab()
                buffer.enqueue(id: id, capturedAt: capturedAt, jpeg: jpeg)
                onCaptureSucceeded()
                onCaptured()
            }
        } catch DisplayGrabError.notPermitted {
            onPermissionDenied()
        } catch {
            // Gate closed (ackRequired / offline) or another grab error → skip this tick.
        }
    }

    // MARK: - self-scheduling timer glue (build-verified)

    /// Spawn a capture cycle and hold it as `currentCycle` so sign-out teardown can join it via
    /// `finishInFlight()`. `internal` (not `private`) so the regression test can drive one cycle.
    func startCycle() {
        currentCycle = Task { [weak self] in
            await self?.captureTick()
            guard let self, self.started else { return }
            self.scheduleNext()
        }
    }

    /// Await any capture cycle already in flight (spawned before `stop()`). Sign-out teardown
    /// MUST await this before clearing the image buffer, or a capture suspended mid-grab could
    /// enqueue into the just-cleared buffer and upload under the next user's token.
    func finishInFlight() async { await currentCycle?.value }

    private func scheduleNext() {
        timer?.invalidate()
        let t = Timer(timeInterval: max(0.001, intervalSeconds), repeats: false) { [weak self] _ in
            self?.startCycle()
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }
}
