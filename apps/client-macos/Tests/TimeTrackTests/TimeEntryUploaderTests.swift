import XCTest
@testable import TimeTrack

final class TimeEntryUploaderTests: XCTestCase {
    func testClassifyDecisionTable() {
        XCTAssertEqual(TimeEntryUploader.classify(status: 200), .success)
        XCTAssertEqual(TimeEntryUploader.classify(status: 201), .success)
        // Any 2xx is success. The activity-samples/batch endpoint returns 202 Accepted;
        // treating it as transient wedged the buffer and re-sent the same batch forever.
        XCTAssertEqual(TimeEntryUploader.classify(status: 202), .success, "202 Accepted (activity batch) → success, not transient")
        XCTAssertEqual(TimeEntryUploader.classify(status: 204), .success)
        XCTAssertEqual(TimeEntryUploader.classify(status: 401), .authFailed)
        XCTAssertEqual(TimeEntryUploader.classify(status: 422), .permanent(422))
        XCTAssertEqual(TimeEntryUploader.classify(status: 400), .permanent(400))
        XCTAssertEqual(TimeEntryUploader.classify(status: 429), .transient, "throttled → retry, not drop")
        XCTAssertEqual(TimeEntryUploader.classify(status: 408), .transient, "request timeout → retry, not drop")
        XCTAssertEqual(TimeEntryUploader.classify(status: 500), .transient)
        XCTAssertEqual(TimeEntryUploader.classify(status: 503), .transient)
        XCTAssertEqual(TimeEntryUploader.classify(status: 0), .transient, "no HTTP response → retry later")
    }
}
