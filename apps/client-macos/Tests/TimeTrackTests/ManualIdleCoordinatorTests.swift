import XCTest
@testable import TimeTrack

final class ManualIdleCoordinatorTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func sequentialIdGen() -> (Date) -> String {
        var n = 0; return { _ in n += 1; return "id-\(n)" }
    }

    private func make(threshold: Int = 300, awayLimit: Int = 3600)
        -> (ManualIdleCoordinator, TimeTracker, BufferSpy, MutableClock,
            () -> ((AwayResolution) -> Void)?, () -> Int, () -> [Date]) {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())
        var pendingResolve: ((AwayResolution) -> Void)?
        var dismissals = 0
        var limitNotices: [Date] = []
        let coordinator = ManualIdleCoordinator(
            tracker: tracker,
            buffer: spy,
            thresholdSeconds: threshold,
            awayLimitSeconds: awayLimit,
            presentAwayPrompt: { _, resolve in pendingResolve = resolve },
            clock: clock.read,
            idGen: sequentialIdGen(),
            onAwayLimitExceeded: { limitNotices.append($0) },
            dismissPrompt: { dismissals += 1 }
        )
        return (coordinator, tracker, spy, clock, { pendingResolve }, { dismissals }, { limitNotices })
    }

    // Helper: decoded idle-events only (kind == .idleEvent).
    private func idleEvents(_ spy: BufferSpy) -> [[String: Any]] {
        spy.entries.enumerated()
            .filter { spy.entries[$0.offset].kind == .idleEvent }
            .map { spy.object(at: $0.offset) }
    }

    private func timeEntries(_ spy: BufferSpy) -> [[String: Any]] {
        spy.entries.enumerated()
            .filter { spy.entries[$0.offset].kind == .timeEntry }
            .map { spy.object(at: $0.offset) }
    }

    func testKeepLeavesEntryRunningAndEmitsKeptIdleEvent() {
        let (c, tracker, spy, clock, resolver, _, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // manual entry opens at t0
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0 (timer NOT stopped)
        XCTAssertTrue(tracker.isRunning, "manual timer keeps running while away")
        clock.advance(120); c.tick(idleSeconds: 5)            // resume at t0+420 → prompt
        resolver()?(.keep)

        XCTAssertTrue(tracker.isRunning, "keep leaves the entry running, untouched")
        let events = idleEvents(spy)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0]["resolvedAction"] as? String, "KEPT")
        XCTAssertFalse(spy.entries.contains { $0.kind == .timeEntry }, "nothing closed")
    }

    func testDiscardTrimsAtAwayStartAndStartsNewManualEntryInTheSameProject() {
        let (c, tracker, spy, clock, resolver, _, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A opens at t0
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        clock.advance(120); c.tick(idleSeconds: 5)            // resume at t0+420 → prompt
        resolver()?(.discard)

        // Entry A closed at away-start (t0..t0), a new manual entry is now running under the
        // SAME project/task — this is a split, not an abandonment.
        let entries = timeEntries(spy)
        XCTAssertEqual(entries.count, 1, "the trimmed entry A is flushed")
        XCTAssertEqual(entries[0]["source"] as? String, "MANUAL")
        XCTAssertEqual(entries[0]["endTime"] as? String, entries[0]["startTime"] as? String,
                       "entry A trimmed to away-start (start == end == t0)")
        XCTAssertEqual(entries[0]["projectId"] as? String, "p1")
        XCTAssertEqual(entries[0]["taskId"] as? String, "k1")
        XCTAssertTrue(tracker.isRunning, "a fresh manual entry continues from the return instant")
        if case let .tracking(_, _, selection, source) = tracker.state {
            XCTAssertEqual(source, .manual)
            XCTAssertEqual(selection.projectId, "p1")
            XCTAssertEqual(selection.taskId, "k1")
        } else {
            XCTFail("expected a running manual entry")
        }

        let events = idleEvents(spy)
        XCTAssertEqual(events.last?["resolvedAction"] as? String, "DISCARDED")
    }

    // The Discard branch replaces the live entry directly on TimeTracker (trim + fresh start),
    // which the menu-bar clock can't observe on its own. `onEntryReplaced` is the signal the owner
    // uses to shift the clock forward by the discarded idle gap. It MUST fire on Discard with the
    // idle-gap seconds, and MUST NOT fire on Keep/unresolved.
    private func makeWithReplaceCapture(threshold: Int = 300)
        -> (ManualIdleCoordinator, TimeTracker, MutableClock, () -> ((AwayResolution) -> Void)?, () -> [TimeInterval]) {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())
        var pendingResolve: ((AwayResolution) -> Void)?
        var replacedWith: [TimeInterval] = []
        let coordinator = ManualIdleCoordinator(
            tracker: tracker,
            buffer: spy,
            thresholdSeconds: threshold,
            presentAwayPrompt: { _, resolve in pendingResolve = resolve },
            clock: clock.read,
            idGen: sequentialIdGen(),
            onEntryReplaced: { replacedWith.append($0) },
            dismissPrompt: {}
        )
        return (coordinator, tracker, clock, { pendingResolve }, { replacedWith })
    }

    func testDiscardFiresOnEntryReplacedWithIdleGap() {
        let (c, tracker, clock, resolver, replaced) = makeWithReplaceCapture(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A at t0 (away-start)
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        clock.advance(120); c.tick(idleSeconds: 5)            // resume at t0+420 → prompt
        resolver()?(.discard)
        XCTAssertEqual(replaced(), [420],
                       "Discard fires once, carrying the idle gap (away-start t0 → resume t0+420 = 420s)")
    }

    func testKeepDoesNotFireOnEntryReplaced() {
        let (c, tracker, clock, resolver, replaced) = makeWithReplaceCapture(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)
        clock.advance(120); c.tick(idleSeconds: 5)
        resolver()?(.keep)
        XCTAssertTrue(replaced().isEmpty, "Keep leaves the entry untouched → no clock shift")
    }

    func testSignalsAreNoOpWhenNotInManualSession() {
        let (c, tracker, spy, clock, _, _, _) = make(threshold: 300)
        // tracker is idle (no manual session)
        clock.advance(300); c.tick(idleSeconds: 300)
        clock.advance(120); c.tick(idleSeconds: 5)
        XCTAssertFalse(tracker.isRunning)
        XCTAssertTrue(spy.entries.isEmpty, "no prompt, no events without a manual session")
    }

    func testAutoSessionIsIgnored() {
        let (c, tracker, spy, clock, resolver, _, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1", source: .auto)  // AUTO, not manual
        clock.advance(300); c.tick(idleSeconds: 300)
        clock.advance(120); c.tick(idleSeconds: 5)
        XCTAssertNil(resolver(), "manual coordinator does not act on an AUTO session")
        XCTAssertTrue(idleEvents(spy).isEmpty)
    }

    func testSessionEndsWhileAwayAbandonsAndLaterResumeDoesNotTrim() {
        let (c, tracker, spy, clock, resolver, dismissals, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A at t0
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        tracker.stop()                                        // user stops the manual timer mid-away
        clock.advance(60); c.tick(idleSeconds: 360)           // next signal reconciles

        let events = idleEvents(spy)
        XCTAssertEqual(events.last?["resolvedAction"] as? String, "UNRESOLVED")
        XCTAssertEqual(dismissals(), 1, "a showing prompt would be dismissed on abandon")
        XCTAssertNil(resolver(), "no keep/discard prompt is presented for the abandoned window")
    }

    func testPauseDuringAwayAbandonsNoTrim() {
        let (c, tracker, spy, clock, resolver, dismissals, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A at t0
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        tracker.pause()                                       // user pauses the manual timer mid-away
        clock.advance(60); c.tick(idleSeconds: 360)           // next signal reconciles

        let events = idleEvents(spy)
        XCTAssertEqual(events.last?["resolvedAction"] as? String, "UNRESOLVED")
        XCTAssertEqual(dismissals(), 1, "a showing prompt would be dismissed on abandon")
        XCTAssertNil(resolver(), "no keep/discard prompt is presented for the abandoned window")
    }

    func testSignalWhileSwappedEntryAwaitingReconciles() {
        let (c, tracker, spy, clock, resolver, dismissals, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A at t0
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0 (entry A)
        clock.advance(120); c.tick(idleSeconds: 5)            // resume at t0+420 → awaiting, prompt presented
        XCTAssertNotNil(resolver(), "prompt is presented before the entry swap")
        let staleResolver = resolver()

        // Before resolving, the user stops A and starts a different entry B.
        tracker.stop()
        tracker.start(projectId: "p2", taskId: nil)           // entry B
        let bEntriesBefore = spy.entries.filter { $0.kind == .timeEntry }.count

        // A fresh signal arrives while still .awaiting on entry A — must reconcile before any resolve.
        clock.advance(5); c.tick(idleSeconds: 5)

        XCTAssertTrue(tracker.isRunning, "entry B keeps running, untrimmed")
        XCTAssertEqual(spy.entries.filter { $0.kind == .timeEntry }.count, bEntriesBefore,
                       "no extra trim/close of entry B")
        XCTAssertEqual(idleEvents(spy).last?["resolvedAction"] as? String, "UNRESOLVED",
                       "entry A's abandoned away window is recorded UNRESOLVED")
        XCTAssertEqual(dismissals(), 1, "the stale prompt for entry A is dismissed on reconcile")

        // The stale resolver captured before the swap is now a harmless no-op.
        staleResolver?(.keep)
        XCTAssertEqual(idleEvents(spy).count, 1, "resolving the stale prompt after reconcile records nothing new")
    }

    func testDiscardAfterEntryChangedRecordsUnresolvedNoTrim() {
        let (c, tracker, spy, clock, resolver, _, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A at t0
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0 (entry A)
        clock.advance(120); c.tick(idleSeconds: 5)            // resume → prompt (entry A still live)
        // Before resolving, the user stops A and starts a different entry B.
        tracker.stop()
        tracker.start(projectId: "p2", taskId: nil)           // entry B
        let bEntriesBefore = spy.entries.filter { $0.kind == .timeEntry }.count
        resolver()?(.discard)

        // B must not be trimmed; the away window is UNRESOLVED.
        XCTAssertTrue(tracker.isRunning, "entry B keeps running, untrimmed")
        XCTAssertEqual(spy.entries.filter { $0.kind == .timeEntry }.count, bEntriesBefore,
                       "no extra trim/close of entry B")
        XCTAssertEqual(idleEvents(spy).last?["resolvedAction"] as? String, "UNRESOLVED")
    }

    // The monitor stays armed through a Stop, so arming has to be per ENTRY rather than merely
    // "whenever the monitor is idle". Without that, a Stop-then-Start leaves the NEW span measuring
    // idleness from when the OLD one armed: someone who stepped away for four minutes, came back,
    // stopped and started a different project would watch that fresh entry close itself on the very
    // next tick.
    func testPerEntryArmingHoldsAfterStopStartOfADifferentProject() {
        let (c, tracker, spy, clock, resolver, _, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")
        c.tick(idleSeconds: 0)                          // arms at t0

        clock.advance(240)                              // away for four minutes
        tracker.stop()
        tracker.start(projectId: "p2", taskId: nil)     // they stop and start something else

        clock.advance(60); c.tick(idleSeconds: 300)     // 5 min idle overall, 1 min for THIS span
        XCTAssertTrue(tracker.isRunning, "a new span measures its own inactivity, not the old one's")
        XCTAssertNil(resolver(), "no away cycle for a fresh, un-idle span")
        XCTAssertEqual(timeEntries(spy).count, 1, "only the span the user stopped is closed")
    }

    // MARK: - The 60-minute away limit

    // Still away, no return: the entry is stopped AT away-start (none of the away time counts),
    // the window is DISCARDED, there is no prompt, and the notice fires.
    func testLimitExceededWhileStillAwayStopsAtAwayStartWithNoPrompt() {
        let (c, tracker, spy, clock, resolver, _, notices) = make(threshold: 300, awayLimit: 3600)
        tracker.start(projectId: "p1", taskId: "k1")          // entry opens at t0
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        clock.advance(3300); c.tick(idleSeconds: 3600)        // still idle, now t0+3600 (limit reached)

        XCTAssertFalse(tracker.isRunning, "the away-limit stops the manual entry")
        XCTAssertNil(resolver(), "no keep/discard prompt for a limit-exceeded window")
        let entries = timeEntries(spy)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["endTime"] as? String, entries[0]["startTime"] as? String,
                       "stopped AT away-start — none of the away time counts")
        let events = idleEvents(spy)
        XCTAssertEqual(events.last?["resolvedAction"] as? String, "DISCARDED")
        XCTAssertEqual(notices(), [t0], "the notice carries the instant the entry actually stopped at")
    }

    // Sleep can outlast the limit entirely with no tick in between; the wake signal is where this
    // is discovered, and it must resolve via the limit, not the prompt.
    func testLimitExceededAcrossASleepResolvesOnWakeWithNoPrompt() {
        let (c, tracker, spy, clock, resolver, _, notices) = make(threshold: 300, awayLimit: 3600)
        tracker.start(projectId: "p1", taskId: "k1")          // entry opens at t0
        c.tick(idleSeconds: 0)                                 // arm
        clock.advance(60); c.markAway()                        // sleeps at t0+60
        clock.advance(7200)                                    // asleep for 2 hours, no ticks fire
        c.resume()                                             // wake

        XCTAssertFalse(tracker.isRunning)
        XCTAssertNil(resolver(), "no prompt — the sleep already outlasted the limit")
        let events = idleEvents(spy)
        XCTAssertEqual(events.last?["resolvedAction"] as? String, "DISCARDED")
        XCTAssertEqual(notices(), [t0.addingTimeInterval(60)])
    }

    // Returning at 61 minutes takes the limit path even though the person DID come back — the
    // limit is measured from away-start, not from whether anyone ever answers.
    func testReturnPast61MinutesTakesTheLimitPathNotThePrompt() {
        let (c, tracker, _, clock, resolver, _, notices) = make(threshold: 300, awayLimit: 3600)
        tracker.start(projectId: "p1", taskId: "k1")
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        clock.advance(3360); c.tick(idleSeconds: 5)           // resume at t0 + 61min

        XCTAssertFalse(tracker.isRunning)
        XCTAssertNil(resolver())
        XCTAssertEqual(notices(), [t0])
    }

    // Returning at 59 minutes is still an ordinary prompt — the limit only bites past 60.
    func testReturnAt59MinutesStillPromptsInsteadOfExceedingTheLimit() {
        let (c, tracker, _, clock, resolver, _, notices) = make(threshold: 300, awayLimit: 3600)
        tracker.start(projectId: "p1", taskId: "k1")
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        clock.advance(3240); c.tick(idleSeconds: 5)           // resume at t0 + 59min

        XCTAssertTrue(tracker.isRunning, "still within the limit — nothing has stopped")
        XCTAssertNotNil(resolver(), "the ordinary keep/discard prompt is presented")
        XCTAssertTrue(notices().isEmpty)
    }

    // MARK: - Sign-out while awaiting

    func testSignOutWhileAwaitingDismissesThePromptAndRecordsUnresolved() {
        let (c, tracker, spy, clock, resolver, dismissals, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")
        c.tick(idleSeconds: 0)                                 // arms at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        clock.advance(120); c.tick(idleSeconds: 5)            // resume → awaiting, prompt presented
        XCTAssertNotNil(resolver())

        c.deactivate()                                        // sign-out / teardown
        XCTAssertEqual(idleEvents(spy).last?["resolvedAction"] as? String, "UNRESOLVED")
        XCTAssertEqual(dismissals(), 0,
                       "deactivate() itself does not dismiss — the caller does that separately, after")

        // The caller (AppDelegate) dismisses the prompt AFTER deactivate — the stale resolver is
        // now a harmless no-op on the disarmed monitor, so a second "answer" records nothing new.
        let stale = resolver()
        stale?(.keep)
        XCTAssertEqual(idleEvents(spy).count, 1, "the disarmed monitor's resolve is a no-op")
    }
}
