import XCTest
@testable import TimeTrack

final class UpdateEvaluatorTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func manifest(_ version: String, publishedDaysAgo days: Double) -> ReleaseManifest {
        ReleaseManifest(
            version: AppVersion(version)!,
            publishedAt: now.addingTimeInterval(-days * 24 * 60 * 60),
            zipURL: URL(string: "https://example.invalid/TimeTrack-pilot.zip")!,
            sha256: String(repeating: "a", count: 64)
        )
    }

    func testSameVersionIsCurrent() {
        let s = UpdateEvaluator().evaluate(current: AppVersion("0.2.0"),
                                           latest: manifest("0.2.0", publishedDaysAgo: 30),
                                           now: now)
        XCTAssertEqual(s, .unknownOrCurrent)
    }

    func testNewerLocalBuildIsNotAnUpdate() {
        // A developer running ahead of the published release must not be nagged.
        let s = UpdateEvaluator().evaluate(current: AppVersion("0.3.0"),
                                           latest: manifest("0.2.0", publishedDaysAgo: 30),
                                           now: now)
        XCTAssertEqual(s, .unknownOrCurrent)
    }

    func testRecentReleaseIsAdvisory() {
        let m = manifest("0.3.0", publishedDaysAgo: 2)
        let s = UpdateEvaluator(graceDays: 7).evaluate(current: AppVersion("0.2.0"), latest: m, now: now)
        XCTAssertEqual(s, .available(m))
        XCTAssertFalse(s.isOverdue)
    }

    func testEscalatesOnceGraceElapses() {
        let m = manifest("0.3.0", publishedDaysAgo: 8)
        let s = UpdateEvaluator(graceDays: 7).evaluate(current: AppVersion("0.2.0"), latest: m, now: now)
        XCTAssertEqual(s, .overdue(m))
        XCTAssertTrue(s.isOverdue)
    }

    func testGraceBoundaryIsNotYetOverdue() {
        let m = manifest("0.3.0", publishedDaysAgo: 7)
        let s = UpdateEvaluator(graceDays: 7).evaluate(current: AppVersion("0.2.0"), latest: m, now: now)
        XCTAssertEqual(s, .available(m))
    }

    func testFutureDatedReleaseDoesNotEscalate() {
        // Clock skew or a backdated tag must not jump straight to the loud state.
        let m = manifest("0.3.0", publishedDaysAgo: -3)
        let s = UpdateEvaluator(graceDays: 7).evaluate(current: AppVersion("0.2.0"), latest: m, now: now)
        XCTAssertEqual(s, .available(m))
    }

    func testUnreadableRunningVersionSaysNothing() {
        // `swift run` has no Info.plist. Treating that as "older than everything" would nag
        // every developer on every launch.
        let s = UpdateEvaluator().evaluate(current: nil,
                                           latest: manifest("9.9.9", publishedDaysAgo: 60),
                                           now: now)
        XCTAssertEqual(s, .unknownOrCurrent)
    }

    func testFailedCheckSaysNothing() {
        let s = UpdateEvaluator().evaluate(current: AppVersion("0.1.0"), latest: nil, now: now)
        XCTAssertEqual(s, .unknownOrCurrent)
    }
}

final class ChecksumParsingTests: XCTestCase {
    private func parse(_ s: String) -> String? {
        GitHubReleaseFeed.parseChecksum(Data(s.utf8))
    }

    func testAcceptsBareDigest() {
        let d = String(repeating: "a1", count: 32)
        XCTAssertEqual(parse(d), d)
    }

    func testAcceptsShasumOutput() {
        let d = String(repeating: "b2", count: 32)
        XCTAssertEqual(parse("\(d)  TimeTrack-pilot.zip\n"), d)
    }

    func testNormalisesCase() {
        let d = String(repeating: "AB", count: 32)
        XCTAssertEqual(parse(d), d.lowercased())
    }

    func testRejectsWrongLengthOrNonHex() {
        XCTAssertNil(parse("deadbeef"))
        XCTAssertNil(parse(String(repeating: "z", count: 64)))
        XCTAssertNil(parse(""))
    }
}
