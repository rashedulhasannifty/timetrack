import XCTest
@testable import TimeTrack

final class DailyDistractionAccumulatorTests: XCTestCase {
    private func utcCalendar() -> Calendar {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }
    private func date(_ s: String) -> Date {
        let f = ISO8601DateFormatter(); f.timeZone = TimeZone(identifier: "UTC")!
        return f.date(from: s)!
    }

    func testAccumulatesWithinSameDay() {
        let acc = DailyDistractionAccumulator(calendar: utcCalendar(), sampleSeconds: 60)
        acc.addUnproductive(now: date("2026-07-20T09:00:00Z"))
        acc.addUnproductive(now: date("2026-07-20T09:01:00Z"))
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-20T18:00:00Z")), 120)
    }

    func testRollsOverOnNewDay() {
        let acc = DailyDistractionAccumulator(calendar: utcCalendar(), sampleSeconds: 60)
        acc.addUnproductive(now: date("2026-07-20T23:59:00Z"))
        acc.addUnproductive(now: date("2026-07-21T00:05:00Z")) // new local day → rolls over
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-21T09:00:00Z")), 60)
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-20T09:00:00Z")), 0) // prior day dropped
    }

    func testStaleDayReturnsZero() {
        let acc = DailyDistractionAccumulator(calendar: utcCalendar(), sampleSeconds: 60)
        acc.addUnproductive(now: date("2026-07-20T09:00:00Z"))
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-21T09:00:00Z")), 0)
    }

    func testResetZeroesTally() {
        let acc = DailyDistractionAccumulator(calendar: utcCalendar(), sampleSeconds: 60)
        acc.addUnproductive(now: date("2026-07-20T09:00:00Z"))
        acc.reset()
        XCTAssertEqual(acc.todaySeconds(now: date("2026-07-20T09:00:00Z")), 0)
    }
}
