import XCTest
@testable import TimeTrack

final class CategorizerTests: XCTestCase {
    private func make(prod: [String] = [], unprod: [String] = []) -> Categorizer {
        Categorizer(productiveApps: prod, unproductiveApps: unprod)
    }

    func testDefaultsToNeutral() {
        XCTAssertEqual(make().category(appName: "Xcode", host: nil), .neutral)
    }

    func testAppNameMatchCaseInsensitiveAndTrimmed() {
        let c = make(prod: ["  xCode "])
        XCTAssertEqual(c.category(appName: "Xcode", host: nil), .productive)
    }

    func testUnproductiveAppMatch() {
        let c = make(unprod: ["Twitter"])
        XCTAssertEqual(c.category(appName: "Twitter", host: nil), .unproductive)
    }

    func testHostWinsOverApp() {
        // App would be neutral, but the host is productive.
        let c = make(prod: ["github.com"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "github.com"), .productive)
    }

    func testHostSuffixMatch() {
        let c = make(unprod: ["youtube.com"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "m.youtube.com"), .unproductive)
    }

    func testHostNotInListFallsBackToApp() {
        let c = make(prod: ["Google Chrome"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "example.com"), .productive)
    }

    func testUnproductiveWinsOnOverlap() {
        let c = make(prod: ["slack.com"], unprod: ["slack.com"])
        XCTAssertEqual(c.category(appName: "x", host: "slack.com"), .unproductive)
    }
}
