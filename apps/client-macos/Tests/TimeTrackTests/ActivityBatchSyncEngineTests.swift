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

    func testEmptyBufferIsNoop() async {
        let store = tempStore()
        let up = FakeActivityUploader(results: [.success])
        let backedOff = await engine(store, up).syncNow()
        XCTAssertFalse(backedOff)
        XCTAssertTrue(up.batches.isEmpty)
    }
}
