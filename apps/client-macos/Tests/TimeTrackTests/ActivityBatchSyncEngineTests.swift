import XCTest
@testable import TimeTrack

final class ActivityBatchSyncEngineTests: XCTestCase {
    private func tempStore() -> ActivitySampleStore {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("actsync-\(UUID().uuidString)", isDirectory: true)
        return ActivitySampleStore(directory: dir)
    }
    private func seed(_ store: ActivitySampleStore, _ ids: [String]) {
        for id in ids {
            store.enqueue(ActivitySample(id: id, timestamp: "2023-11-14T22:13:20Z", appName: "Xcode",
                                         bundleId: nil, windowTitle: nil, activityPct: 50,
                                         category: "NEUTRAL"))
        }
    }
    private func engine(_ store: ActivitySampleStore, _ up: FakeActivityUploader) -> ActivityBatchSyncEngine {
        ActivityBatchSyncEngine(store: store, uploader: up)
    }

    func testSuccessRemovesWholeBatch() async {
        let store = tempStore(); seed(store, ["a", "b"])
        let up = FakeActivityUploader(results: [.success])
        let backedOff = await engine(store, up).syncNow()
        XCTAssertFalse(backedOff)
        XCTAssertEqual(up.batches.first?.map(\.id), ["a", "b"])
        XCTAssertEqual(store.take(limit: 10).count, 0)
    }

    func testPermanentDropsBatch() async {
        let store = tempStore(); seed(store, ["a"])
        let up = FakeActivityUploader(results: [.permanent(422)])
        _ = await engine(store, up).syncNow()
        XCTAssertEqual(store.take(limit: 10).count, 0) // poison batch dropped
    }

    func testTransientKeepsBatchAndBacksOff() async {
        let store = tempStore(); seed(store, ["a"])
        let up = FakeActivityUploader(results: [.transient])
        let backedOff = await engine(store, up).syncNow()
        XCTAssertTrue(backedOff)
        XCTAssertEqual(store.take(limit: 10).count, 1) // kept for retry
    }

    func testFlushForSignOutDrainsEveryBatchThenRetires() async {
        let store = tempStore(); seed(store, ["a", "b", "c"])
        let up = FakeActivityUploader(results: [.success])
        let engine = ActivityBatchSyncEngine(store: store, uploader: up, batchLimit: 2)

        await engine.flushForSignOut()

        XCTAssertEqual(up.batches.map { $0.map(\.id) }, [["a", "b"], ["c"]])
        XCTAssertEqual(store.pendingCount(), 0)
        seed(store, ["late"])
        await engine.syncNow()
        XCTAssertEqual(up.batches.count, 2, "a retired engine never uploads again")
    }

    func testFlushForSignOutKeepsSamplesItCannotSend() async {
        let store = tempStore(); seed(store, ["a", "b"])
        let up = FakeActivityUploader(results: [.transient])
        await ActivityBatchSyncEngine(store: store, uploader: up).flushForSignOut()
        XCTAssertEqual(up.batches.count, 1, "no progress ends the flush")
        XCTAssertEqual(store.pendingCount(), 2, "kept on disk for the same user")
    }

    func testAuthFailedReportsTheSessionAndKeepsTheBatch() async {
        let store = tempStore(); seed(store, ["a"])
        let reports = CallCounter()
        let engine = ActivityBatchSyncEngine(store: store, uploader: FakeActivityUploader(results: [.authFailed]),
                                             onAuthFailed: { reports.increment() })
        let backedOff = await engine.syncNow()
        XCTAssertTrue(backedOff)
        XCTAssertEqual(reports.value, 1)
        XCTAssertEqual(store.pendingCount(), 1)
    }

    func testEmptyBufferIsNoop() async {
        let store = tempStore()
        let up = FakeActivityUploader(results: [.success])
        let backedOff = await engine(store, up).syncNow()
        XCTAssertFalse(backedOff)
        XCTAssertTrue(up.batches.isEmpty)
    }
}
