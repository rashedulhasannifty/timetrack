import XCTest
@testable import TimeTrack

final class AppInstallTests: XCTestCase {
    private let production = AppInstall.productionBundleId

    /// THE regression this file exists for. The released app has records sitting in
    /// ~/Library/Application Support/TimeTrack/ and a refresh token under
    /// "com.timetrack.client" on employee Macs right now. If isolating dev builds also renamed
    /// production's container, every released install would come up after an update looking at an
    /// empty directory — pending captures and time entries stranded, then pruned away unsent.
    func testProductionKeepsItsHistoricalNames() {
        XCTAssertEqual(AppInstall.supportDirectoryName(bundleId: production), "TimeTrack")
        XCTAssertEqual(AppInstall.keychainService(bundleId: production), "com.timetrack.client")
        XCTAssertNil(AppInstall.variant(bundleId: production))
        XCTAssertTrue(AppInstall.isProduction(bundleId: production))
    }

    func testDevBuildGetsItsOwnContainerAndKeychainService() {
        let dev = "\(AppInstall.productionBundleId).dev"
        XCTAssertEqual(AppInstall.supportDirectoryName(bundleId: dev), "TimeTrack-dev")
        XCTAssertEqual(AppInstall.keychainService(bundleId: dev), "com.timetrack.client.dev")
        XCTAssertFalse(AppInstall.isProduction(bundleId: dev))
    }

    func testEachVariantIsDistinctFromTheOthers() {
        let names = [
            AppInstall.supportDirectoryName(bundleId: production),
            AppInstall.supportDirectoryName(bundleId: "\(production).dev"),
            AppInstall.supportDirectoryName(bundleId: "\(production).staging"),
            AppInstall.supportDirectoryName(bundleId: nil),
        ]
        XCTAssertEqual(Set(names).count, names.count - 1,
                       "only nil and .dev intentionally coincide; the rest are distinct")
        XCTAssertEqual(AppInstall.supportDirectoryName(bundleId: "\(production).staging"),
                       "TimeTrack-staging")
    }

    /// `swift run` has no bundle, so `Bundle.main.bundleIdentifier` is nil. Running from a
    /// checkout is the likeliest way to collide with a real install, so a missing id must NOT
    /// fall through to production's state.
    func testRunningWithoutABundleIsTreatedAsDevNotProduction() {
        XCTAssertFalse(AppInstall.isProduction(bundleId: nil))
        XCTAssertFalse(AppInstall.isProduction(bundleId: ""))
        XCTAssertEqual(AppInstall.supportDirectoryName(bundleId: nil), "TimeTrack-dev")
        XCTAssertEqual(AppInstall.keychainService(bundleId: nil), "com.timetrack.client.dev")
    }

    /// An unrelated bundle id is still isolated — it just carries its whole id as the tag.
    func testAnUnrelatedBundleIdIsStillIsolated() {
        let name = AppInstall.supportDirectoryName(bundleId: "com.example.someoneelse")
        XCTAssertEqual(name, "TimeTrack-com.example.someoneelse")
        XCTAssertNotEqual(name, "TimeTrack")
    }

    /// A path separator in the tag would escape the container and write somewhere else entirely.
    func testAVariantCannotEscapeTheContainerDirectory() {
        let name = AppInstall.supportDirectoryName(bundleId: "\(AppInstall.productionBundleId)./../evil")
        XCTAssertFalse(name.contains("/"))
        XCTAssertFalse(name.contains(":"))
    }

    /// The container is what every store resolves against, so this is the seam that actually
    /// keeps two installs apart on disk.
    func testSupportDirectoryLandsUnderApplicationSupport() {
        let dir = AppInstall.supportDirectory("screenshots")
        XCTAssertEqual(dir.lastPathComponent, "screenshots")
        XCTAssertEqual(dir.deletingLastPathComponent().lastPathComponent,
                       AppInstall.supportDirectoryName)
        XCTAssertTrue(dir.path.contains("Application Support"))
    }
}
