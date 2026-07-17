import XCTest
@testable import TimeTrack

final class ScreenshotUploaderTests: XCTestCase {
    func testMultipartBodyPutsIdAndTimestampBeforeFile() {
        let body = ScreenshotUploader.multipartBody(
            boundary: "BOUNDARY",
            id: "01890000-0000-7000-8000-000000000000",
            timestampISO: "2026-07-17T10:00:00Z",
            jpeg: Data([0xFF, 0xD8, 0xFF])
        )
        let text = String(decoding: body, as: UTF8.self)

        let idPos = text.range(of: "name=\"id\"")
        let tsPos = text.range(of: "name=\"timestamp\"")
        let filePos = text.range(of: "name=\"file\"")
        XCTAssertNotNil(idPos); XCTAssertNotNil(tsPos); XCTAssertNotNil(filePos)
        // The 2.2a server contract: text fields MUST precede the file part, or req.file()
        // yields undefined metadata → 422 on every upload.
        XCTAssertTrue(idPos!.lowerBound < filePos!.lowerBound, "id before file")
        XCTAssertTrue(tsPos!.lowerBound < filePos!.lowerBound, "timestamp before file")
        XCTAssertTrue(idPos!.lowerBound < tsPos!.lowerBound, "id before timestamp")
    }

    func testMultipartBodyDeclaresJpegPartAndValues() {
        let body = ScreenshotUploader.multipartBody(
            boundary: "BOUNDARY", id: "the-id", timestampISO: "2026-07-17T10:00:00Z", jpeg: Data([1, 2, 3]))
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("Content-Type: image/jpeg"))
        XCTAssertTrue(text.contains("filename=\"the-id.jpg\""))
        XCTAssertTrue(text.contains("--BOUNDARY--"), "closing boundary present")
        XCTAssertTrue(text.contains("the-id"))
        XCTAssertTrue(text.contains("2026-07-17T10:00:00Z"))
    }
}
