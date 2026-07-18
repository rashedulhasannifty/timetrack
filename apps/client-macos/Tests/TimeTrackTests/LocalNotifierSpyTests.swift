import XCTest
@testable import TimeTrack

final class LocalNotifierSpyTests: XCTestCase {
    func testSpyRecordsNotifyAuthAndClear() {
        let spy = SpyNotifier()
        spy.requestAuthorization()
        spy.notify(id: "x", title: "T", body: "B")
        spy.clearAll()

        XCTAssertTrue(spy.authRequested)
        XCTAssertEqual(spy.posted.count, 1)
        XCTAssertEqual(spy.posted.first?.id, "x")
        XCTAssertEqual(spy.posted.first?.body, "B")
        XCTAssertEqual(spy.clearedCount, 1)
    }

    // The concrete UNUserNotifier is exercised only for construction here — actual delivery
    // is a system boundary (no XCTest assertion on UNUserNotificationCenter).
    func testConcreteNotifierConstructs() {
        _ = UNUserNotifier()
    }
}
