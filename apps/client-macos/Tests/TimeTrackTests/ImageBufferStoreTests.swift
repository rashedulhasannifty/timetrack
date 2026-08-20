import XCTest
@testable import TimeTrack

final class ImageBufferStoreTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeStore(clock: @escaping () -> Date = Date.init) -> (ImageBufferStore, URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("imgbuf-\(UUID().uuidString)", isDirectory: true)
        return (ImageBufferStore(directory: dir, clock: clock), dir)
    }

    func testEnqueueWritesOneFileWithExactBytes() throws {
        let (store, dir) = makeStore()
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3])
        store.enqueue(id: "id-1", capturedAt: t0, jpeg: jpeg)

        let files = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasSuffix(".jpg") }
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(try Data(contentsOf: files[0]), jpeg, "content is the raw image bytes")
    }

    func testEnqueueRoundTripsTheCaptureGroup() {
        let (store, _) = makeStore()
        let group = CaptureGroup(id: "group-1", displayIndex: 1, displayCount: 2)
        store.enqueue(id: "id-1", capturedAt: t0, jpeg: Data([1]), group: group)

        let taken = store.take(limit: 10)
        XCTAssertEqual(taken.count, 1)
        XCTAssertEqual(taken[0].group, group, "the group survives the on-disk round trip")
        XCTAssertEqual(taken[0].id, "id-1", "identity is unchanged by carrying a group")
    }

    /// UPGRADE COMPATIBILITY. Records written by the build currently installed on pilot Macs use
    /// the two-component name `<millis>__<id>.jpg`. After an update those files are still sitting
    /// in Application Support, un-uploaded. A parser that only understood the new five-component
    /// name would skip them silently and the pending captures would be pruned away unsent — real
    /// recorded time, lost on the floor during an update.
    func testDrainsRecordsWrittenByThePreviousBuild() throws {
        let (store, dir) = makeStore()
        let millis = Int64(t0.timeIntervalSince1970 * 1000)
        try Data([9]).write(to: dir.appendingPathComponent("\(millis)__legacy-id.jpg"))

        let taken = store.take(limit: 10)
        XCTAssertEqual(taken.map(\.id), ["legacy-id"], "the old two-component name still parses")
        XCTAssertNil(taken[0].group, "no group — it was a single main-display grab, and says so")
        XCTAssertEqual(taken[0].capturedAt.timeIntervalSince1970, t0.timeIntervalSince1970, accuracy: 0.001)
    }

    /// The displays of one tick share a capture time, so FIFO alone leaves their order to the
    /// filesystem. `remove` must still target exactly one of them.
    func testRemovesOneDisplayOfAGroupWithoutTouchingTheOthers() {
        let (store, _) = makeStore()
        store.enqueue(id: "left", capturedAt: t0, jpeg: Data([1]),
                      group: CaptureGroup(id: "g", displayIndex: 0, displayCount: 2))
        store.enqueue(id: "right", capturedAt: t0, jpeg: Data([2]),
                      group: CaptureGroup(id: "g", displayIndex: 1, displayCount: 2))

        store.remove(id: "left")

        XCTAssertEqual(store.take(limit: 10).map(\.id), ["right"])
    }

    func testTakeReturnsFifoWithIdAndCapturedAtHonoringLimit() {
        let (store, _) = makeStore()
        store.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8))
        store.enqueue(id: "b", capturedAt: t0.addingTimeInterval(1), jpeg: Data("2".utf8))
        store.enqueue(id: "c", capturedAt: t0.addingTimeInterval(2), jpeg: Data("3".utf8))

        let taken = store.take(limit: 2)
        XCTAssertEqual(taken.map(\.id), ["a", "b"], "FIFO by capture time, limit honored")
        XCTAssertEqual(taken[0].capturedAt.timeIntervalSince1970, t0.timeIntervalSince1970, accuracy: 0.001)
    }

    func testRemoveDeletesJustThatRecord() {
        let (store, _) = makeStore()
        store.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8))
        store.enqueue(id: "b", capturedAt: t0.addingTimeInterval(1), jpeg: Data("2".utf8))
        store.remove(id: "a")
        XCTAssertEqual(store.take(limit: 10).map(\.id), ["b"])
    }

    func testPruneDropsRecordsOlderThanMaxAge() {
        let clock = MutableClock(t0)
        let (store, _) = makeStore(clock: clock.read)
        store.enqueue(id: "old", capturedAt: t0, jpeg: Data("o".utf8))
        clock.advance(10 * 24 * 3600)
        store.enqueue(id: "new", capturedAt: clock.read(), jpeg: Data("n".utf8))

        store.prune(olderThan: 7 * 24 * 3600, maxCount: 1000)
        XCTAssertEqual(store.take(limit: 10).map(\.id), ["new"])
    }

    func testPruneTrimsOldestBeyondMaxCount() {
        let clock = MutableClock(t0)
        let (store, _) = makeStore(clock: clock.read)
        for i in 0..<5 {
            store.enqueue(id: "id-\(i)", capturedAt: t0.addingTimeInterval(Double(i)), jpeg: Data("\(i)".utf8))
        }
        store.prune(olderThan: 30 * 24 * 3600, maxCount: 2)   // nothing age-expired; keep 2 newest
        XCTAssertEqual(store.take(limit: 10).map(\.id), ["id-3", "id-4"], "oldest trimmed to the count cap")
    }

    func testClearEmptiesTheBuffer() {
        let (store, _) = makeStore()
        store.enqueue(id: "a", capturedAt: t0, jpeg: Data("1".utf8))
        store.clear()
        XCTAssertTrue(store.take(limit: 10).isEmpty)
    }

    func testLeftoverTempFileIsSweptOnInit() throws {
        let (_, dir) = makeStore()
        try Data("partial".utf8).write(to: dir.appendingPathComponent(".tmp-ghost"))
        let store2 = ImageBufferStore(directory: dir)
        XCTAssertTrue(store2.take(limit: 10).isEmpty)
        let leftover = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix(".tmp-") }
        XCTAssertTrue(leftover.isEmpty)
    }
}
