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

    // The server refuses an inverted entry (endTime < startTime) with a 422, which the uploader
    // treats as permanent — so an entry closed against a clock that stepped BACKWARDS would be
    // dropped and the person would lose that time without a word.
    func testAClockStepBackwardsCollapsesToZeroRatherThanInverting() {
        let spy = BufferSpy()
        var now = Date(timeIntervalSince1970: 1_700_000_000)
        let tracker = TimeTracker(buffer: spy, clock: { now }, idGen: { _ in "id-1" })
        tracker.start(projectId: nil, taskId: nil)
        now = now.addingTimeInterval(-600) // NTP correction lands mid-span
        tracker.stop()

        XCTAssertEqual(spy.entries.count, 1)
        let entry = spy.object(at: 0)
        XCTAssertEqual(entry["startTime"] as? String, entry["endTime"] as? String)
    }

    func testRecordSpanNeverEmitsAnInvertedSpan() {
        let spy = BufferSpy()
        let t0 = Date(timeIntervalSince1970: 1_700_000_000)
        let tracker = TimeTracker(buffer: spy, clock: { t0 }, idGen: { _ in "id-1" })
        // LiveSpanRecovery's Keep closes at `lastAlive`, which a clock step can put before the start.
        tracker.recordSpan(start: t0, end: t0.addingTimeInterval(-60),
                           projectId: nil, taskId: nil, source: .manual)

        let entry = spy.object(at: 0)
        XCTAssertEqual(entry["startTime"] as? String, entry["endTime"] as? String)
    }

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

    func testOpenPersistsLiveSpan() {
        let clock = MutableClock(t0)
        let recorder = FakeLiveSpanRecorder()
        let tracker = TimeTracker(buffer: BufferSpy(), clock: clock.read,
                                  idGen: sequentialIdGen(), liveSpan: recorder)

        tracker.start(projectId: "p1", taskId: "k1", source: .auto)

        XCTAssertEqual(recorder.begins.count, 1)
        XCTAssertEqual(recorder.begins[0], .init(entryId: "id-1", startTime: t0,
                                                 selection: .init(projectId: "p1", taskId: "k1"),
                                                 source: .auto))
        XCTAssertEqual(recorder.clears, 0)
    }

    func testStopClearsLiveSpan() {
        let recorder = FakeLiveSpanRecorder()
        let tracker = TimeTracker(buffer: BufferSpy(), clock: { self.t0 },
                                  idGen: sequentialIdGen(), liveSpan: recorder)
        tracker.start(projectId: nil, taskId: nil)
        tracker.stop()
        XCTAssertEqual(recorder.clears, 1, "a clean stop clears the live span")
    }

    func testPauseClearsAndResumeReopensLiveSpan() {
        let recorder = FakeLiveSpanRecorder()
        let tracker = TimeTracker(buffer: BufferSpy(), clock: { self.t0 },
                                  idGen: sequentialIdGen(), liveSpan: recorder)
        tracker.start(projectId: nil, taskId: nil)     // begin #1
        tracker.pause()                                 // clear
        tracker.resume()                                // begin #2
        XCTAssertEqual(recorder.begins.count, 2)
        XCTAssertEqual(recorder.clears, 1)
    }

    func testRecordSpanWithExplicitIdKeepsThatId() {
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: { self.t0 }, idGen: sequentialIdGen())
        tracker.recordSpan(id: "recovered-id", start: t0, end: t0.addingTimeInterval(300),
                           projectId: "p1", taskId: nil, source: .manual)
        XCTAssertEqual(spy.object(at: 0)["id"] as? String, "recovered-id")
    }

    func testOnSpanClosedFiresOnStopWithStartAndEnd() {
        var now = Date(timeIntervalSince1970: 1000)
        let tracker = TimeTracker(buffer: BufferSpy(), clock: { now })
        var closed: [(Date, Date)] = []
        tracker.onSpanClosed = { s, e in closed.append((s, e)) }

        tracker.start(projectId: nil, taskId: nil)   // opens at t=1000
        now = Date(timeIntervalSince1970: 1600)
        tracker.stop()                               // closes at t=1600

        XCTAssertEqual(closed.count, 1)
        XCTAssertEqual(closed.first?.0, Date(timeIntervalSince1970: 1000))
        XCTAssertEqual(closed.first?.1, Date(timeIntervalSince1970: 1600))
    }

    func testOnSpanClosedFiresOnRecordSpan() {
        let tracker = TimeTracker(buffer: BufferSpy(), clock: { Date(timeIntervalSince1970: 1000) })
        var closed: [(Date, Date)] = []
        tracker.onSpanClosed = { s, e in closed.append((s, e)) }

        tracker.recordSpan(start: Date(timeIntervalSince1970: 2000),
                           end: Date(timeIntervalSince1970: 2500),
                           projectId: nil, taskId: nil, source: .auto)

        XCTAssertEqual(closed.count, 1)
        XCTAssertEqual(closed.first?.0, Date(timeIntervalSince1970: 2000))
        XCTAssertEqual(closed.first?.1, Date(timeIntervalSince1970: 2500))
    }

    // Regression test for the live-publish bug (spec §4.1): the dashboard showed screenshots but
    // no time entry until Stop, because nothing observed a span OPENING. `onSpanOpened` is the
    // seam AppDelegate wires to LiveEntryPublisher; deleting the call site in `open(_:source:)`
    // must fail this test.
    func testOnSpanOpenedFiresOnStart() {
        let clock = MutableClock(t0)
        let tracker = TimeTracker(buffer: BufferSpy(), clock: clock.read, idGen: sequentialIdGen())
        var opened: [(String, Date, TimeTracker.Selection, TimeTracker.Source)] = []
        tracker.onSpanOpened = { id, start, selection, source in
            opened.append((id, start, selection, source))
        }

        tracker.start(projectId: "p1", taskId: "k1", source: .auto)

        XCTAssertEqual(opened.count, 1)
        XCTAssertEqual(opened.first?.0, "id-1")
        XCTAssertEqual(opened.first?.1, t0)
        XCTAssertEqual(opened.first?.2, .init(projectId: "p1", taskId: "k1"))
        XCTAssertEqual(opened.first?.3, .auto)
    }

    // resume() is a SEPARATE path into open() (pause → resume mints a new entry with the same
    // selection). If a future refactor bypassed open() on this path only, the reported bug would
    // come back for pause/resume users specifically — the hardest case to notice by inspection.
    func testOnSpanOpenedFiresOnResume() {
        let clock = MutableClock(t0)
        let tracker = TimeTracker(buffer: BufferSpy(), clock: clock.read, idGen: sequentialIdGen())
        var opened: [(String, Date, TimeTracker.Selection, TimeTracker.Source)] = []
        tracker.onSpanOpened = { id, start, selection, source in
            opened.append((id, start, selection, source))
        }

        tracker.start(projectId: "p1", taskId: "k1")   // opened #1: id-1 @ t0
        clock.advance(30); tracker.pause()
        clock.advance(30); tracker.resume()             // opened #2: id-2 @ t0+60

        guard opened.count == 2 else {
            XCTFail("expected onSpanOpened to fire twice (start + resume), got \(opened.count)")
            return
        }
        XCTAssertEqual(opened[1].0, "id-2")
        XCTAssertEqual(opened[1].1, t0.addingTimeInterval(60))
        XCTAssertEqual(opened[1].2, .init(projectId: "p1", taskId: "k1"))
        XCTAssertEqual(opened[1].3, .manual)   // pause/resume is a manual-only affordance
    }
}
