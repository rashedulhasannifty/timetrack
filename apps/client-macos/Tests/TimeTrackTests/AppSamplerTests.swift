import XCTest
@testable import TimeTrack

final class AppSamplerTests: XCTestCase {
    func testTruncatesToOneTwentyGraphemes() {
        let long = String(repeating: "a", count: 200)
        XCTAssertEqual(AppSampler.truncateTitle(long)?.count, 120)
    }

    func testShortTitleUnchanged() {
        XCTAssertEqual(AppSampler.truncateTitle("Inbox"), "Inbox")
    }

    func testNilAndEmptyBecomeNil() {
        XCTAssertNil(AppSampler.truncateTitle(nil))
        XCTAssertNil(AppSampler.truncateTitle(""))
    }
}
