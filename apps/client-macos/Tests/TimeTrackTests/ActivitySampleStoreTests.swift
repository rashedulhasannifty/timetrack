import XCTest
@testable import TimeTrack

final class ActivitySampleStoreTests: XCTestCase {
    private var now = Date(timeIntervalSince1970: 1_700_000_000)
    private func tempStore() -> ActivitySampleStore {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("act-\(UUID().uuidString)", isDirectory: true)
        return ActivitySampleStore(directory: dir, clock: { self.now })
    }
    private func sample(_ id: String, pct: Int = 50) -> ActivitySample {
        ActivitySample(id: id, timestamp: "2023-11-14T22:13:20Z", appName: "Xcode",
                       windowTitle: nil, activityPct: pct, category: "PRODUCTIVE")
    }

    func testEnqueueTakeFifoAndRoundTrip() {
        let s = tempStore()
        now = Date(timeIntervalSince1970: 1_700_000_001); s.enqueue(sample("a", pct: 10))
        now = Date(timeIntervalSince1970: 1_700_000_002); s.enqueue(sample("b", pct: 20))
        let taken = s.take(limit: 10)
        XCTAssertEqual(taken.map(\.id), ["a", "b"])
        XCTAssertEqual(taken.first?.activityPct, 10) // full round-trip
    }

    func testRemoveIds() {
        let s = tempStore()
        s.enqueue(sample("a")); s.enqueue(sample("b"))
        s.remove(ids: ["a"])
        XCTAssertEqual(s.take(limit: 10).map(\.id), ["b"])
    }

    func testTakeRespectsLimit() {
        let s = tempStore()
        for i in 0..<5 { now = now.addingTimeInterval(1); s.enqueue(sample("id\(i)")) }
        XCTAssertEqual(s.take(limit: 2).count, 2)
    }

    func testPruneByCount() {
        let s = tempStore()
        for i in 0..<5 { now = now.addingTimeInterval(1); s.enqueue(sample("id\(i)")) }
        s.prune(olderThan: 3600, maxCount: 2)
        XCTAssertEqual(s.take(limit: 10).count, 2) // oldest trimmed
    }

    func testClear() {
        let s = tempStore()
        s.enqueue(sample("a"))
        s.clear()
        XCTAssertEqual(s.take(limit: 10).count, 0)
    }
}
