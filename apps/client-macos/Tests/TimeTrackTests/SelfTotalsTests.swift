import XCTest
@testable import TimeTrack

final class WorkTotalFormatTests: XCTestCase {
    func testShowsMinutesOnlyUnderAnHour() {
        XCTAssertEqual(WorkTotalFormat.short(seconds: 0), "0m")
        XCTAssertEqual(WorkTotalFormat.short(seconds: 59), "0m")      // rounds down, never up
        XCTAssertEqual(WorkTotalFormat.short(seconds: 12 * 60), "12m")
    }

    func testShowsHoursAndMinutesOnceThereIsAnHour() {
        XCTAssertEqual(WorkTotalFormat.short(seconds: 3600), "1h 0m")
        XCTAssertEqual(WorkTotalFormat.short(seconds: 8 * 3600 + 12 * 60), "8h 12m")
    }

    /// A month of tracked time is a big number; it must not wrap into days or scientific-looking
    /// output — the dropdown shows hours however many there are.
    func testKeepsCountingInHoursForALongMonth() {
        XCTAssertEqual(WorkTotalFormat.short(seconds: 187 * 3600 + 30 * 60), "187h 30m")
    }

    /// Defensive: the server sends a non-negative int, but a negative would otherwise render as
    /// "-1h -30m" rather than something harmless.
    func testClampsANegativeToZero() {
        XCTAssertEqual(WorkTotalFormat.short(seconds: -90), "0m")
    }
}

final class SelfTotalsDecodingTests: XCTestCase {
    /// The client does NO date arithmetic — it renders what the server resolved. This pins the
    /// wire shape those fields arrive in.
    func testDecodesTheServerPayload() throws {
        let json = """
        {
          "day": "2026-09-02",
          "weekStart": "2026-08-31",
          "monthStart": "2026-09-01",
          "todaySeconds": 3600,
          "weekSeconds": 10800,
          "monthSeconds": 3600
        }
        """
        let totals = try JSONDecoder().decode(SelfTotals.self, from: Data(json.utf8))

        XCTAssertEqual(totals.day, "2026-09-02")
        XCTAssertEqual(totals.todaySeconds, 3600)
        // A Monday-start week beginning in the PREVIOUS month: the week total legitimately
        // exceeds the month total, and the client must render it as sent rather than "correcting"
        // what looks like a bug.
        XCTAssertEqual(totals.weekStart, "2026-08-31")
        XCTAssertGreaterThan(totals.weekSeconds, totals.monthSeconds)
    }

    func testRejectsAPayloadMissingAField() {
        let json = """
        {"day":"2026-09-02","weekStart":"2026-08-31","monthStart":"2026-09-01","todaySeconds":1}
        """
        XCTAssertThrowsError(try JSONDecoder().decode(SelfTotals.self, from: Data(json.utf8)))
    }
}

/// The arithmetic that makes the dropdown's totals tick. The trap it exists to avoid: the
/// server's figure ALREADY counts the running entry up to the moment it was fetched (while
/// heartbeats are fresh the staleness clamp resolves to `now()`), so adding the session's whole
/// elapsed time on top would count most of it twice.
final class LiveTotalTests: XCTestCase {
    private let fetched = Date(timeIntervalSince1970: 1_000_000)

    func testAddsOnlyTheTimeSinceTheFetch() {
        // Session started 10 minutes BEFORE the fetch; 60s have passed since.
        let total = MenuViewModel.liveTotal(
            base: 3600,
            phase: .tracking,
            fetchedAt: fetched,
            startedAt: fetched.addingTimeInterval(-600),
            now: fetched.addingTimeInterval(60))

        // 3600 + 60, NOT 3600 + 660: the first 10 minutes are already inside `base`.
        XCTAssertEqual(total, 3660)
    }

    /// A session that began after the fetch has only run since it started. Counting from the
    /// fetch would add idle minutes nobody tracked.
    func testCountsFromTheSessionStartWhenTrackingBeganAfterTheFetch() {
        let total = MenuViewModel.liveTotal(
            base: 3600,
            phase: .tracking,
            fetchedAt: fetched,
            startedAt: fetched.addingTimeInterval(300),   // started 5 min after the fetch
            now: fetched.addingTimeInterval(360))         // 60s of actual tracking

        XCTAssertEqual(total, 3660)
    }

    func testAStoppedOrPausedClockAccruesNothing() {
        for phase in [MenuViewModel.Phase.idle, .paused] {
            let total = MenuViewModel.liveTotal(
                base: 3600,
                phase: phase,
                fetchedAt: fetched,
                startedAt: fetched.addingTimeInterval(-600),
                now: fetched.addingTimeInterval(600))
            XCTAssertEqual(total, 3600, "\(phase) must not accrue time")
        }
    }

    func testFallsBackToTheBaseWhenThereIsNothingToAnchorOn() {
        XCTAssertEqual(
            MenuViewModel.liveTotal(base: 42, phase: .tracking, fetchedAt: nil,
                                    startedAt: fetched, now: fetched.addingTimeInterval(60)),
            42)
        XCTAssertEqual(
            MenuViewModel.liveTotal(base: 42, phase: .tracking, fetchedAt: fetched,
                                    startedAt: nil, now: fetched.addingTimeInterval(60)),
            42)
    }

    /// A clock skew that puts `now` behind the anchor must never subtract from a total.
    func testNeverGoesBackwards() {
        let total = MenuViewModel.liveTotal(
            base: 3600,
            phase: .tracking,
            fetchedAt: fetched,
            startedAt: fetched,
            now: fetched.addingTimeInterval(-90))
        XCTAssertEqual(total, 3600)
    }
}

final class MenuViewModelTotalsTests: XCTestCase {
    private func totals(today: Int) -> SelfTotals {
        SelfTotals(day: "2026-08-21", weekStart: "2026-08-17", monthStart: "2026-08-01",
                   todaySeconds: today, weekSeconds: today, monthSeconds: today)
    }

    /// Sign-out must not leave one person's tracked time on screen for whoever signs in next —
    /// the same discipline the project list and the selection cache already follow.
    func testResetClearsTheTotals() {
        // A throwaway defaults suite — never `.standard`, which would write into the real user
        // preferences of whatever machine runs the suite.
        let suiteName = "Totals-\(UUID().uuidString)"
        let vm = MenuViewModel(
            tracker: TimeTracker(buffer: BufferSpy(),
                                 clock: { Date(timeIntervalSince1970: 0) },
                                 idGen: { _ in "id-1" }),
            dashboardURL: URL(string: "https://example.test")!,
            openURL: { _ in },
            onSignIn: {},
            onSignOut: {},
            onQuit: {},
            selectionStore: SelectionStore(defaults: UserDefaults(suiteName: suiteName)!)
        )
        defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }
        vm.totals = totals(today: 3600)
        vm.totalsFetchedAt = Date()

        vm.reset()

        XCTAssertNil(vm.totals, "a prior user's totals must not survive sign-out")
        XCTAssertNil(vm.totalsFetchedAt, "and neither must the instant they were true at")
    }
}
