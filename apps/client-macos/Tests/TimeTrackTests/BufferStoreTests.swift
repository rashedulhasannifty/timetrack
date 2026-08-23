import XCTest
@testable import TimeTrack

final class BufferStoreTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeStore(clock: @escaping () -> Date = Date.init) -> (BufferStore, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("bufstore-\(UUID().uuidString)", isDirectory: true)
        return (BufferStore(directory: dir, clock: clock), dir)
    }

    func testPendingCountCountsEveryKindAndTracksDrain() {
        let (store, _) = makeStore()
        XCTAssertEqual(store.pendingCount(), 0)

        store.enqueue(id: "id-1", kind: .timeEntry, payload: Data("{}".utf8))
        store.enqueue(id: "id-2", kind: .idleEvent, payload: Data("{}".utf8))
        // Both kinds are the person's own record waiting to reach the server, so both count.
        XCTAssertEqual(store.pendingCount(), 2)

        store.remove(id: "id-1")
        XCTAssertEqual(store.pendingCount(), 1)
    }

    func testEnqueueWritesOneFileWithExactPayload() throws {
        let (store, dir) = makeStore()
        let payload = Data(#"{"id":"id-1","source":"MANUAL"}"#.utf8)
        store.enqueue(id: "id-1", kind: .timeEntry, payload: payload)

        let files = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasSuffix(".json") }
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(try Data(contentsOf: files[0]), payload, "content is the raw payload, no envelope")
    }

    func testTakeReturnsOnlyKindInFifoOrderHonoringLimit() {
        let clock = MutableClock(t0)
        let (store, _) = makeStore(clock: clock.read)
        store.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8)); clock.advance(1)
        store.enqueue(id: "e1", kind: .idleEvent, payload: Data("2".utf8)); clock.advance(1)
        store.enqueue(id: "t2", kind: .timeEntry, payload: Data("3".utf8)); clock.advance(1)
        store.enqueue(id: "t3", kind: .timeEntry, payload: Data("4".utf8))

        let taken = store.take(kind: .timeEntry, limit: 2)
        XCTAssertEqual(taken.map(\.id), ["t1", "t2"], "FIFO by createdAt, idleEvent excluded, limit honored")
        XCTAssertEqual(store.take(kind: .idleEvent, limit: 10).map(\.id), ["e1"])
    }

    func testRemoveDeletesJustThatRecord() {
        let (store, _) = makeStore()
        store.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        store.enqueue(id: "t2", kind: .timeEntry, payload: Data("2".utf8))
        store.remove(id: "t1")
        XCTAssertEqual(store.take(kind: .timeEntry, limit: 10).map(\.id), ["t2"])
    }

    func testPruneDropsRecordsOlderThanMaxAge() {
        let clock = MutableClock(t0)
        let (store, _) = makeStore(clock: clock.read)
        store.enqueue(id: "old", kind: .idleEvent, payload: Data("o".utf8))  // created at t0
        clock.advance(10 * 24 * 3600)                                         // now = t0 + 10d
        store.enqueue(id: "new", kind: .idleEvent, payload: Data("n".utf8))

        store.prune(olderThan: 7 * 24 * 3600)                                 // cutoff = t0 + 3d
        XCTAssertEqual(store.take(kind: .idleEvent, limit: 10).map(\.id), ["new"])
    }

    func testClearEmptiesTheBuffer() {
        let (store, _) = makeStore()
        store.enqueue(id: "t1", kind: .timeEntry, payload: Data("1".utf8))
        store.enqueue(id: "e1", kind: .idleEvent, payload: Data("2".utf8))
        store.clear()
        XCTAssertTrue(store.take(kind: .timeEntry, limit: 10).isEmpty)
        XCTAssertTrue(store.take(kind: .idleEvent, limit: 10).isEmpty)
    }

    func testLeftoverTempFileIsSweptAndNeverSurfaces() throws {
        let (store, dir) = makeStore()
        // Simulate a crash between write and rename: a .tmp-* file with no final record.
        try Data("partial".utf8).write(to: dir.appendingPathComponent(".tmp-ghost"))
        _ = store // already inited; re-init to trigger the sweep
        let store2 = BufferStore(directory: dir)
        XCTAssertTrue(store2.take(kind: .timeEntry, limit: 10).isEmpty)
        let leftover = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix(".tmp-") }
        XCTAssertTrue(leftover.isEmpty, "the .tmp sweep removed the partial file")
    }
}
