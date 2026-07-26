import XCTest
@testable import TimeTrack

final class FanOutSignalReceiverTests: XCTestCase {
    private final class Spy: AutoTrackingSignalReceiver {
        var log: [String] = []
        func tick(idleSeconds: Int) { log.append("tick(\(idleSeconds))") }
        func markAway() { log.append("markAway") }
        func resume() { log.append("resume") }
    }

    func testForwardsEverySignalToEveryReceiverInOrder() {
        let a = Spy(); let b = Spy()
        let fan = FanOutSignalReceiver([a, b])
        fan.tick(idleSeconds: 42)
        fan.markAway()
        fan.resume()
        XCTAssertEqual(a.log, ["tick(42)", "markAway", "resume"])
        XCTAssertEqual(b.log, ["tick(42)", "markAway", "resume"])
    }
}
