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

    // Server schema is `appName: z.string().max(200)` — a pathological localizedName must not 422 the batch.
    func testAppNameTruncatesToTwoHundredCharacters() {
        let long = String(repeating: "a", count: 250)
        XCTAssertEqual(AppSampler.truncateAppName(long)?.count, 200)
    }

    func testShortAppNameUnchanged() {
        XCTAssertEqual(AppSampler.truncateAppName("Xcode"), "Xcode")
    }

    func testNilAppNameStaysNil() {
        XCTAssertNil(AppSampler.truncateAppName(nil))
    }
}
