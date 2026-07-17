import XCTest
@testable import TimeTrack

final class ScreenshotSchedulerTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func tempBuffer() -> ImageBufferStore {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("sched-\(UUID().uuidString)", isDirectory: true)
        return ImageBufferStore(directory: dir)
    }

    private func makeScheduler(
        ackRequired: Bool,
        grabber: DisplayGrabbing,
        buffer: ImageBufferStore,
        isTracking: @escaping () -> Bool,
        onCaptured: @escaping () -> Void = {},
        onPermissionDenied: @escaping () -> Void = {},
        onCaptureSucceeded: @escaping () -> Void = {}
    ) -> ScreenshotScheduler {
        ScreenshotScheduler(
            ackGate: AckGate(policyProvider: FakePolicyProvider(ackRequired: ackRequired)),
            grabber: grabber,
            buffer: buffer,
            intervalMinutes: 10,
            isTracking: isTracking,
            clock: { self.t0 },
            onCaptured: onCaptured,
            onPermissionDenied: onPermissionDenied,
            onCaptureSucceeded: onCaptureSucceeded
        )
    }

    func testCapturesAndEnqueuesWhenTrackingAndAcked() async {
        let buffer = tempBuffer()
        let grabber = FakeDisplayGrabber(.bytes(Data([0xFF, 0xD8, 0xFF])))
        var kicked = false
        var succeeded = false
        let sched = makeScheduler(ackRequired: false, grabber: grabber, buffer: buffer,
                                  isTracking: { true },
                                  onCaptured: { kicked = true },
                                  onCaptureSucceeded: { succeeded = true })

        await sched.captureTick()

        XCTAssertEqual(grabber.grabCount, 1)
        let taken = buffer.take(limit: 10)
        XCTAssertEqual(taken.count, 1, "one image enqueued")
        XCTAssertEqual(taken[0].capturedAt.timeIntervalSince1970, t0.timeIntervalSince1970, accuracy: 0.001,
                       "capturedAt stamped from the clock and persisted")
        XCTAssertTrue(kicked, "upload drain kicked")
        XCTAssertTrue(succeeded, "capture-succeeded surfaced (clears the permission warning)")
    }

    func testSkipsWhenNotTracking() async {
        let buffer = tempBuffer()
        let grabber = FakeDisplayGrabber(.bytes(Data([1])))
        let sched = makeScheduler(ackRequired: false, grabber: grabber, buffer: buffer, isTracking: { false })

        await sched.captureTick()

        XCTAssertEqual(grabber.grabCount, 0, "no grab when the clock is stopped")
        XCTAssertTrue(buffer.take(limit: 10).isEmpty)
    }

    func testSkipsWhenGateClosed() async {
        let buffer = tempBuffer()
        let grabber = FakeDisplayGrabber(.bytes(Data([1])))
        let sched = makeScheduler(ackRequired: true, grabber: grabber, buffer: buffer, isTracking: { true })

        await sched.captureTick()

        XCTAssertEqual(grabber.grabCount, 0, "AckGate closed → no capture")
        XCTAssertTrue(buffer.take(limit: 10).isEmpty)
    }

    func testPermissionDeniedSurfacesAndKeepsBufferEmpty() async {
        let buffer = tempBuffer()
        let grabber = FakeDisplayGrabber(.fail(DisplayGrabError.notPermitted))
        var denied = false
        let sched = makeScheduler(ackRequired: false, grabber: grabber, buffer: buffer,
                                  isTracking: { true },
                                  onPermissionDenied: { denied = true })

        await sched.captureTick()

        XCTAssertTrue(denied, "permission-denied surfaced to the menu bar")
        XCTAssertTrue(buffer.take(limit: 10).isEmpty, "nothing enqueued on a failed grab")
    }

    /// Regression (sign-out cross-user integrity race): a capture cycle suspended inside `grab()`
    /// must have its `enqueue` completed before `finishInFlight()` returns. Sign-out teardown
    /// awaits `finishInFlight()` before `ImageBufferStore.clear()`, so proving the join blocks
    /// until the enqueue lands proves teardown cannot clear the buffer out from under an in-flight
    /// capture (which would otherwise leak into the next user's upload).
    ///
    /// Deterministic: `BlockingGrabber` is an actor whose `grab()` suspends until the test calls
    /// `release()`, and `finishInFlight()` awaits `currentCycle.value`, which structurally cannot
    /// return until the cycle (including `enqueue`) has completed — no sleeps, no polling.
    func testFinishInFlightAwaitsInFlightEnqueueBeforeReturning() async {
        let buffer = tempBuffer()
        let grabber = BlockingGrabber(bytes: Data([0xFF, 0xD8, 0xFF]))
        let sched = makeScheduler(ackRequired: false, grabber: grabber, buffer: buffer,
                                  isTracking: { true })

        sched.startCycle()                     // spawns currentCycle; grab() will suspend
        await grabber.waitUntilGrabbing()

        XCTAssertTrue(buffer.take(limit: 10).isEmpty, "grab suspended → nothing enqueued yet")

        // finishInFlight() must not return until the in-flight capture has enqueued.
        let finished = Task { await sched.finishInFlight() }
        await grabber.release()
        await finished.value

        XCTAssertEqual(buffer.take(limit: 10).count, 1,
                       "finishInFlight() returned only after the in-flight capture enqueued")
    }
}

/// Actor-isolated grabber that parks inside `grab()` until the test calls `release()`, so a test
/// can observe scheduler state while a capture is suspended mid-grab. Actor isolation makes the
/// two continuations race-free regardless of which side (grab / test) reaches its rendezvous first.
private actor BlockingGrabber: DisplayGrabbing {
    private let bytes: Data
    private var isGrabbing = false
    private var isReleased = false
    private var grabbingSignal: CheckedContinuation<Void, Never>?
    private var releaseSignal: CheckedContinuation<Void, Never>?

    init(bytes: Data) { self.bytes = bytes }

    func grab() async throws -> Data {
        isGrabbing = true
        grabbingSignal?.resume()
        grabbingSignal = nil
        if !isReleased {
            await withCheckedContinuation { releaseSignal = $0 }
        }
        return bytes
    }

    /// Returns once `grab()` has been entered (immediately if it already has).
    func waitUntilGrabbing() async {
        if isGrabbing { return }
        await withCheckedContinuation { grabbingSignal = $0 }
    }

    /// Unblock the parked `grab()` so the cycle can proceed to `enqueue`.
    func release() {
        isReleased = true
        releaseSignal?.resume()
        releaseSignal = nil
    }
}
