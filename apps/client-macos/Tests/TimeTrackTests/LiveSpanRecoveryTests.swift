import XCTest
@testable import TimeTrack

/// Spec §4.4 — the interrupted-time recovery prompt resolves BOTH records of the span: the
/// server's still-open row and the local file. The server close must be DURABLE, not a
/// best-effort POST: one failed request would clear the local span while leaving the row open
/// forever, 409ing every later open-publish and heartbeat for that user.
final class LiveSpanRecoveryTests: XCTestCase {
    private final class SpanStoreSpy: LiveSpanRecording {
        private(set) var clears = 0
        func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection,
                   source: TimeTracker.Source) {}
        func clear() { clears += 1 }
    }

    private let start = Date(timeIntervalSince1970: 1_787_000_000)

    private func span(userId: String?) -> LiveSpan {
        LiveSpan(
            entryId: "01920000-0000-7000-8000-000000000030",
            startTime: start,
            projectId: "p1", taskId: "k1",
            source: "AUTO",
            lastAlive: start.addingTimeInterval(1800),
            userId: userId
        )
    }

    private func make(currentUserId: String?) -> (LiveSpanRecovery, BufferSpy, SpanStoreSpy) {
        let buffer = BufferSpy()
        let store = SpanStoreSpy()
        let tracker = TimeTracker(buffer: buffer, liveSpan: store)
        let recovery = LiveSpanRecovery(tracker: tracker, store: store,
                                        currentUserId: { currentUserId })
        return (recovery, buffer, store)
    }

    /// The regression this file exists for: Discard used to fire-and-forget a POST, so an
    /// offline relaunch stranded the server row permanently. It must reach the durable buffer.
    func testDiscardDurablyEnqueuesAZeroDurationClose() throws {
        let (recovery, buffer, store) = make(currentUserId: "u1")

        recovery.apply(.discard, to: span(userId: "u1"))

        XCTAssertEqual(buffer.entries.count, 1, "the discard close must be buffered, not fire-and-forget")
        XCTAssertEqual(buffer.entries[0].kind, .timeEntry)
        let body = buffer.object(at: 0)
        XCTAssertEqual(body["id"] as? String, span(userId: "u1").entryId, "same id → the upsert closes the existing row")
        // Zero duration: releases the one-open-entry index slot and is filtered out of every
        // server-side list and export.
        XCTAssertEqual(body["startTime"] as? String, body["endTime"] as? String)
        // NOT closed at lastAlive — that would silently KEEP the time the user discarded.
        XCTAssertNotEqual(body["endTime"] as? String,
                          TimeEntryPayload.iso.string(from: span(userId: "u1").lastAlive))
        XCTAssertEqual(store.clears, 1)
    }

    func testKeepDurablyEnqueuesACloseAtTheLastHeartbeat() throws {
        let (recovery, buffer, store) = make(currentUserId: "u1")
        let s = span(userId: "u1")

        recovery.apply(.keep, to: s)

        XCTAssertEqual(buffer.entries.count, 1)
        let body = buffer.object(at: 0)
        XCTAssertEqual(body["id"] as? String, s.entryId)
        XCTAssertEqual(body["startTime"] as? String, TimeEntryPayload.iso.string(from: s.startTime))
        // Ends at the last heartbeat, so downtime is never counted.
        XCTAssertEqual(body["endTime"] as? String, TimeEntryPayload.iso.string(from: s.lastAlive))
        XCTAssertEqual(store.clears, 1)
    }

    /// CLAUDE.md §1 cross-user integrity: the prompt is non-modal and can outlive the user who
    /// opened it. A span belonging to someone else is dropped locally and never enqueued —
    /// buffered records sync under whoever's token is current.
    func testASpanFromAnotherUserIsClearedWithoutEnqueuing() throws {
        for action in [AwayResolution.keep, .discard] {
            let (recovery, buffer, store) = make(currentUserId: "u2")
            recovery.apply(action, to: span(userId: "u1"))
            XCTAssertTrue(buffer.entries.isEmpty, "\(action) must not enqueue another user's span")
            XCTAssertEqual(store.clears, 1, "the local file is still cleared")
        }
    }

    /// Signed out (no current user) is the same refusal: nothing is enqueued.
    func testASpanIsNotEnqueuedWhenNobodyIsSignedIn() throws {
        let (recovery, buffer, store) = make(currentUserId: nil)
        recovery.apply(.discard, to: span(userId: "u1"))
        XCTAssertTrue(buffer.entries.isEmpty)
        XCTAssertEqual(store.clears, 1)
    }

    /// A span predating userId stamping has no owner to check against, so it is still recovered.
    func testAnUnstampedSpanIsStillRecovered() throws {
        let (recovery, buffer, _) = make(currentUserId: "u1")
        recovery.apply(.discard, to: span(userId: nil))
        XCTAssertEqual(buffer.entries.count, 1)
    }
}
