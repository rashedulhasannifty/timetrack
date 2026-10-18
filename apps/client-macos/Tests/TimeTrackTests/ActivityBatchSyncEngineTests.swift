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

    // MARK: - a 422/413 isolates the bad sample instead of dropping the batch

    /// Rejects (with `status`) any batch containing one of `bad`; accepts everything else.
    private final class RejectingUploader: ActivitySampleUploading {
        let bad: Set<String>
        let status: Int
        private(set) var batches: [[String]] = []
        init(bad: Set<String>, status: Int = 422) { self.bad = bad; self.status = status }
        func upload(_ samples: [ActivitySample]) async -> UploadResult {
            let ids = samples.map(\.id)
            batches.append(ids)
            return ids.contains(where: bad.contains) ? .permanent(status) : .success
        }
    }

    /// Run cycles until the buffer is empty (bounded), one `syncNow()` per cycle.
    private func drainByCycles(_ engine: ActivityBatchSyncEngine, _ store: ActivitySampleStore,
                               maxCycles: Int = 100) async -> Int {
        var cycles = 0
        while !store.take(limit: 1).isEmpty, cycles < maxCycles {
            await engine.syncNow()
            cycles += 1
        }
        return cycles
    }

    func testRejectedBatchIsSplitUntilOnlyTheBadSampleIsDropped() async {
        let ids = (0..<16).map { "s\($0)" }
        let store = tempStore(); seed(store, ids)
        let up = RejectingUploader(bad: ["s11"])
        let engine = ActivityBatchSyncEngine(store: store, uploader: up, batchLimit: 16)

        let cycles = await drainByCycles(engine, store)

        XCTAssertEqual(up.batches.count, cycles, "exactly one batch per cycle — no inner retry loop")
        let accepted = up.batches.filter { !$0.contains("s11") }.flatMap { $0 }
        XCTAssertEqual(Set(accepted), Set(ids).subtracting(["s11"]), "every good sample delivered")
        XCTAssertEqual(accepted.count, 15, "and each delivered once")
        XCTAssertEqual(up.batches.last(where: { $0.contains("s11") }), ["s11"],
                       "the bad sample was isolated before it was dropped")
        XCTAssertTrue(store.take(limit: 100).isEmpty)
        XCTAssertLessThan(cycles, 20)
    }

    func testPayloadTooLargeSplitsTheSameWay() async {
        let store = tempStore(); seed(store, ["a", "b", "c", "d"])
        let up = RejectingUploader(bad: ["a"], status: 413)
        let engine = ActivityBatchSyncEngine(store: store, uploader: up, batchLimit: 4)

        _ = await drainByCycles(engine, store)

        XCTAssertEqual(up.batches, [["a", "b", "c", "d"], ["a", "b"], ["a"], ["b", "c", "d"]])
    }

    func testOtherPermanentStatusesStillDropTheWholeBatch() async {
        let store = tempStore(); seed(store, ["a", "b"])
        let up = RejectingUploader(bad: ["a"], status: 400)

        await ActivityBatchSyncEngine(store: store, uploader: up).syncNow()

        XCTAssertEqual(up.batches, [["a", "b"]])
        XCTAssertTrue(store.take(limit: 10).isEmpty, "a 400 is not about one sample: dropped as before")
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
