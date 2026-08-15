import XCTest
@testable import TimeTrack

final class AppVersionTests: XCTestCase {
    func testComparesNumericallyNotLexically() {
        // The case string comparison gets wrong: "0.10.0" < "0.9.0" as text.
        XCTAssertTrue(AppVersion("0.9.0")! < AppVersion("0.10.0")!)
        XCTAssertFalse(AppVersion("0.10.0")! < AppVersion("0.9.0")!)
    }

    func testMissingComponentsAreZero() {
        XCTAssertEqual(AppVersion("0.2")!, AppVersion("0.2.0")!)
        XCTAssertTrue(AppVersion("0.2")! < AppVersion("0.2.1")!)
    }

    func testStripsTagPrefixAndPreReleaseSuffix() {
        XCTAssertEqual(AppVersion("v0.2.0")!, AppVersion("0.2.0")!)
        XCTAssertEqual(AppVersion("0.2.0-beta.1")!, AppVersion("0.2.0")!)
        XCTAssertEqual(AppVersion("0.2.0+build7")!, AppVersion("0.2.0")!)
    }

    func testRejectsUnparseable() {
        XCTAssertNil(AppVersion("nightly"))
        XCTAssertNil(AppVersion(""))
        XCTAssertNil(AppVersion("1.x.0"))
        XCTAssertNil(AppVersion("-1.0.0"))
    }

    func testDescriptionRoundTrips() {
        XCTAssertEqual(AppVersion("v1.4.9")!.description, "1.4.9")
    }
}
