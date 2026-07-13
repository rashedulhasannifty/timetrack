import XCTest
@testable import TimeTrack

final class IdleEventPayloadTests: XCTestCase {
    func testEncodesMatchingIdleEventSchema() throws {
        let event = IdleEventPayload(
            id: "018f-uuid",
            startTime: "2023-11-14T22:13:20Z",
            endTime: "2023-11-14T22:18:20Z",
            resolvedAction: .discarded
        )
        let data = try JSONEncoder().encode(event)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(obj["id"] as? String, "018f-uuid")
        XCTAssertEqual(obj["startTime"] as? String, "2023-11-14T22:13:20Z")
        XCTAssertEqual(obj["endTime"] as? String, "2023-11-14T22:18:20Z")
        XCTAssertEqual(obj["resolvedAction"] as? String, "DISCARDED")
        XCTAssertEqual(obj.count, 4, "no extra keys — the API rejects unknown fields")
    }

    func testResolvedActionRawValues() {
        XCTAssertEqual(ResolvedAction.kept.rawValue, "KEPT")
        XCTAssertEqual(ResolvedAction.discarded.rawValue, "DISCARDED")
        XCTAssertEqual(ResolvedAction.unresolved.rawValue, "UNRESOLVED")
    }
}
