import XCTest
@testable import TimeTrack

final class AckMarkerTests: XCTestCase {
    private func freshDefaults() -> UserDefaults {
        let suite = "ack-marker-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: suite)!
        d.removePersistentDomain(forName: suite)
        return d
    }

    func testUnrecordedUserHasNotAcknowledged() {
        let marker = AckMarker(defaults: freshDefaults())
        XCTAssertFalse(marker.hasAcknowledged(userId: "u1"))
    }

    func testRecordThenHasAcknowledged() {
        let marker = AckMarker(defaults: freshDefaults())
        marker.record(userId: "u1", policyVersion: "v1")
        XCTAssertTrue(marker.hasAcknowledged(userId: "u1"))
        XCTAssertFalse(marker.hasAcknowledged(userId: "u2"))
    }

    func testClearRemovesTheMarker() {
        let marker = AckMarker(defaults: freshDefaults())
        marker.record(userId: "u1", policyVersion: "v1")
        marker.clear(userId: "u1")
        XCTAssertFalse(marker.hasAcknowledged(userId: "u1"))
    }
}
