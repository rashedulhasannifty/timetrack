import XCTest
@testable import TimeTrack

final class TimeTrackerTests: XCTestCase {
    /// A clock the test advances by hand.
    private final class MutableClock {
        private(set) var now: Date
        init(_ start: Date) { now = start }
        func advance(_ seconds: TimeInterval) { now = now.addingTimeInterval(seconds) }
        func read() -> Date { now }
    }

    /// Sequential id generator: "id-1", "id-2", …
    private func sequentialIdGen() -> (Date) -> String {
        var n = 0
        return { _ in n += 1; return "id-\(n)" }
    }

    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    func testStartMintsIdAndRecordsStartTime() {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())

        tracker.start(projectId: "p1", taskId: "k1")

        XCTAssertTrue(tracker.isRunning)
        XCTAssertEqual(tracker.state, .tracking(entryId: "id-1", startedAt: t0,
                                                selection: .init(projectId: "p1", taskId: "k1"),
                                                source: .manual))
        XCTAssertTrue(spy.entries.isEmpty, "nothing is enqueued until the entry closes")
    }

    func testStopEnqueuesOneCompletedEntry() {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())

        tracker.start(projectId: "p1", taskId: "k1")
        clock.advance(60)
        tracker.stop()

        XCTAssertEqual(tracker.state, .idle)
        XCTAssertEqual(spy.entries.count, 1)
        let obj = spy.object(at: 0)
        XCTAssertEqual(obj["id"] as? String, "id-1")
        XCTAssertEqual(obj["projectId"] as? String, "p1")
        XCTAssertEqual(obj["taskId"] as? String, "k1")
        XCTAssertEqual(obj["source"] as? String, "MANUAL")
        XCTAssertEqual(obj["startTime"] as? String, "2023-11-14T22:13:20Z")
        XCTAssertEqual(obj["endTime"] as? String, "2023-11-14T22:14:20Z")
        XCTAssertNil(obj["note"], "note is omitted in 1.7b")
    }

    func testNullProjectEncodesAsExplicitNull() {
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: { self.t0 }, idGen: sequentialIdGen())

        tracker.start(projectId: nil, taskId: nil)
        tracker.stop()

        let obj = spy.object(at: 0)
        XCTAssertTrue(obj["projectId"] is NSNull, "projectId must be present as null")
        XCTAssertTrue(obj["taskId"] is NSNull)
    }

    func testPauseEnqueuesAndRetainsSelection() {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())

        tracker.start(projectId: "p1", taskId: "k1")
        clock.advance(30)
        tracker.pause()

        XCTAssertTrue(tracker.isPaused)
        XCTAssertEqual(tracker.state, .paused(selection: .init(projectId: "p1", taskId: "k1")))
        XCTAssertEqual(spy.entries.count, 1)
    }

    func testResumeOpensNewEntryWithSameSelection() {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())

        tracker.start(projectId: "p1", taskId: "k1")
        clock.advance(30); tracker.pause()
        clock.advance(30); tracker.resume()
        clock.advance(30); tracker.stop()

        XCTAssertEqual(spy.entries.count, 2)
        XCTAssertEqual(spy.entries[0].id, "id-1")
        XCTAssertEqual(spy.entries[1].id, "id-2")
        XCTAssertEqual(spy.object(at: 1)["projectId"] as? String, "p1")
    }

    func testStartIgnoredWhileAlreadyTracking() {
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: { self.t0 }, idGen: sequentialIdGen())

        tracker.start(projectId: "p1", taskId: nil)
        tracker.start(projectId: "p2", taskId: nil) // ignored

        XCTAssertEqual(tracker.state, .tracking(entryId: "id-1", startedAt: t0,
                                                selection: .init(projectId: "p1", taskId: nil),
                                                source: .manual))
    }

    func testStartWithAutoSourceEncodesAUTO() {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())

        tracker.start(projectId: "p1", taskId: nil, source: .auto)
        clock.advance(60)
        tracker.stop()

        XCTAssertEqual(spy.object(at: 0)["source"] as? String, "AUTO")
    }

    func testStopAtBackdatesEndTime() {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())

        tracker.start(projectId: "p1", taskId: nil, source: .auto)
        clock.advance(600)                      // "now" is t0+600, but we were idle since t0+120
        tracker.stop(at: t0.addingTimeInterval(120))

        XCTAssertEqual(tracker.state, .idle)
        XCTAssertEqual(spy.object(at: 0)["endTime"] as? String, "2023-11-14T22:15:20Z") // t0+120
    }

    func testRecordSpanEnqueuesOneCompleteEntryWithoutChangingState() {
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: { self.t0 }, idGen: sequentialIdGen())

        tracker.recordSpan(start: t0, end: t0.addingTimeInterval(300),
                           projectId: "p1", taskId: "k1", source: .auto)

        XCTAssertEqual(tracker.state, .idle, "recordSpan must not open/close the live state")
        XCTAssertEqual(spy.entries.count, 1)
        let obj = spy.object(at: 0)
        XCTAssertEqual(obj["id"] as? String, "id-1")
        XCTAssertEqual(obj["source"] as? String, "AUTO")
        XCTAssertEqual(obj["startTime"] as? String, "2023-11-14T22:13:20Z")   // t0
        XCTAssertEqual(obj["endTime"] as? String, "2023-11-14T22:18:20Z")     // t0+300
    }
}
