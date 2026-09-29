import XCTest
@testable import TimeTrack

final class LiveSpanStoreTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeStore(userId: String? = "user-1", clock: @escaping () -> Date = Date.init)
        -> (LiveSpanStore, URL) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("livespan-\(UUID().uuidString).json")
        return (LiveSpanStore(fileURL: url, clock: clock, currentUserId: { userId }), url)
    }

    private let sel = TimeTracker.Selection(projectId: "p1", subprojectId: "s2", taskId: nil)

    func testBeginWritesASpanThatLoadRoundTrips() {
        let (store, _) = makeStore(userId: "user-1")
        store.begin(entryId: "e1", startTime: t0, selection: sel, source: .auto)

        let span = store.load()
        XCTAssertEqual(span?.entryId, "e1")
        XCTAssertEqual(span?.startTime, t0)
        XCTAssertEqual(span?.projectId, "p1")
        XCTAssertNil(span?.taskId)
        XCTAssertEqual(span?.source, "AUTO")
        XCTAssertEqual(span?.lastAlive, t0, "lastAlive starts at startTime")
        XCTAssertEqual(span?.userId, "user-1", "userId is stamped from the provider")
    }

    func testHeartbeatUpdatesOnlyLastAlive() {
        let (store, _) = makeStore()
        store.begin(entryId: "e1", startTime: t0, selection: sel, source: .manual)
        store.heartbeat(at: t0.addingTimeInterval(120))

        let span = store.load()
        XCTAssertEqual(span?.lastAlive, t0.addingTimeInterval(120))
        XCTAssertEqual(span?.entryId, "e1")
        XCTAssertEqual(span?.startTime, t0, "start unchanged")
        XCTAssertEqual(span?.source, "MANUAL")
    }

    func testClearRemovesTheSpan() {
        let (store, _) = makeStore()
        store.begin(entryId: "e1", startTime: t0, selection: sel, source: .manual)
        store.clear()
        XCTAssertNil(store.load(), "no leftover after a clean clear")
    }

    func testLoadOnMissingFileReturnsNil() {
        let (store, _) = makeStore()
        XCTAssertNil(store.load())
    }

    func testShouldRecoverGate() {
        let base = LiveSpan(entryId: "e1", startTime: t0, projectId: nil, subprojectId: nil, taskId: nil,
                            source: "MANUAL", lastAlive: t0, userId: "user-1")
        XCTAssertTrue(LiveSpanStore.shouldRecover(span: base, currentUserId: "user-1"), "same user → recover")
        XCTAssertFalse(LiveSpanStore.shouldRecover(span: base, currentUserId: "user-2"), "different user → refuse")
        let legacy = LiveSpan(entryId: "e1", startTime: t0, projectId: nil, subprojectId: nil, taskId: nil,
                              source: "MANUAL", lastAlive: t0, userId: nil)
        XCTAssertTrue(LiveSpanStore.shouldRecover(span: legacy, currentUserId: "user-2"),
                      "span with no owner → treat as current")
    }

    func testBeginPersistsTheSubproject() {
        let (store, _) = makeStore()
        store.begin(entryId: "e1", startTime: t0, selection: sel, source: .manual)
        XCTAssertEqual(store.load()?.subprojectId, "s2")
    }

    /// A live-span.json written by 0.6.x has no subprojectId; recovery must still read it.
    func testLoadsASpanWrittenBeforeSubprojectsExisted() throws {
        let (store, url) = makeStore()
        let legacy = try JSONEncoder().encode(LiveSpan(entryId: "e1", startTime: t0, projectId: "p1",
                                                       subprojectId: nil, taskId: nil, source: "MANUAL",
                                                       lastAlive: t0, userId: "user-1"))
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: legacy) as? [String: Any])
        object.removeValue(forKey: "subprojectId")
        try JSONSerialization.data(withJSONObject: object).write(to: url)

        XCTAssertEqual(store.load()?.entryId, "e1")
        XCTAssertNil(store.load()?.subprojectId)
    }
}
