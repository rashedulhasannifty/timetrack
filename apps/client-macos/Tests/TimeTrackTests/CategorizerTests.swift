import XCTest
@testable import TimeTrack

final class CategorizerTests: XCTestCase {
    private func make(
        prod: [String] = [], unprod: [String] = [],
        prodSites: [String] = [], unprodSites: [String] = []
    ) -> Categorizer {
        Categorizer(productiveApps: prod, unproductiveApps: unprod,
                    productiveSites: prodSites, unproductiveSites: unprodSites)
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

    func testHostMatchesSiteListNotAppList() {
        // A host in the SITE list categorizes; the same term in the app list would not (split).
        let c = make(prodSites: ["github.com"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "github.com"), .productive)
    }

    func testHostInAppListIsIgnored() {
        // Slice 4.5 clean split: a host is matched only against site lists, never app lists.
        let c = make(unprod: ["youtube.com"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "youtube.com"), .neutral)
    }

    func testAppNameNotMatchedAgainstSiteList() {
        // Symmetric: an app name is matched only against app lists, never site lists.
        let c = make(prodSites: ["Google Chrome"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: nil), .neutral)
    }

    func testHostSuffixMatch() {
        let c = make(unprodSites: ["youtube.com"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "m.youtube.com"), .unproductive)
    }

    func testHostNotInListFallsBackToApp() {
        let c = make(prod: ["Google Chrome"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "example.com"), .productive)
    }

    func testUnproductiveSiteWinsOnOverlap() {
        let c = make(prodSites: ["slack.com"], unprodSites: ["slack.com"])
        XCTAssertEqual(c.category(appName: "x", host: "slack.com"), .unproductive)
    }

    func testWildcardSubdomainMatch() {
        let c = make(prodSites: ["api.*"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "api.stripe.com"), .productive)
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "api.github.com"), .productive)
    }

    func testWildcardRequiresLabelBoundary() {
        // `api.*` matches only hosts whose FIRST label is exactly `api`, not substrings.
        let c = make(prodSites: ["api.*"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "myapi.com"), .neutral)
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "apix.com"), .neutral)
    }

    func testWildcardWorksInUnproductiveList() {
        let c = make(unprodSites: ["ads.*"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "ads.example.com"), .unproductive)
    }

    func testBareWildcardMatchesNothing() {
        let c = make(prodSites: ["*"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "example.com"), .neutral)
    }
}
