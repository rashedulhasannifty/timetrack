import XCTest
@testable import TimeTrack

final class SessionEndMonitorTests: XCTestCase {
    private func monitor(rejected: Bool, confirms: CallCounter, ends: CallCounter) -> SessionEndMonitor {
        SessionEndMonitor(
            confirmRejected: { confirms.increment(); return rejected },
            onSessionEnded: { ends.increment() }
        )
    }

    func testAConfirmedRejectionEndsTheSessionOnce() async {
        let confirms = CallCounter(), ends = CallCounter()
        let m = monitor(rejected: true, confirms: confirms, ends: ends)
        await m.rearm()

        // Three engines report the same dead session.
        await m.authFailed()
        await m.authFailed()
        await m.authFailed()

        XCTAssertEqual(ends.value, 1, "one sign-out, not three")
        XCTAssertEqual(confirms.value, 1, "no re-check once the session has ended")
    }

    func testConcurrentReportsShareOneCheck() async {
        let confirms = CallCounter(), ends = CallCounter()
        let m = monitor(rejected: true, confirms: confirms, ends: ends)
        await m.rearm()

        async let a: Void = m.authFailed()
        async let b: Void = m.authFailed()
        async let c: Void = m.authFailed()
        _ = await (a, b, c)

        XCTAssertEqual(ends.value, 1)
    }

    /// A 401 after a refresh that worked is not proof the session is dead — keep it.
    func testAnUnconfirmedReportLeavesTheSessionAlone() async {
        let confirms = CallCounter(), ends = CallCounter()
        let m = monitor(rejected: false, confirms: confirms, ends: ends)
        await m.rearm()

        await m.authFailed()
        await m.authFailed()

        XCTAssertEqual(confirms.value, 2, "still armed: each later report is checked again")
        XCTAssertEqual(ends.value, 0)
    }

    func testReportsBeforeASessionBeginsOrAfterSignOutAreIgnored() async {
        let confirms = CallCounter(), ends = CallCounter()
        let m = monitor(rejected: true, confirms: confirms, ends: ends)

        await m.authFailed()            // never armed
        await m.rearm()
        await m.disarm()                // the person signed out
        await m.authFailed()

        XCTAssertEqual(confirms.value, 0)
        XCTAssertEqual(ends.value, 0)
    }

    func testTheNextSessionCanEndToo() async {
        let confirms = CallCounter(), ends = CallCounter()
        let m = monitor(rejected: true, confirms: confirms, ends: ends)
        await m.rearm()
        await m.authFailed()
        await m.rearm()                 // signed back in
        await m.authFailed()

        XCTAssertEqual(ends.value, 2)
    }
}
