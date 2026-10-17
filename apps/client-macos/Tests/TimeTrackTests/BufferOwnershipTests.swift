import XCTest
@testable import TimeTrack

final class BufferOwnershipTests: XCTestCase {
    private var root: URL!
    private var entries: BufferStore!
    private var images: ImageBufferStore!
    private var samples: ActivitySampleStore!

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ownership-\(UUID().uuidString)", isDirectory: true)
        let now = Date()
        entries = BufferStore(directory: root.appendingPathComponent("buffer"), clock: { now })
        images = ImageBufferStore(directory: root.appendingPathComponent("screenshots"), clock: { now })
        samples = ActivitySampleStore(directory: root.appendingPathComponent("activity"), clock: { now })
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    private func ownership() -> BufferOwnership {
        BufferOwnership(fileURL: root.appendingPathComponent("buffer-owner"),
                        buffers: [entries, images, samples])
    }

    private func seedAll() {
        entries.enqueue(id: "e1", kind: .timeEntry, payload: Data("{}".utf8))
        entries.enqueue(id: "i1", kind: .idleEvent, payload: Data("{}".utf8))
        images.enqueue(id: "s1", capturedAt: Date(), jpeg: Data("jpg".utf8))
        samples.enqueue(ActivitySample(id: "a1", timestamp: "2026-01-01T00:00:00Z", appName: "Xcode",
                                       bundleId: nil, windowTitle: nil, activityPct: 50,
                                       category: "NEUTRAL"))
    }

    private var pending: [Int] { [entries.pendingCount(), images.pendingCount(), samples.pendingCount()] }

    func testFirstClaimOnEmptyBuffersRecordsTheOwner() {
        let owned = ownership()
        XCTAssertNil(owned.owner)

        XCTAssertEqual(owned.claim(for: "user-a"), .claimedEmpty)
        XCTAssertEqual(owned.owner, "user-a")
    }

    func testSameUserKeepsTheirUnsentRecords() {
        ownership().claim(for: "user-a")
        seedAll()   // written during A's session, left unsent at sign-out

        // A fresh instance: the owner must survive a relaunch, not just live in memory.
        XCTAssertEqual(ownership().claim(for: "user-a"), .kept)
        XCTAssertEqual(pending, [2, 1, 1], "nothing discarded — A's next session drains it")
    }

    func testDifferentUserDiscardsThePreviousOwnersRecordsBeforeAnyUpload() {
        ownership().claim(for: "user-a")
        seedAll()

        let owned = ownership()
        XCTAssertEqual(owned.claim(for: "user-b"), .discardedPreviousOwner)
        XCTAssertEqual(pending, [0, 0, 0], "A's records can never be sent on B's token")
        XCTAssertEqual(owned.owner, "user-b")
    }

    /// Records written by a build that did not tag ownership. That build could leave another
    /// user's records behind (a launch-time token rejection logged out without clearing), so
    /// nothing proves they are the signed-in user's: discard.
    func testUntaggedLegacyRecordsAreDiscarded() {
        seedAll()

        let owned = ownership()
        XCTAssertEqual(owned.claim(for: "user-a"), .discardedUnowned)
        XCTAssertEqual(pending, [0, 0, 0])
        XCTAssertEqual(owned.owner, "user-a")
    }

    func testTheNewOwnersOwnRecordsAreKeptAfterADiscard() {
        ownership().claim(for: "user-a")
        seedAll()
        ownership().claim(for: "user-b")   // A's discarded
        entries.enqueue(id: "b1", kind: .timeEntry, payload: Data("{}".utf8))

        XCTAssertEqual(ownership().claim(for: "user-b"), .kept)
        XCTAssertEqual(entries.pendingCount(), 1)
    }
}
