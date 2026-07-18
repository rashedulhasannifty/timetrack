import XCTest
@testable import TimeTrack

final class DailyTotalAccumulatorTests: XCTestCase {
    // Fixed UTC calendar so "local day" boundaries are deterministic in CI.
    private func utcCalendar() -> Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }
    private func date(_ s: String) -> Date {
        let f = ISO8601DateFormatter(); f.timeZone = TimeZone(identifier: "UTC")!
        return f.date(from: s)!
    }

    func testSumsSpansWithinSameDay() {
        let acc = DailyTotalAccumulator(calendar: utcCalendar())
        acc.add(start: date("2026-07-18T09:00:00Z"), end: date("2026-07-18T10:00:00Z")) // 3600
        acc.add(start: date("2026-07-18T11:00:00Z"), end: date("2026-07-18T11:30:00Z")) // 1800
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-18T18:00:00Z")), 5400)
    }

    func testRollsOverToEndDayOfNewSpan() {
        let acc = DailyTotalAccumulator(calendar: utcCalendar())
        acc.add(start: date("2026-07-18T09:00:00Z"), end: date("2026-07-18T10:00:00Z")) // day 18
        // A span ending on day 19 rolls the accumulator to day 19 (prior day's total dropped).
        acc.add(start: date("2026-07-19T08:00:00Z"), end: date("2026-07-19T08:15:00Z")) // 900, day 19
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-19T18:00:00Z")), 900)
    }

    func testMidnightCrossingSpanAttributesToEndDay() {
        let acc = DailyTotalAccumulator(calendar: utcCalendar())
        // 23:30 → 00:30 crosses midnight; whole 3600s attributed to the end day (19).
        acc.add(start: date("2026-07-18T23:30:00Z"), end: date("2026-07-19T00:30:00Z"))
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-19T02:00:00Z")), 3600)
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-18T23:59:00Z")), 0) // not day 18
    }

    func testTodaySecondsZeroWhenStoredDayIsStale() {
        let acc = DailyTotalAccumulator(calendar: utcCalendar())
        acc.add(start: date("2026-07-18T09:00:00Z"), end: date("2026-07-18T10:00:00Z"))
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-20T09:00:00Z")), 0) // asked on a later day
    }

    func testResetClears() {
        let acc = DailyTotalAccumulator(calendar: utcCalendar())
        acc.add(start: date("2026-07-18T09:00:00Z"), end: date("2026-07-18T10:00:00Z"))
        acc.reset()
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-18T18:00:00Z")), 0)
    }
}
