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

    func testMoreSpecificProductiveBeatsBroaderUnproductive() {
        // The AWS-console-under-amazon.com collision: specific productive wins.
        let c = make(prodSites: ["aws.amazon.com"], unprodSites: ["amazon.com"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "console.aws.amazon.com"), .productive)
    }

    func testMoreSpecificUnproductiveBeatsBroaderProductive() {
        let c = make(prodSites: ["google.com"], unprodSites: ["mail.google.com"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "mail.google.com"), .unproductive)
    }

    func testExactMatchBeatsBroaderSuffix() {
        let c = make(prodSites: ["mail.google.com"], unprodSites: ["google.com"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "mail.google.com"), .productive)
    }

    func testDomainRuleOutranksWildcard() {
        // A real-domain suffix is more specific than a broad `api.*` wildcard.
        let c = make(prodSites: ["stripe.com"], unprodSites: ["api.*"])
        XCTAssertEqual(c.category(appName: "Google Chrome", host: "api.stripe.com"), .productive)
    }

    func testAppMatchesByBundleId() {
        let c = make(prod: ["com.microsoft.VSCode"])
        XCTAssertEqual(c.category(appName: "Code", bundleId: "com.microsoft.VSCode", host: nil), .productive)
    }

    func testBundleIdRuleSurvivesARename() {
        // The display name differs from what an admin might have typed, but the bundleId rule holds.
        let c = make(prod: ["com.microsoft.VSCode"])
        XCTAssertEqual(
            c.category(appName: "Visual Studio Code", bundleId: "com.microsoft.VSCode", host: nil),
            .productive)
    }

    func testAppNameRuleStillMatchesWithABundleIdPresent() {
        let c = make(prod: ["Slack"])
        XCTAssertEqual(
            c.category(appName: "Slack", bundleId: "com.tinyspeck.slackmacgap", host: nil), .productive)
    }

    func testBundleIdMatchIsCaseInsensitive() {
        let c = make(prod: ["COM.MICROSOFT.VSCODE"])
        XCTAssertEqual(c.category(appName: "x", bundleId: "com.microsoft.vscode", host: nil), .productive)
    }

    func testUnproductiveByBundleId() {
        let c = make(unprod: ["com.example.game"])
        XCTAssertEqual(c.category(appName: "Some Game", bundleId: "com.example.game", host: nil), .unproductive)
    }

    func testNilBundleIdFallsBackToNameOnly() {
        let c = make(prod: ["com.microsoft.VSCode"])
        // No bundleId and the name isn't the rule → NEUTRAL (bundleId rules need a bundleId).
        XCTAssertEqual(c.category(appName: "Code", bundleId: nil, host: nil), .neutral)
    }
}
