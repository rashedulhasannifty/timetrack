import XCTest
@testable import TimeTrack

final class ActivitySampleUploaderTests: XCTestCase {
    func testBodyWrapsSamplesUnderSamplesKey() throws {
        let s = ActivitySample(id: "a", timestamp: "2023-11-14T22:13:20Z", appName: "Xcode",
                               bundleId: "com.apple.dt.Xcode", windowTitle: nil, activityPct: 80,
                               category: "PRODUCTIVE")
        let data = ActivitySampleUploader.body(samples: [s])
        let decoded = try JSONDecoder().decode([String: [ActivitySample]].self, from: data)
        XCTAssertEqual(decoded["samples"], [s])
    }

    func testClassifyReusesSharedMapping() {
        // Batch uploader reuses TimeEntryUploader.classify — assert the contract it depends on.
        XCTAssertEqual(TimeEntryUploader.classify(status: 201), .success)
        XCTAssertEqual(TimeEntryUploader.classify(status: 429), .transient)
        XCTAssertEqual(TimeEntryUploader.classify(status: 422), .permanent(422))
        XCTAssertEqual(TimeEntryUploader.classify(status: 401), .authFailed)
    }
}
