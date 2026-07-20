import Foundation

/// Slice 3.4 — a local tally of today's UNPRODUCTIVE time, for the end-of-day summary line. Mirrors
/// `DailyTotalAccumulator`: each unproductive sample adds one sampler window (`sampleSeconds`, 60s)
/// to the current LOCAL day; a sample on a new local day rolls the tally over (prior day dropped —
/// the summary is a nicety, not a record of truth). Not a capture path; no network, disk, or
/// logging. Main-thread only (fed from `AppDelegate`'s `onCategorized` hop).
final class DailyDistractionAccumulator {
    private let calendar: Calendar
    private let sampleSeconds: Int
    private var day: DateComponents?
    private var seconds: Int = 0

    init(calendar: Calendar = .current, sampleSeconds: Int = 60) {
        self.calendar = calendar
        self.sampleSeconds = sampleSeconds
    }

    func addUnproductive(now: Date) {
        let d = calendar.dateComponents([.year, .month, .day], from: now)
        if day == d {
            seconds += sampleSeconds
        } else {
            day = d
            seconds = sampleSeconds
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
