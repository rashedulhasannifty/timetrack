import XCTest
@testable import TimeTrack

final class ActivityRateMeterTests: XCTestCase {
    private func meter(_ deltas: [(UInt64, UInt64)], buckets: Int = 12) -> Int {
        var m = ActivityRateMeter(buckets: buckets)
        for d in deltas { m.addBucket(delta: (keys: d.0, pointer: d.1)) }
        return m.activityPct()
    }

    func testAllIdleIsZero() {
        XCTAssertEqual(meter(Array(repeating: (0, 0), count: 12)), 0)
    }

    func testAllActiveIsHundred() {
        XCTAssertEqual(meter(Array(repeating: (1, 0), count: 12)), 100)
    }

    func testPointerOnlyBucketCountsActive() {
        XCTAssertEqual(meter(Array(repeating: (0, 3), count: 12)), 100)
    }

    func testSevenOfTwelveRoundsToFiftyEight() {
        var deltas = Array(repeating: (1 as UInt64, 0 as UInt64), count: 7)
        deltas += Array(repeating: (0, 0), count: 5)
        XCTAssertEqual(meter(deltas), 58) // round(7/12*100) = round(58.33) = 58
    }

    func testIgnoresBucketsBeyondCapacity() {
        // 13th bucket is dropped; only the first 12 count.
        var deltas = Array(repeating: (1 as UInt64, 0 as UInt64), count: 12)
        deltas.append((0, 0))
        XCTAssertEqual(meter(deltas), 100)
    }
}
