import Foundation

/// Slice 2.4 — the end-of-day summary "shell". A daily wall-clock timer fires at `hour:00` local,
/// reads today's tracked seconds (`total`), and posts one local notification, then reschedules.
/// Best-effort by design: a wall-clock `Timer` will NOT fire if the app is not running or the Mac
/// is asleep at `hour` — acceptable for a nicety (the truth is the synced time entries). No
/// network, no logging.
final class EndOfDayScheduler {
    private let hour: Int
    private let calendar: Calendar
    private let notifier: LocalNotifying
    private let total: (Date) -> Int
    private let clock: () -> Date
    private var timer: Timer?

    init(hour: Int, calendar: Calendar = .current, notifier: LocalNotifying,
         total: @escaping (Date) -> Int, clock: @escaping () -> Date = Date.init) {
        self.hour = hour
        self.calendar = calendar
        self.notifier = notifier
        self.total = total
        self.clock = clock
    }

    func start() { scheduleNext() }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    /// Post the summary for the current local day. `internal` so the test can drive it directly.
    func fire() {
        let secs = total(clock())
        notifier.notify(id: "end-of-day", title: "Time tracking",
                        body: "Today: ~\(Self.formatDuration(seconds: secs)) tracked. Nice work.")
    }

    static func nextFire(after now: Date, hour: Int, calendar: Calendar) -> Date {
        var comps = calendar.dateComponents([.year, .month, .day], from: now)
        comps.hour = hour; comps.minute = 0; comps.second = 0
        let todayAtHour = calendar.date(from: comps)!
        if todayAtHour > now { return todayAtHour }
        return calendar.date(byAdding: .day, value: 1, to: todayAtHour)!
    }

    static func formatDuration(seconds: Int) -> String {
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    private func scheduleNext() {
        timer?.invalidate()
        let fireDate = Self.nextFire(after: clock(), hour: hour, calendar: calendar)
        let interval = max(1, fireDate.timeIntervalSince(clock()))
        let t = Timer(timeInterval: interval, repeats: false) { [weak self] _ in
            self?.fire()
            self?.scheduleNext()
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }
}
