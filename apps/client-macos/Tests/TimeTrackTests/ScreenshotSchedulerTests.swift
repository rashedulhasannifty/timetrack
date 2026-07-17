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
        XCTAssertTrue(succeeded, "capture-succeeded surfaced (clears warning, sets indicator)")
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
}
