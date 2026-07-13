import XCTest
@testable import TimeTrack

final class SyncEngineTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func tempBuffer(clock: @escaping () -> Date = Date.init) -> BufferStore {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("synctest-\(UUID().uuidString)", isDirectory: true)
        return BufferStore(directory: dir, clock: clock)
    }

    func testDrainsTimeEntriesAndRemovesOnSuccess() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        buffer.enqueue(id: "t2", kind: .timeEntry, payload: Data("2".utf8))
        let uploader = FakeUploader(results: [.success])
        let engine = SyncEngine(buffer: buffer, uploader: uploader,
                                idleUploader: FakeUploader(results: [.success]))

        await engine.syncNow()

        XCTAssertEqual(uploader.uploadedPayloads.count, 2)
        XCTAssertTrue(buffer.take(kind: .timeEntry, limit: 10).isEmpty, "delivered records removed")
    }

    func testDrainsIdleEventsToIdleUploaderAndRemovesOnSuccess() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("te".utf8))
        buffer.enqueue(id: "e1", kind: .idleEvent, payload: Data("ie".utf8))
        let timeUploader = FakeUploader(results: [.success])
        let idleUploader = FakeUploader(results: [.success])
        let engine = SyncEngine(buffer: buffer, uploader: timeUploader, idleUploader: idleUploader)

        await engine.syncNow()

        // Each kind routed to its own uploader; both buffers drained.
        XCTAssertEqual(timeUploader.uploadedPayloads, [Data("te".utf8)])
        XCTAssertEqual(idleUploader.uploadedPayloads, [Data("ie".utf8)])
        XCTAssertTrue(buffer.take(kind: .timeEntry, limit: 10).isEmpty)
        XCTAssertTrue(buffer.take(kind: .idleEvent, limit: 10).isEmpty, "delivered idle events removed")
    }

    func testIdleTransientStopsCycleAndKeepsIdleRecords() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "e1", kind: .idleEvent, payload: Data("ie".utf8))
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.success]),
                                idleUploader: FakeUploader(results: [.transient]))

        let backedOff = await engine.syncNow()

        XCTAssertTrue(backedOff, "a transient idle upload backs the cycle off")
        XCTAssertEqual(buffer.take(kind: .idleEvent, limit: 10).count, 1, "nothing removed on transient")
    }

    func testTimeEntryTransientStopsBeforeIdlePass() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("te".utf8))
        buffer.enqueue(id: "e1", kind: .idleEvent, payload: Data("ie".utf8))
        let idleUploader = FakeUploader(results: [.success])
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.transient]),
                                idleUploader: idleUploader)

        let backedOff = await engine.syncNow()

        XCTAssertTrue(backedOff)
        XCTAssertEqual(buffer.take(kind: .timeEntry, limit: 10).count, 1, "time entry kept")
        XCTAssertEqual(buffer.take(kind: .idleEvent, limit: 10).count, 1, "idle pass never ran")
        XCTAssertTrue(idleUploader.uploadedPayloads.isEmpty, "idle uploader untouched after early stop")
    }

    func testPermanentFailureDropsPoisonRecord() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.permanent(422)]),
                                idleUploader: FakeUploader(results: [.success]))

        let backedOff = await engine.syncNow()

        XCTAssertFalse(backedOff, "a permanent drop is not a backoff condition")
        XCTAssertTrue(buffer.take(kind: .timeEntry, limit: 10).isEmpty, "poison record dropped")
    }

    func testRetriedRecordRemovedExactlyOnce() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.transient, .success]),
                                idleUploader: FakeUploader(results: [.success]))

        await engine.syncNow()   // transient → kept
        XCTAssertEqual(buffer.take(kind: .timeEntry, limit: 10).count, 1)
        await engine.syncNow()   // success → removed
        XCTAssertTrue(buffer.take(kind: .timeEntry, limit: 10).isEmpty)
    }

    func testPrunesOldRecordsEachCycle() async {
        let clock = MutableClock(t0)
        let buffer = tempBuffer(clock: clock.read)
        buffer.enqueue(id: "old", kind: .idleEvent, payload: Data("o".utf8))  // t0
        clock.advance(10 * 24 * 3600)                                         // now = t0 + 10d
        buffer.enqueue(id: "new", kind: .idleEvent, payload: Data("n".utf8))
        // A transient idle uploader keeps the fresh record, so this isolates prune behavior.
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.success]),
                                idleUploader: FakeUploader(results: [.transient]),
                                maxAge: 7 * 24 * 3600)

        await engine.syncNow()

        XCTAssertEqual(buffer.take(kind: .idleEvent, limit: 10).map(\.id), ["new"],
                       "the 10-day-old idle event was pruned; the fresh one kept")
    }
}
