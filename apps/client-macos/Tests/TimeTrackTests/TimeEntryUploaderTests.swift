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

    // MARK: - a refresh the server rejects is a dead session, not a network blip

    /// No access token in memory, so `upload` refreshes first and never reaches the network.
    private func session(refreshFailsWith error: Error) -> AuthSession {
        AuthSession(client: FakeAuthClient(refreshResult: .failure(error)),
                    store: InMemoryTokenStore(seed: "refresh-0"))
    }
    private let unreachable = URL(string: "http://127.0.0.1:9/v1")!
    private let sample = ActivitySample(id: "a1", timestamp: "2026-01-01T00:00:00Z", appName: "Xcode",
                                        bundleId: nil, windowTitle: nil, activityPct: 50, category: "NEUTRAL")

    func testRejectedRefreshIsAuthFailedForEveryUploader() async {
        let rejected = session(refreshFailsWith: AuthError.refreshRejected)

        let entry = await TimeEntryUploader(baseURL: unreachable, session: rejected).upload(Data("{}".utf8))
        let batch = await ActivitySampleUploader(baseURL: unreachable, session: rejected).upload([sample])
        let image = await ScreenshotUploader(baseURL: unreachable, session: rejected)
            .upload(id: "s1", capturedAt: Date(), group: nil, jpeg: Data("jpg".utf8))

        XCTAssertEqual(entry, .authFailed, "was .transient: a revoked user retried forever, still 'signed in'")
        XCTAssertEqual(batch, .authFailed)
        XCTAssertEqual(image, .authFailed)
    }

    func testRefreshThatCouldNotReachTheServerStaysTransient() async {
        let offline = session(refreshFailsWith: AuthError.transport)

        let entry = await TimeEntryUploader(baseURL: unreachable, session: offline).upload(Data("{}".utf8))
        let batch = await ActivitySampleUploader(baseURL: unreachable, session: offline).upload([sample])
        let image = await ScreenshotUploader(baseURL: unreachable, session: offline)
            .upload(id: "s1", capturedAt: Date(), group: nil, jpeg: Data("jpg".utf8))

        XCTAssertEqual(entry, .transient)
        XCTAssertEqual(batch, .transient)
        XCTAssertEqual(image, .transient)
    }
}
