import XCTest
@testable import TimeTrack

final class TimeEntryUploaderTests: XCTestCase {
    func testClassifyDecisionTable() {
        XCTAssertEqual(TimeEntryUploader.classify(status: 200), .success)
        XCTAssertEqual(TimeEntryUploader.classify(status: 201), .success)
        XCTAssertEqual(TimeEntryUploader.classify(status: 401), .authFailed)
        XCTAssertEqual(TimeEntryUploader.classify(status: 422), .permanent(422))
        XCTAssertEqual(TimeEntryUploader.classify(status: 400), .permanent(400))
        XCTAssertEqual(TimeEntryUploader.classify(status: 500), .transient)
        XCTAssertEqual(TimeEntryUploader.classify(status: 503), .transient)
        XCTAssertEqual(TimeEntryUploader.classify(status: 0), .transient, "no HTTP response → retry later")
    }
}
