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

    // MARK: - time entries are payroll: never age-pruned

    func testTimeEntriesAreNeverAgePruned() async {
        let clock = MutableClock(t0)
        let buffer = tempBuffer(clock: clock.read)
        buffer.enqueue(id: "old-entry", kind: .timeEntry, payload: Data("t".utf8))   // t0
        clock.advance(30 * 24 * 3600)                                                // a month later
        // Transient: the session can't deliver it (offline, or revoked and awaiting re-login).
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.transient]),
                                idleUploader: FakeUploader(results: [.success]),
                                maxAge: 7 * 24 * 3600)

        await engine.syncNow()

        XCTAssertEqual(buffer.take(kind: .timeEntry, limit: 10).map(\.id), ["old-entry"],
                       "an undelivered time entry outlives the age limit")
    }

    // MARK: - sign-out flush

    func testFlushForSignOutDrainsPassAfterPassUntilEmpty() async {
        let buffer = tempBuffer()
        for id in ["t1", "t2", "t3"] { buffer.enqueue(id: id, kind: .timeEntry, payload: Data(id.utf8)) }
        let uploader = FakeUploader(results: [.success])
        // One record per pass: a single final pass (the old sign-out) would leave two behind.
        let engine = SyncEngine(buffer: buffer, uploader: uploader,
                                idleUploader: FakeUploader(results: [.success]), batchLimit: 1)

        await engine.flushForSignOut()

        XCTAssertEqual(uploader.uploadedPayloads.count, 3)
        XCTAssertEqual(buffer.pendingCount(), 0)
    }

    func testFlushForSignOutStopsWhenAPassMakesNoProgressAndKeepsTheRest() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        buffer.enqueue(id: "t2", kind: .timeEntry, payload: Data("2".utf8))
        let uploader = FakeUploader(results: [.transient])
        let engine = SyncEngine(buffer: buffer, uploader: uploader,
                                idleUploader: FakeUploader(results: [.success]))

        await engine.flushForSignOut()

        XCTAssertEqual(uploader.uploadedPayloads.count, 1, "one failed pass, no spinning")
        XCTAssertEqual(buffer.pendingCount(), 2, "unsent records stay on disk — sign-out never clears them")
    }

    /// The bug: sign-out's final `syncNow()` found the timer's pass running, returned at once,
    /// and the buffer was cleared under it. The flush must wait for that pass and then keep going.
    func testFlushForSignOutJoinsThePassAlreadyRunning() async {
        let buffer = tempBuffer()
        for id in ["t1", "t2", "t3"] { buffer.enqueue(id: id, kind: .timeEntry, payload: Data(id.utf8)) }
        let uploader = GatedUploader()
        let entered = expectation(description: "first upload in flight")
        uploader.onEnter = { entered.fulfill() }
        let engine = SyncEngine(buffer: buffer, uploader: uploader,
                                idleUploader: FakeUploader(results: [.success]), batchLimit: 1)

        let running = Task { await engine.syncNow() }
        await fulfillment(of: [entered], timeout: 5)
        let flush = Task { await engine.flushForSignOut() }
        for _ in 0..<20 { await Task.yield() }   // let the flush reach the engine and park
        uploader.release()
        _ = await running.value
        await flush.value

        XCTAssertEqual(uploader.uploadCount, 3, "the running pass finished and the flush drained the rest")
        XCTAssertEqual(buffer.pendingCount(), 0)
    }

    func testRetiredEngineNeverUploadsAgain() async {
        let buffer = tempBuffer()
        let uploader = FakeUploader(results: [.success])
        let engine = SyncEngine(buffer: buffer, uploader: uploader,
                                idleUploader: FakeUploader(results: [.success]))
        await engine.flushForSignOut()

        // Whatever reaches the buffer after sign-out is settled by the next session's owner
        // check — never by a late pass of this engine.
        buffer.enqueue(id: "late", kind: .timeEntry, payload: Data("l".utf8))
        let backedOff = await engine.syncNow()

        XCTAssertFalse(backedOff)
        XCTAssertTrue(uploader.uploadedPayloads.isEmpty)
        XCTAssertEqual(buffer.pendingCount(), 1)
    }

    // MARK: - a refused session

    func testAuthFailedReportsTheSessionAndKeepsTheRecord() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        let reports = CallCounter()
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.authFailed]),
                                idleUploader: FakeUploader(results: [.success]),
                                onAuthFailed: { reports.increment() })

        let backedOff = await engine.syncNow()

        XCTAssertTrue(backedOff)
        XCTAssertEqual(reports.value, 1)
        XCTAssertEqual(buffer.pendingCount(), 1, "kept for the same user's next session")
    }

    func testTransientDoesNotReportTheSession() async {
        let buffer = tempBuffer()
        buffer.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        let reports = CallCounter()
        let engine = SyncEngine(buffer: buffer, uploader: FakeUploader(results: [.transient]),
                                idleUploader: FakeUploader(results: [.success]),
                                onAuthFailed: { reports.increment() })

        await engine.syncNow()

        XCTAssertEqual(reports.value, 0, "offline is not a dead session")
    }
}
