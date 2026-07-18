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

    // MARK: - windowTitle encodes as explicit JSON null (never omitted)
    //
    // Server contract (packages/contracts/src/activity.ts) declares windowTitle as
    // `.nullable()` but NOT `.optional()`. Swift's synthesized Codable uses
    // encodeIfPresent for Optionals, which OMITS the key entirely when nil — that fails
    // Zod's nullable-but-required check with a 422. When captureWindowTitles=false,
    // every sample in a batch would be rejected.

    func testEncodingNilWindowTitleProducesExplicitNullKey() throws {
        let s = sample("a")
        XCTAssertNil(s.windowTitle)

        let data = try JSONEncoder().encode(s)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        XCTAssertNotNil(obj)
        XCTAssertTrue(obj?.keys.contains("windowTitle") ?? false,
                       "windowTitle key must be present (as null), not omitted")
        XCTAssertTrue(obj?["windowTitle"] is NSNull,
                       "windowTitle must serialize as JSON null when nil")
    }

    func testEncodingNilWindowTitleRoundTrips() throws {
        let s = sample("a")
        let data = try JSONEncoder().encode(s)
        let decoded = try JSONDecoder().decode(ActivitySample.self, from: data)
        XCTAssertNil(decoded.windowTitle)
        XCTAssertEqual(decoded, s)
    }

    func testDecodingExplicitNullWindowTitle() throws {
        let json = """
        {"id":"a","timestamp":"2023-11-14T22:13:20Z","appName":"Xcode",
         "windowTitle":null,"activityPct":50,"category":"PRODUCTIVE"}
        """
        let decoded = try JSONDecoder().decode(ActivitySample.self, from: Data(json.utf8))
        XCTAssertNil(decoded.windowTitle)
    }

    func testDecodingStringWindowTitle() throws {
        let json = """
        {"id":"a","timestamp":"2023-11-14T22:13:20Z","appName":"Xcode",
         "windowTitle":"x","activityPct":50,"category":"PRODUCTIVE"}
        """
        let decoded = try JSONDecoder().decode(ActivitySample.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.windowTitle, "x")
    }
}
