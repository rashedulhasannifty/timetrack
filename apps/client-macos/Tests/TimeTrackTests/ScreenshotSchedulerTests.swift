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
        isPermitted: @escaping () -> Bool = { true },
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
            isPermitted: isPermitted,
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

    /// The multi-monitor case: one tick, one capture time, one group id, one row per display.
    /// A group whose members disagreed on the capture time or the group id would be scattered
    /// across the dashboard as unrelated screenshots — the exact bug this feature removes.
    func testCapturesEveryDisplayIntoOneGroup() async {
        let buffer = tempBuffer()
        let grabber = FakeDisplayGrabber(.displays([Data([1]), Data([2])], attempted: 2))
        let sched = makeScheduler(ackRequired: false, grabber: grabber, buffer: buffer,
                                  isTracking: { true })

        await sched.captureTick()

        let taken = buffer.take(limit: 10)
        XCTAssertEqual(taken.count, 2, "one record per attached display")
        XCTAssertEqual(Set(taken.map { $0.group?.id }).count, 1, "both displays share one group id")
        XCTAssertEqual(taken.compactMap { $0.group?.displayIndex }.sorted(), [0, 1])
        XCTAssertEqual(taken.compactMap { $0.group?.displayCount }, [2, 2])
        XCTAssertEqual(Set(taken.map { $0.id }).count, 2, "distinct server ids — the PK is per shot")
        XCTAssertEqual(Set(taken.map { $0.capturedAt }).count, 1, "one capture instant for the tick")
    }

    /// A display that failed on its own must not take the rest of the desk down with it: the
    /// captures that worked are still enqueued, and `displayCount` records what was attempted so
    /// the group reads as incomplete rather than as the whole desk.
    func testEnqueuesTheDisplaysThatCapturedWhenOneFails() async {
        let buffer = tempBuffer()
        let grabber = FakeDisplayGrabber(.displays([Data([1])], attempted: 2))
        var succeeded = false
        let sched = makeScheduler(ackRequired: false, grabber: grabber, buffer: buffer,
                                  isTracking: { true },
                                  onCaptureSucceeded: { succeeded = true })

        await sched.captureTick()

        let taken = buffer.take(limit: 10)
        XCTAssertEqual(taken.count, 1)
        XCTAssertEqual(taken[0].group?.displayCount, 2, "records what was attempted, not what landed")
        XCTAssertTrue(succeeded, "a partial capture is still a capture — no permission warning")
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

    /// Regression (per-interval Screen Recording re-prompt): when the non-prompting preflight
    /// reports permission missing, `captureTick` must surface the warning and NEVER enter the
    /// grabber — entering ScreenCaptureKit is what re-triggered the OS dialog every interval. A
    /// grabber that WOULD have succeeded (`.bytes`, not `.fail`) proves the point: `grabCount == 0`
    /// can only hold because the preflight guard short-circuited before the grab, not because the
    /// grab itself failed.
    func testDeniedPreflightSurfacesWarningAndNeverGrabs() async {
        let buffer = tempBuffer()
        let grabber = FakeDisplayGrabber(.bytes(Data([0xFF, 0xD8, 0xFF])))
        var denied = false
        var succeeded = false
        let sched = makeScheduler(ackRequired: false, grabber: grabber, buffer: buffer,
                                  isTracking: { true },
                                  isPermitted: { false },
                                  onPermissionDenied: { denied = true },
                                  onCaptureSucceeded: { succeeded = true })

        await sched.captureTick()

        XCTAssertEqual(grabber.grabCount, 0, "denied preflight → ScreenCaptureKit never entered (no re-prompt)")
        XCTAssertTrue(denied, "permission-denied surfaced to the menu bar")
        XCTAssertFalse(succeeded, "no capture success on a denied tick")
        XCTAssertTrue(buffer.take(limit: 10).isEmpty, "nothing enqueued when permission is missing")
    }

    /// Regression (sign-out cross-user integrity race): a capture cycle suspended inside `grab()`
    /// must have its `enqueue` completed before `finishInFlight()` returns. Sign-out teardown
    /// awaits `finishInFlight()` before `ImageBufferStore.clear()`, so proving the join blocks
    /// until the enqueue lands proves teardown cannot clear the buffer out from under an in-flight
    /// capture (which would otherwise leak into the next user's upload).
    ///
    /// Deterministic: `BlockingGrabber` is an actor whose `grabAll()` suspends until the test calls
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

    func grabAll() async throws -> DisplayGrabResult {
        isGrabbing = true
        grabbingSignal?.resume()
        grabbingSignal = nil
        if !isReleased {
            await withCheckedContinuation { releaseSignal = $0 }
        }
        return DisplayGrabResult(captures: [DisplayCapture(index: 0, jpeg: bytes)], attempted: 1)
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
