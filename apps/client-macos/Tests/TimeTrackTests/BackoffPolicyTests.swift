import XCTest
@testable import TimeTrack

final class BackoffPolicyTests: XCTestCase {
    func testExponentialGrowthThenCap() {
        let b = BackoffPolicy(base: 5, maxDelay: 300, jitter: { $0 })
        XCTAssertEqual(b.nextDelay(), 5)
        XCTAssertEqual(b.nextDelay(), 10)
        XCTAssertEqual(b.nextDelay(), 20)
        XCTAssertEqual(b.nextDelay(), 40)
        XCTAssertEqual(b.nextDelay(), 80)
        XCTAssertEqual(b.nextDelay(), 160)
        XCTAssertEqual(b.nextDelay(), 300, "320 is capped at maxDelay")
        XCTAssertEqual(b.nextDelay(), 300)
    }

    func testResetReturnsToBase() {
        let b = BackoffPolicy(base: 5, maxDelay: 300, jitter: { $0 })
        _ = b.nextDelay(); _ = b.nextDelay(); _ = b.nextDelay()
        b.reset()
        XCTAssertEqual(b.nextDelay(), 5)
    }

    func testJitterIsApplied() {
        let b = BackoffPolicy(base: 8, maxDelay: 300, jitter: { $0 * 0.5 })
        XCTAssertEqual(b.nextDelay(), 4, "jitter transform is applied to the computed delay")
    }
}
