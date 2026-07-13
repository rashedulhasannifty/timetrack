import XCTest
@testable import TimeTrack

final class JWTDecoderTests: XCTestCase {
    // header.payload.signature — payload is base64url of
    // {"sub":"11111111-1111-7111-8111-111111111111","role":"EMPLOYEE","teamId":"22222222-2222-7222-8222-222222222222"}
    private let token =
        "eyJhbGciOiJIUzI1NiJ9." +
        "eyJzdWIiOiIxMTExMTExMS0xMTExLTcxMTEtODExMS0xMTExMTExMTExMTEiLCJyb2xlIjoiRU1QTE9ZRUUiLCJ0ZWFtSWQiOiIyMjIyMjIyMi0yMjIyLTcyMjItODIyMi0yMjIyMjIyMjIyMjIifQ." +
        "c2ln"

    func testDecodesSub() throws {
        let claims = try JWTDecoder.claims(from: token)
        XCTAssertEqual(claims.sub, "11111111-1111-7111-8111-111111111111")
        XCTAssertEqual(claims.role, "EMPLOYEE")
        XCTAssertEqual(claims.teamId, "22222222-2222-7222-8222-222222222222")
    }

    func testMalformedTokenThrows() {
        XCTAssertThrowsError(try JWTDecoder.claims(from: "not-a-jwt"))
    }
}
