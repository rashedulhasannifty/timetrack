import XCTest
@testable import TimeTrack

final class AuthClientHeaderTests: XCTestCase {
    private let base = URL(string: "http://api.test/v1")!

    func testSendsPlatformAndVersionOnLoginAndRefresh() throws {
        let client = AuthClient(baseURL: base, version: AppVersion("0.7.0-pilot"))
        for path in ["auth/login", "auth/refresh"] {
            let request = try client.makeRequest(path, body: [:])
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Client-Platform"), "MACOS")
            // The suffix is dropped: the API accepts dotted numbers only.
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Client-Version"), "0.7.0")
        }
    }

    func testSendsNoIdentityHeadersWithoutAVersion() throws {
        let request = try AuthClient(baseURL: base, version: nil).makeRequest("auth/login", body: [:])
        XCTAssertNil(request.value(forHTTPHeaderField: "X-Client-Platform"))
        XCTAssertNil(request.value(forHTTPHeaderField: "X-Client-Version"))
    }
}
