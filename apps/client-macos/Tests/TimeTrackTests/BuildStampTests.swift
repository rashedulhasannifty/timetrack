import XCTest
@testable import TimeTrack

final class BuildStampTests: XCTestCase {
    func testShowsVersionAndBuildForAReleaseInstall() {
        XCTAssertEqual(BuildStamp.text(version: "0.5.0", build: "6", variant: nil), "v0.5.0 (6)")
    }

    /// The side-by-side dev build talks to localhost and looks almost identical in the menu bar.
    /// Naming it is the whole point — the release build stays unmarked.
    func testNamesANonProductionInstall() {
        XCTAssertEqual(BuildStamp.text(version: "0.5.0", build: "6", variant: "dev"),
                       "v0.5.0 (6) · dev")
    }

    /// Two different binaries once both reported 0.4.1, because a build shipped without the
    /// version being bumped. The build number is what tells them apart.
    func testBuildNumberDistinguishesTwoBuildsOfOneVersion() {
        XCTAssertNotEqual(BuildStamp.text(version: "0.4.1", build: "5", variant: nil),
                          BuildStamp.text(version: "0.4.1", build: "6", variant: nil))
    }

    /// `swift run` has no Info.plist. "v (0)" would be worse than showing nothing.
    func testShowsNothingWithoutAVersion() {
        XCTAssertNil(BuildStamp.text(version: nil, build: "6", variant: "dev"))
        XCTAssertNil(BuildStamp.text(version: "", build: "6", variant: nil))
    }

    /// A missing build number is not a reason to hide the version.
    func testFallsBackToTheVersionAloneWhenThereIsNoBuild() {
        XCTAssertEqual(BuildStamp.text(version: "0.5.0", build: nil, variant: nil), "v0.5.0")
        XCTAssertEqual(BuildStamp.text(version: "0.5.0", build: "", variant: "dev"),
                       "v0.5.0 · dev")
    }

    /// Reading the real bundle must not crash or invent a value under the test host.
    func testReadingTheCurrentBundleIsSafe() {
        _ = BuildStamp.current()
    }
}
