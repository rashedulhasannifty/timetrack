import Combine
import XCTest
@testable import TimeTrack

/// The background poll runs every six hours, so a release published just after an app launched
/// stays invisible for most of a day. Opening the dropdown is the one moment a person could act
/// on an update, so it checks then too — throttled, because the API budget is shared by every
/// machine behind the office's single IP.
final class UpdateCoordinatorTests: XCTestCase {
    private final class SpyFeed: UpdateFeed, @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0
        let manifest: ReleaseManifest
        /// Fulfilled once per `latest()` call, so a test can wait for async checks deterministically.
        let onCall: XCTestExpectation

        init(manifest: ReleaseManifest, onCall: XCTestExpectation) {
            self.manifest = manifest
            self.onCall = onCall
        }

        var calls: Int {
            lock.lock(); defer { lock.unlock() }
            return count
        }

        func latest() async throws -> ReleaseManifest {
            lock.lock(); count += 1; lock.unlock()
            onCall.fulfill()
            return manifest
        }
    }

    private func manifest(_ version: String) -> ReleaseManifest {
        ReleaseManifest(version: AppVersion(version)!,
                        publishedAt: Date(timeIntervalSince1970: 1_800_000_000),
                        zipURL: URL(string: "https://example.invalid/NiftyTimer-pilot.zip")!,
                        sha256: String(repeating: "a", count: 64))
    }

    private func makeCoordinator(feed: UpdateFeed, clock: @escaping () -> Date) -> UpdateCoordinator {
        UpdateCoordinator(
            feed: feed,
            currentVersion: AppVersion("0.4.0"),
            menuOpenThrottle: RefreshThrottle(minInterval: UpdateCoordinator.menuOpenMinInterval,
                                              clock: clock),
            now: clock,
            openReleases: { _ in },
            onQuit: {})
    }

    @MainActor func testFirstMenuOpenChecksImmediately() {
        let queried = expectation(description: "feed queried")
        let feed = SpyFeed(manifest: manifest("0.4.1"), onCall: queried)
        let coordinator = makeCoordinator(feed: feed, clock: { Date(timeIntervalSince1970: 1_800_000_000) })

        coordinator.checkOnMenuOpen()

        wait(for: [queried], timeout: 2)
        XCTAssertEqual(feed.calls, 1, "an app launched before a release must not wait six hours")
    }

    @MainActor func testRepeatedOpensAreThrottledThenAllowedAgain() {
        let queried = expectation(description: "feed queried")
        queried.expectedFulfillmentCount = 2
        queried.assertForOverFulfill = true   // a third call means the throttle did nothing
        let feed = SpyFeed(manifest: manifest("0.4.1"), onCall: queried)

        var now = Date(timeIntervalSince1970: 1_800_000_000)
        let coordinator = makeCoordinator(feed: feed, clock: { now })

        coordinator.checkOnMenuOpen()                                    // allowed: first call
        coordinator.checkOnMenuOpen()                                    // throttled
        now.addTimeInterval(UpdateCoordinator.menuOpenMinInterval + 60)
        coordinator.checkOnMenuOpen()                                    // allowed again

        wait(for: [queried], timeout: 2)
        XCTAssertEqual(feed.calls, 2, "opening and closing the menu must not hammer the API")
    }

    @MainActor func testMenuOpenCheckPublishesTheNewerBuild() {
        let queried = expectation(description: "feed queried")
        let feed = SpyFeed(manifest: manifest("0.4.1"), onCall: queried)
        let coordinator = makeCoordinator(feed: feed, clock: { Date(timeIntervalSince1970: 1_800_000_000) })

        let published = expectation(description: "status published")
        var bag = Set<AnyCancellable>()
        coordinator.$status
            .filter { $0.manifest != nil }
            .sink { _ in published.fulfill() }
            .store(in: &bag)

        coordinator.checkOnMenuOpen()

        wait(for: [queried, published], timeout: 2)
        XCTAssertEqual(coordinator.status.manifest?.version, AppVersion("0.4.1"))
    }

    /// The office shares one IP against GitHub's 60/hour unauthenticated limit.
    func testThrottleLeavesHeadroomUnderTheRateLimit() {
        let perMachinePerHour = 3600 / UpdateCoordinator.menuOpenMinInterval
        XCTAssertLessThanOrEqual(perMachinePerHour * 20, 60,
                                 "a 20-machine office opening menus all day must stay under 60/hour")
    }
}
