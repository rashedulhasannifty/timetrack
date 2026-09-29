import XCTest
@testable import TimeTrack

final class TimeEntryPayloadTests: XCTestCase {
    private func encoded(_ payload: TimeEntryPayload) throws -> [String: Any] {
        let data = try JSONEncoder().encode(payload)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testOpenEntryEmitsExplicitNullEndTime() throws {
        let json = try encoded(TimeEntryPayload(
            id: "01920000-0000-7000-8000-000000000001",
            projectId: nil, subprojectId: nil, taskId: nil,
            startTime: "2026-08-20T04:00:00Z",
            endTime: nil,
            source: "MANUAL",
            note: nil
        ))
        // The server schema is .nullable(), NOT .optional() — an omitted key is a 422.
        XCTAssertTrue(json.keys.contains("endTime"))
        XCTAssertTrue(json["endTime"] is NSNull)
    }

    func testClosedEntryEmitsTheEndTime() throws {
        let json = try encoded(TimeEntryPayload(
            id: "01920000-0000-7000-8000-000000000002",
            projectId: nil, subprojectId: nil, taskId: nil,
            startTime: "2026-08-20T04:00:00Z",
            endTime: "2026-08-20T05:00:00Z",
            source: "MANUAL",
            note: nil
        ))
        XCTAssertEqual(json["endTime"] as? String, "2026-08-20T05:00:00Z")
    }

    func testNilProjectAndTaskStillEmitExplicitNulls() throws {
        let json = try encoded(TimeEntryPayload(
            id: "01920000-0000-7000-8000-000000000003",
            projectId: nil, subprojectId: nil, taskId: nil,
            startTime: "2026-08-20T04:00:00Z",
            endTime: nil,
            source: "MANUAL",
            note: nil
        ))
        XCTAssertTrue(json["projectId"] is NSNull)
        XCTAssertTrue(json["taskId"] is NSNull)
    }

    func testNilNoteIsOmittedNotNulled() throws {
        let json = try encoded(TimeEntryPayload(
            id: "01920000-0000-7000-8000-000000000004",
            projectId: nil, subprojectId: nil, taskId: nil,
            startTime: "2026-08-20T04:00:00Z",
            endTime: nil,
            source: "MANUAL",
            note: nil
        ))
        // note is .optional() on the server — omitted, not null.
        XCTAssertFalse(json.keys.contains("note"))
    }

    func testEncodesTheSubprojectAndANilOneAsNull() throws {
        let withSub = try encoded(TimeEntryPayload(
            id: "e1", projectId: "p1", subprojectId: "s2", taskId: nil,
            startTime: "2026-09-29T09:00:00Z", endTime: "2026-09-29T10:00:00Z",
            source: "MANUAL", note: nil))
        XCTAssertEqual(withSub["subprojectId"] as? String, "s2")

        let without = try encoded(TimeEntryPayload(
            id: "e1", projectId: nil, subprojectId: nil, taskId: nil,
            startTime: "2026-09-29T09:00:00Z", endTime: nil, source: "MANUAL", note: nil))
        XCTAssertTrue(without["subprojectId"] is NSNull)
    }
}
