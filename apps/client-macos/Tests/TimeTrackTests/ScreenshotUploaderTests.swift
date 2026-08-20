import XCTest
@testable import TimeTrack

final class ScreenshotUploaderTests: XCTestCase {
    func testMultipartBodyPutsIdAndTimestampBeforeFile() {
        let body = ScreenshotUploader.multipartBody(
            boundary: "BOUNDARY",
            id: "01890000-0000-7000-8000-000000000000",
            timestampISO: "2026-07-17T10:00:00Z",
            group: nil,
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
            boundary: "BOUNDARY", id: "the-id", timestampISO: "2026-07-17T10:00:00Z",
            group: nil, jpeg: Data([1, 2, 3]))
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("Content-Type: image/jpeg"))
        XCTAssertTrue(text.contains("filename=\"the-id.jpg\""))
        XCTAssertTrue(text.contains("--BOUNDARY--"), "closing boundary present")
        XCTAssertTrue(text.contains("the-id"))
        XCTAssertTrue(text.contains("2026-07-17T10:00:00Z"))
    }

    /// The grouping fields are text parts, so they fall under the same ordering invariant as
    /// id/timestamp: anything after the file part is invisible to `req.file()` on the server.
    func testMultipartBodyPutsTheCaptureGroupBeforeTheFile() {
        let body = ScreenshotUploader.multipartBody(
            boundary: "BOUNDARY",
            id: "the-id",
            timestampISO: "2026-07-17T10:00:00Z",
            group: CaptureGroup(id: "group-1", displayIndex: 1, displayCount: 2),
            jpeg: Data([1, 2, 3]))
        let text = String(decoding: body, as: UTF8.self)

        let filePos = text.range(of: "name=\"file\"")!
        for field in ["captureGroupId", "displayIndex", "displayCount"] {
            let pos = text.range(of: "name=\"\(field)\"")
            XCTAssertNotNil(pos, "\(field) present")
            XCTAssertTrue(pos!.lowerBound < filePos.lowerBound, "\(field) before file")
        }
        XCTAssertTrue(text.contains("group-1"))
    }

    /// A record buffered by the previous build carries no group. It must still upload — the
    /// server treats the fields as optional — rather than being dropped after an update.
    func testMultipartBodyOmitsTheGroupFieldsWhenThereIsNoGroup() {
        let body = ScreenshotUploader.multipartBody(
            boundary: "BOUNDARY", id: "the-id", timestampISO: "2026-07-17T10:00:00Z",
            group: nil, jpeg: Data([1, 2, 3]))
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertFalse(text.contains("captureGroupId"))
        XCTAssertFalse(text.contains("displayIndex"))
        XCTAssertTrue(text.contains("name=\"id\""), "the required fields are still there")
    }
}
