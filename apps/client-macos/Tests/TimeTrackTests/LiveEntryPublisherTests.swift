import XCTest
@testable import TimeTrack

private final class SpyUploader: Uploading {
    var bodies: [Data] = []
    var result: UploadResult = .success
    func upload(_ payload: Data) async -> UploadResult {
        bodies.append(payload)
        return result
    }
}

final class LiveEntryPublisherTests: XCTestCase {
    private func json(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testPublishesAnOpenEntryWithNullEndTime() async throws {
        let spy = SpyUploader()
        let publisher = LiveEntryPublisher(uploader: spy)

        await publisher.publish(
            entryId: "01920000-0000-7000-8000-000000000010",
            start: Date(timeIntervalSince1970: 1_787_000_000),
            selection: TimeTracker.Selection(projectId: nil, taskId: nil),
            source: .manual
        )

        XCTAssertEqual(spy.bodies.count, 1)
        let body = try json(XCTUnwrap(spy.bodies.first))
        XCTAssertTrue(body["endTime"] is NSNull)
        XCTAssertEqual(body["source"] as? String, "MANUAL")
        XCTAssertEqual(body["id"] as? String, "01920000-0000-7000-8000-000000000010")
    }

    func testPublishesFromAPersistedLiveSpan() async throws {
        let spy = SpyUploader()
        let publisher = LiveEntryPublisher(uploader: spy)
        let span = LiveSpan(
            entryId: "01920000-0000-7000-8000-000000000011",
            startTime: Date(timeIntervalSince1970: 1_787_000_000),
            projectId: "01920000-0000-7000-8000-0000000000aa",
            taskId: nil,
            source: "AUTO",
            lastAlive: Date(timeIntervalSince1970: 1_787_000_600),
            userId: "01920000-0000-7000-8000-0000000000bb"
        )

        await publisher.publish(span)

        let body = try json(XCTUnwrap(spy.bodies.first))
        XCTAssertEqual(body["id"] as? String, span.entryId)
        XCTAssertEqual(body["projectId"] as? String, span.projectId)
        XCTAssertTrue(body["taskId"] is NSNull)
        XCTAssertTrue(body["endTime"] is NSNull)
        XCTAssertEqual(body["source"] as? String, "AUTO")
    }

    // A live publish is best-effort. It must NEVER be treated as fatal: the authoritative
    // record is the closed entry that goes through BufferStore on Stop.
    func testATransientFailureIsSwallowed() async {
        let spy = SpyUploader()
        spy.result = .transient
        let publisher = LiveEntryPublisher(uploader: spy)

        await publisher.publish(
            entryId: "01920000-0000-7000-8000-000000000012",
            start: Date(),
            selection: TimeTracker.Selection(projectId: nil, taskId: nil),
            source: .manual
        )

        XCTAssertEqual(spy.bodies.count, 1) // did not throw, did not retry-storm
    }

    func testAConflictIsSwallowed() async {
        let spy = SpyUploader()
        spy.result = .permanent(409) // a stranded open row already exists server-side
        let publisher = LiveEntryPublisher(uploader: spy)

        await publisher.publish(
            entryId: "01920000-0000-7000-8000-000000000013",
            start: Date(),
            selection: TimeTracker.Selection(projectId: nil, taskId: nil),
            source: .manual
        )

        XCTAssertEqual(spy.bodies.count, 1)
    }
}

extension LiveEntryPublisherTests {
    func testDiscardClosesTheRowAtItsOwnStart() async throws {
        let spy = SpyUploader()
        let publisher = LiveEntryPublisher(uploader: spy)
        let start = Date(timeIntervalSince1970: 1_787_000_000)
        let span = LiveSpan(
            entryId: "01920000-0000-7000-8000-000000000020",
            startTime: start,
            projectId: nil, taskId: nil,
            source: "MANUAL",
            lastAlive: start.addingTimeInterval(1800),
            userId: nil
        )

        await publisher.publishDiscarded(span)

        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: XCTUnwrap(spy.bodies.first)) as? [String: Any]
        )
        // Zero duration: releases the one-open-entry index slot, contributes nothing,
        // and is filtered out of every server-side list and export.
        XCTAssertEqual(body["startTime"] as? String, body["endTime"] as? String)
        XCTAssertEqual(body["id"] as? String, span.entryId)
        // NOT closed at lastAlive — that would silently KEEP the time the user discarded.
        XCTAssertNotEqual(body["endTime"] as? String,
                          TimeEntryPayload.iso.string(from: span.lastAlive))
    }
}
