import XCTest
@testable import TimeTrack

final class SiteResolverTests: XCTestCase {
    func testExtractsHostLowercasedNoWww() {
        XCTAssertEqual(AppleScriptSiteResolver.host(from: "https://www.YouTube.com/watch?v=1"), "youtube.com")
    }

    func testKeepsSubdomain() {
        XCTAssertEqual(AppleScriptSiteResolver.host(from: "https://mail.google.com/u/0"), "mail.google.com")
    }

    func testStripsOnlyLeadingWww() {
        XCTAssertEqual(AppleScriptSiteResolver.host(from: "https://wwwx.example.com"), "wwwx.example.com")
    }

    func testInvalidUrlIsNil() {
        XCTAssertNil(AppleScriptSiteResolver.host(from: "not a url"))
        XCTAssertNil(AppleScriptSiteResolver.host(from: ""))
        XCTAssertNil(AppleScriptSiteResolver.host(from: "chrome://newtab"))
    }
}
