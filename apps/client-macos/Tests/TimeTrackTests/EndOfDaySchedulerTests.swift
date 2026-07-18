import XCTest
@testable import TimeTrack

final class EndOfDaySchedulerTests: XCTestCase {
    private func utcCalendar() -> Calendar {
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }
    private func date(_ s: String) -> Date {
        let f = ISO8601DateFormatter(); f.timeZone = TimeZone(identifier: "UTC")!
        return f.date(from: s)!
    }

    func testNextFireLaterToday() {
        let next = EndOfDayScheduler.nextFire(after: date("2026-07-18T09:00:00Z"),
                                              hour: 18, calendar: utcCalendar())
        XCTAssertEqual(next, date("2026-07-18T18:00:00Z"))
    }

    func testNextFireRollsToTomorrowWhenPastHour() {
        let next = EndOfDayScheduler.nextFire(after: date("2026-07-18T18:30:00Z"),
                                              hour: 18, calendar: utcCalendar())
        XCTAssertEqual(next, date("2026-07-19T18:00:00Z"))
    }

    func testNextFireExactlyAtHourRollsToTomorrow() {
        // Strictly after → firing exactly at 18:00 schedules the next day's 18:00.
        let next = EndOfDayScheduler.nextFire(after: date("2026-07-18T18:00:00Z"),
                                              hour: 18, calendar: utcCalendar())
        XCTAssertEqual(next, date("2026-07-19T18:00:00Z"))
    }

    func testFormatDuration() {
        XCTAssertEqual(EndOfDayScheduler.formatDuration(seconds: 6 * 3600 + 20 * 60), "6h 20m")
        XCTAssertEqual(EndOfDayScheduler.formatDuration(seconds: 45 * 60), "45m")
        XCTAssertEqual(EndOfDayScheduler.formatDuration(seconds: 0), "0m")
    }

    func testFireReadsTotalAndPosts() {
        let spy = SpyNotifier()
        let scheduler = EndOfDayScheduler(
            hour: 18, calendar: utcCalendar(), notifier: spy,
            total: { _ in 6 * 3600 + 20 * 60 },
            clock: { self.date("2026-07-18T18:00:00Z") }
        )
        scheduler.fire()
        XCTAssertEqual(spy.posted.count, 1)
        XCTAssertEqual(spy.posted.first?.id, "end-of-day")
        XCTAssertEqual(spy.posted.first?.body, "Today: ~6h 20m tracked. Nice work.")
    }
}
