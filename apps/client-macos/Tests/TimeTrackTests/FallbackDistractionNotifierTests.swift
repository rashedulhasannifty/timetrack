import XCTest
@testable import TimeTrack

final class FallbackDistractionNotifierTests: XCTestCase {
    private func make(authorized: Bool)
        -> (FallbackDistractionNotifier, SpyNotifier, () -> [(String, String)]) {
        let spy = SpyNotifier()
        var windows: [(String, String)] = []
        let notifier = FallbackDistractionNotifier(
            primary: spy,
            isAuthorized: { completion in completion(authorized) },
            presentWindow: { title, body in windows.append((title, body)) }
        )
        return (notifier, spy, { windows })
    }

    func testAuthorizedPostsSystemNotificationNoWindow() {
        let (notifier, spy, windows) = make(authorized: true)
        notifier.notify(id: "distraction", title: "Time tracking", body: "~10 min — refocus?")
        XCTAssertEqual(spy.posted.count, 1, "authorized → the system notification is posted")
        XCTAssertEqual(spy.posted.first?.body, "~10 min — refocus?")
        XCTAssertTrue(windows().isEmpty, "authorized → no in-app window")
    }

    func testUnauthorizedShowsWindowNoSystemNotification() {
        let (notifier, spy, windows) = make(authorized: false)
        notifier.notify(id: "distraction", title: "Time tracking", body: "~10 min — refocus?")
        XCTAssertTrue(spy.posted.isEmpty, "unauthorized → nothing handed to the (dropping) system notifier")
        XCTAssertEqual(windows().count, 1, "unauthorized → the in-app fallback window is shown once")
        XCTAssertEqual(windows().first?.0, "Time tracking")
        XCTAssertEqual(windows().first?.1, "~10 min — refocus?", "window carries only the generic nudge text")
    }

    func testRequestAuthorizationAndClearForwardToPrimary() {
        let (notifier, spy, _) = make(authorized: false)
        notifier.requestAuthorization()
        notifier.clearAll()
        XCTAssertTrue(spy.authRequested, "requestAuthorization forwards to the real notifier")
        XCTAssertEqual(spy.clearedCount, 1, "clearAll forwards to the real notifier")
    }
}
