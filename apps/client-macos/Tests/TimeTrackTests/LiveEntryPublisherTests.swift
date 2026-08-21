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

    /// A single failure stays quiet — one dropped heartbeat on a flaky network is not worth a
    /// warning, and nothing is lost either way (the closed entry still uploads via the buffer).
    func testASingleFailureIsNotSurfaced() async {
        let spy = SpyUploader()
        spy.result = .transient
        let publisher = LiveEntryPublisher(uploader: spy, failureThreshold: 3)
        var blocked: [Bool] = []
        publisher.onBlockedChanged = { blocked.append($0) }

        await publisher.publish(span())

        XCTAssertEqual(blocked, [])
    }

    /// Sustained failure IS surfaced. This is the silence that let a stranded open row on the
    /// server hide for hours: the clock ran, activity samples kept flowing so the dashboard
    /// showed the person as tracking, and their tracked time never moved.
    func testSustainedFailureRaisesTheWarningExactlyOnce() async {
        let spy = SpyUploader()
        spy.result = .permanent(409)
        let publisher = LiveEntryPublisher(uploader: spy, failureThreshold: 3)
        var blocked: [Bool] = []
        publisher.onBlockedChanged = { blocked.append($0) }

        for _ in 0..<5 { await publisher.publish(span()) }

        // Raised on the third failure and NOT re-raised on every heartbeat after it.
        XCTAssertEqual(blocked, [true])
    }

    func testASuccessClearsTheWarning() async {
        let spy = SpyUploader()
        spy.result = .transient
        let publisher = LiveEntryPublisher(uploader: spy, failureThreshold: 2)
        var blocked: [Bool] = []
        publisher.onBlockedChanged = { blocked.append($0) }

        await publisher.publish(span())
        await publisher.publish(span())
        spy.result = .success
        await publisher.publish(span())

        XCTAssertEqual(blocked, [true, false])
    }

    /// The count is CONSECUTIVE: an intermittent failure must not accumulate its way to a
    /// warning across an otherwise healthy session.
    func testFailuresMustBeConsecutive() async {
        let spy = SpyUploader()
        let publisher = LiveEntryPublisher(uploader: spy, failureThreshold: 3)
        var blocked: [Bool] = []
        publisher.onBlockedChanged = { blocked.append($0) }

        for _ in 0..<4 {
            spy.result = .transient
            await publisher.publish(span())
            spy.result = .success
            await publisher.publish(span())
        }

        XCTAssertEqual(blocked, [])
    }

    private func span() -> LiveSpan {
        LiveSpan(entryId: "01920000-0000-7000-8000-000000000011",
                 startTime: Date(timeIntervalSince1970: 1_787_000_000),
                 projectId: nil,
                 taskId: nil,
                 source: "MANUAL",
                 lastAlive: Date(timeIntervalSince1970: 1_787_000_060),
                 userId: "u1")
    }
}
