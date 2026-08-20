import XCTest
@testable import TimeTrack

final class ScreenshotSyncEngineTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    // Pin the buffer clock to t0 so the engine's start-of-cycle prune (7-day max-age)
    // computes its cutoff relative to t0, not the real wall clock — otherwise every
    // t0-dated (2023) record would be age-pruned before it could be uploaded.
    private func tempBuffer() -> ImageBufferStore {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("imgsync-\(UUID().uuidString)", isDirectory: true)
        return ImageBufferStore(directory: dir, clock: { self.t0 })
    }

    func testDrainsAndRemovesOnSuccess() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8))
        buffer.enqueue(id: "b", capturedAt: t0.addingTimeInterval(1), jpeg: Data("2".utf8))
        let uploader = FakeScreenshotUploader(results: [.success])
        let engine = ScreenshotSyncEngine(buffer: buffer, uploader: uploader)

        let backedOff = await engine.syncNow()

        XCTAssertFalse(backedOff)
        XCTAssertEqual(uploader.uploadedIds, ["a", "b"])
        XCTAssertTrue(buffer.take(limit: 10).isEmpty, "delivered images removed")
    }

    /// The group is stamped at capture time and has to reach the server through the durable
    /// buffer — a drain that dropped it would upload the displays of one tick as unrelated
    /// screenshots, which is precisely what the grouping exists to prevent.
    func testCarriesTheCaptureGroupThroughTheDrain() async {
        let buffer = tempBuffer()
        let group = CaptureGroup(id: "g1", displayIndex: 1, displayCount: 2)
        buffer.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8), group: group)
        let uploader = FakeScreenshotUploader(results: [.success])

        await ScreenshotSyncEngine(buffer: buffer, uploader: uploader).syncNow()

        XCTAssertEqual(uploader.uploadedGroups, [group])
    }

    /// A capture buffered by the previous build has no group. It still uploads — dropping it
    /// after an update would lose recorded time.
    func testUploadsAnUngroupedRecordFromTheOlderBuild() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8))
        let uploader = FakeScreenshotUploader(results: [.success])

        await ScreenshotSyncEngine(buffer: buffer, uploader: uploader).syncNow()

        XCTAssertEqual(uploader.uploadedIds, ["a"])
        XCTAssertEqual(uploader.uploadedGroups, [nil])
    }

    func testTransientStopsCycleAndKeepsRecords() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8))
        let engine = ScreenshotSyncEngine(buffer: buffer, uploader: FakeScreenshotUploader(results: [.transient]))

        let backedOff = await engine.syncNow()

        XCTAssertTrue(backedOff, "a transient upload backs the cycle off")
        XCTAssertEqual(buffer.take(limit: 10).count, 1, "nothing removed on transient")
    }

    func testPermanentDropsPoisonRecord() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8))
        let engine = ScreenshotSyncEngine(buffer: buffer, uploader: FakeScreenshotUploader(results: [.permanent(422)]))

        let backedOff = await engine.syncNow()

        XCTAssertFalse(backedOff, "a permanent drop is not a backoff condition")
        XCTAssertTrue(buffer.take(limit: 10).isEmpty, "poison image dropped")
    }

    func testAuthFailedStopsCycle() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8))
        let engine = ScreenshotSyncEngine(buffer: buffer, uploader: FakeScreenshotUploader(results: [.authFailed]))

        let backedOff = await engine.syncNow()

        XCTAssertTrue(backedOff)
        XCTAssertEqual(buffer.take(limit: 10).count, 1, "kept for retry after re-auth")
    }

    func testRetriedRecordRemovedExactlyOnce() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8))
        let engine = ScreenshotSyncEngine(buffer: buffer, uploader: FakeScreenshotUploader(results: [.transient, .success]))

        await engine.syncNow()   // transient → kept
        XCTAssertEqual(buffer.take(limit: 10).count, 1)
        await engine.syncNow()   // success → removed
        XCTAssertTrue(buffer.take(limit: 10).isEmpty)
    }
}
