import Foundation

/// Slice 2.4 — a minimal local tally of today's tracked seconds for the end-of-day summary
/// "shell". `TimeTracker` retains no daily history, so this observes each closed span (via
/// `TimeTracker.onSpanClosed`) and sums durations for the current LOCAL day. A span is attributed
/// to its END day; a span whose end lands on a new day rolls the tally over (prior day dropped —
/// the summary is a nicety, not a record of truth). Not a capture path; touches no network, no
/// disk, no logging. Main-thread only (fed by `TimeTracker`).
final class DailyTotalAccumulator {
    private let calendar: Calendar
    private var day: DateComponents?   // y/m/d of the current tally
    private var seconds: Int = 0

    init(calendar: Calendar = .current) {
        self.calendar = calendar
    }

    func add(start: Date, end: Date) {
        let duration = max(0, Int(end.timeIntervalSince(start)))
        let endDay = calendar.dateComponents([.year, .month, .day], from: end)
        if day == endDay {
            seconds += duration
        } else {
            day = endDay
            seconds = duration   // roll over to the span's end-day
        }
    }

    /// Today's tally iff the stored day matches `now`'s local day; else 0 (a stale day is not today).
    func todaySeconds(now: Date) -> Int {
        let today = calendar.dateComponents([.year, .month, .day], from: now)
        return day == today ? seconds : 0
    }

    func reset() {
        day = nil
        seconds = 0
    }
}
