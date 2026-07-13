import XCTest
@testable import TimeTrack

final class UUIDv7Tests: XCTestCase {
    func testVersionAndVariantNibbles() {
        // randomByte 0xFF isolates the version/variant masking.
        let id = UUIDv7.generate(now: Date(timeIntervalSince1970: 0), randomByte: { 0xFF })
        let chars = Array(id)
        // "xxxxxxxx-xxxx-Vxxx-Nxxx-xxxxxxxxxxxx" — V at index 14, N at index 19.
        XCTAssertEqual(chars[14], "7", "version nibble must be 7")
        XCTAssertTrue("89ab".contains(chars[19]), "variant nibble must be 8/9/a/b")
    }

    func testTimestampPrefix() {
        // 1000ms since epoch = 0x0000000003E8 in the first 48 bits.
        let id = UUIDv7.generate(now: Date(timeIntervalSince1970: 1.0), randomByte: { 0x00 })
        XCTAssertTrue(id.hasPrefix("00000000-03e8-7"), "got \(id)")
    }

    func testParsesAsValidUUID() {
        let id = UUIDv7.generate()
        XCTAssertNotNil(UUID(uuidString: id))
    }

    func testTwoMintsAreUnique() {
        XCTAssertNotEqual(UUIDv7.generate(), UUIDv7.generate())
    }
}
