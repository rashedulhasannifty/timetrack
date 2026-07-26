# Manual-timer idle keep/discard prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a running **manual** timer the same idle keep/discard prompt auto tracking has — keep the timer running while away, and on return let the user keep the idle stretch or discard it (trim to away-start and continue a fresh entry).

**Architecture:** A dedicated `ManualIdleMonitor` (pure state machine) + `ManualIdleCoordinator` (effects + guards), independent of the auto path. One `WorkspaceObserver` feeds both coordinators via a `FanOutSignalReceiver` in auto mode, and feeds the manual coordinator alone in manual mode. Mutual exclusion is by session-type guard, not an internal router. Server IdleEvents are audit-only (verified) so no API change.

**Tech Stack:** Swift 5, SwiftPM, XCTest. Package at `apps/client-macos` (module `TimeTrack`, `@testable`-imported by target `TimeTrackTests`).

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-26-manual-timer-idle-prompt-design.md` — the source of truth for behavior.
- **Monitoring invariants (CLAUDE.md §1):** the away prompt is always a visible window; no stealth. Only the content-free idle **scalar** is read (never key/pointer content). Manual entries are the user's own action — never auto-stopped mid-away.
- **No new dependency, no API/contract change, no new user setting.** Threshold reuses the policy-configured `idleThresholdMinutes` already passed into the install methods.
- **Auto path is not modified in behavior.** `IdleMonitor`, `AutoTrackingCoordinator`, and their tests stay green; the only edit to `AutoTrackingCoordinator` is a behavior-preserving extraction of the idle-event enqueue helper (Task 2).
- **Git identity (CLAUDE.md §0):** no AI attribution anywhere. Conventional Commits, scope `client`.
- **Test command** (Swift client tests are not in CI — run locally; XCTest needs full Xcode, not CommandLineTools):
  ```bash
  cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter <TestClass>
  ```
  In `@testable` client tests, the bare name `Category` collides with the ObjC runtime type — qualify as `TimeTrack.Category` if needed (not needed by this feature). Do **not** eagerly construct `UNUserNotificationCenter.current()` in test-reachable code.

---

## File structure

- Create `apps/client-macos/Sources/TimeTrack/Tracking/FanOutSignalReceiver.swift` — fan-out of `AutoTrackingSignalReceiver` to N receivers.
- Create `apps/client-macos/Sources/TimeTrack/Tracking/IdleEventEnqueuer.swift` — shared `IdleEventPayload` build+encode+enqueue helper.
- Modify `apps/client-macos/Sources/TimeTrack/App/AutoTrackingCoordinator.swift` — call the shared helper (behavior-preserving).
- Create `apps/client-macos/Sources/TimeTrack/Tracking/ManualIdleMonitor.swift` — pure manual idle state machine + delegate.
- Create `apps/client-macos/Sources/TimeTrack/App/ManualIdleCoordinator.swift` — manual effects, guards, session-end reconciliation.
- Modify `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift` — wire the manual coordinator in both modes; extend teardown.
- Create tests: `FanOutSignalReceiverTests.swift`, `ManualIdleMonitorTests.swift`, `ManualIdleCoordinatorTests.swift`, and a support fake `Support/FakeManualIdleMonitorDelegate.swift`.

---

## Task 1: `FanOutSignalReceiver`

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/Tracking/FanOutSignalReceiver.swift`
- Test: `apps/client-macos/Tests/TimeTrackTests/FanOutSignalReceiverTests.swift`

**Interfaces:**

- Consumes: `AutoTrackingSignalReceiver` (declared in `WorkspaceObserver.swift`: `tick(idleSeconds:)`, `markAway()`, `resume()`).
- Produces: `final class FanOutSignalReceiver: AutoTrackingSignalReceiver` with `init(_ receivers: [AutoTrackingSignalReceiver])`.

- [ ] **Step 1: Write the failing test**

```swift
// FanOutSignalReceiverTests.swift
import XCTest
@testable import TimeTrack

final class FanOutSignalReceiverTests: XCTestCase {
    private final class Spy: AutoTrackingSignalReceiver {
        var log: [String] = []
        func tick(idleSeconds: Int) { log.append("tick(\(idleSeconds))") }
        func markAway() { log.append("markAway") }
        func resume() { log.append("resume") }
    }

    func testForwardsEverySignalToEveryReceiverInOrder() {
        let a = Spy(); let b = Spy()
        let fan = FanOutSignalReceiver([a, b])
        fan.tick(idleSeconds: 42)
        fan.markAway()
        fan.resume()
        XCTAssertEqual(a.log, ["tick(42)", "markAway", "resume"])
        XCTAssertEqual(b.log, ["tick(42)", "markAway", "resume"])
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter FanOutSignalReceiverTests`
Expected: FAIL — `cannot find 'FanOutSignalReceiver' in scope`.

- [ ] **Step 3: Write minimal implementation**

```swift
// FanOutSignalReceiver.swift
import Foundation

/// Fans one `WorkspaceObserver` out to several receivers (auto + manual coordinators share the
/// single system-edge timer). Forwards each signal to every receiver, in order. Holds its
/// receivers strongly; the `WorkspaceObserver` holds the fan-out weakly, so the owner
/// (`AppDelegate`) must retain the fan-out.
final class FanOutSignalReceiver: AutoTrackingSignalReceiver {
    private let receivers: [AutoTrackingSignalReceiver]
    init(_ receivers: [AutoTrackingSignalReceiver]) { self.receivers = receivers }
    func tick(idleSeconds: Int) { receivers.forEach { $0.tick(idleSeconds: idleSeconds) } }
    func markAway() { receivers.forEach { $0.markAway() } }
    func resume() { receivers.forEach { $0.resume() } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter FanOutSignalReceiverTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Tracking/FanOutSignalReceiver.swift apps/client-macos/Tests/TimeTrackTests/FanOutSignalReceiverTests.swift
git commit -m "feat(client): fan-out signal receiver for shared workspace observer"
```

---

## Task 2: Extract shared `IdleEventEnqueuer`

Both coordinators enqueue the same `IdleEventPayload`. Extract the helper so the manual coordinator (Task 4) reuses it instead of duplicating; refactor `AutoTrackingCoordinator` onto it with no behavior change (its existing tests are the safety net).

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/Tracking/IdleEventEnqueuer.swift`
- Modify: `apps/client-macos/Sources/TimeTrack/App/AutoTrackingCoordinator.swift:101-119` (the `enqueueIdleEvent` helper + the private static `iso` formatter)

**Interfaces:**

- Consumes: `TimeEntryBuffering.enqueue(id:kind:payload:)`, `BufferKind.idleEvent`, `IdleEventPayload(id:startTime:endTime:resolvedAction:)`, `ResolvedAction`.
- Produces: `enum IdleEventEnqueuer { static func enqueue(into: TimeEntryBuffering, id: String, from: Date, to: Date, action: ResolvedAction) }`.

- [ ] **Step 1: Verify existing auto tests are green (baseline)**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter AutoTrackingCoordinatorTests`
Expected: PASS (this is the regression net for the refactor).

- [ ] **Step 2: Create the shared helper**

```swift
// IdleEventEnqueuer.swift
import Foundation

/// Builds, encodes, and buffers one `IdleEventPayload`. Shared by the auto and manual idle
/// coordinators so the ISO formatting + buffer-kind live in exactly one place. `id` is the
/// caller's client-minted UUIDv7 (idempotency key), typically `idGen(from)`.
enum IdleEventEnqueuer {
    static func enqueue(into buffer: TimeEntryBuffering, id: String,
                        from: Date, to: Date, action: ResolvedAction) {
        let event = IdleEventPayload(
            id: id,
            startTime: iso.string(from: from),
            endTime: iso.string(from: to),
            resolvedAction: action
        )
        if let data = try? JSONEncoder().encode(event) {
            buffer.enqueue(id: id, kind: .idleEvent, payload: data)
        }
    }

    /// Matches `TimeTracker`'s ISO config (`[.withInternetDateTime]`).
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
```

- [ ] **Step 3: Point `AutoTrackingCoordinator` at the helper (behavior-preserving)**

Replace the body of the private `enqueueIdleEvent` (currently `AutoTrackingCoordinator.swift:101-112`) so it delegates, and delete the now-unused private static `iso` formatter (currently lines 114-119):

```swift
    private func enqueueIdleEvent(from: Date, to: Date, action: ResolvedAction) {
        IdleEventEnqueuer.enqueue(into: buffer, id: idGen(from), from: from, to: to, action: action)
    }
    // (the private static `iso` formatter is deleted — moved into IdleEventEnqueuer)
```

- [ ] **Step 4: Run the auto tests to verify no behavior change**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter AutoTrackingCoordinatorTests`
Expected: PASS — identical enqueued payloads (same `id`, same ISO strings, same `kind`).

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Tracking/IdleEventEnqueuer.swift apps/client-macos/Sources/TimeTrack/App/AutoTrackingCoordinator.swift
git commit -m "refactor(client): extract shared IdleEventEnqueuer"
```

---

## Task 3: `ManualIdleMonitor` (pure state machine)

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/Tracking/ManualIdleMonitor.swift`
- Create: `apps/client-macos/Tests/TimeTrackTests/Support/FakeManualIdleMonitorDelegate.swift`
- Test: `apps/client-macos/Tests/TimeTrackTests/ManualIdleMonitorTests.swift`

**Interfaces:**

- Consumes: `AwayResolution` (global enum `{ case keep, discard }` in `IdleMonitor.swift`).
- Produces:
  - `protocol ManualIdleMonitorDelegate: AnyObject` with:
    - `manualIdleMonitor(_:didBeginAwayAt:)`
    - `manualIdleMonitor(_:didBecomeAwayForSeconds:)`
    - `manualIdleMonitor(_:didResolveAwayFrom:to:keeping:)`
    - `manualIdleMonitor(_:didAbandonAwayFrom:to:)`
  - `final class ManualIdleMonitor` with `init(thresholdSeconds:clock:)`, `State { inactive, active, away(since:), awaiting(since:until:) }`, `activate()`, `deactivate()`, `tick(idleSeconds:)`, `markAway()`, `resume()`, `resolve(_:)`, `weak var delegate`, `private(set) var state`.

- [ ] **Step 1: Write the support fake**

```swift
// Support/FakeManualIdleMonitorDelegate.swift
import Foundation
@testable import TimeTrack

final class FakeManualIdleMonitorDelegate: ManualIdleMonitorDelegate {
    enum Call: Equatable {
        case beganAway(at: Date)
        case becameAway(seconds: Int)
        case resolved(from: Date, to: Date, keeping: Bool)
        case abandoned(from: Date, to: Date)
    }
    private(set) var calls: [Call] = []

    func manualIdleMonitor(_ m: ManualIdleMonitor, didBeginAwayAt awayStart: Date) {
        calls.append(.beganAway(at: awayStart))
    }
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBecomeAwayForSeconds seconds: Int) {
        calls.append(.becameAway(seconds: seconds))
    }
    func manualIdleMonitor(_ m: ManualIdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool) {
        calls.append(.resolved(from: awayStart, to: resume, keeping: keeping))
    }
    func manualIdleMonitor(_ m: ManualIdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date) {
        calls.append(.abandoned(from: awayStart, to: lastKnown))
    }
}
```

- [ ] **Step 2: Write the failing tests**

```swift
// ManualIdleMonitorTests.swift
import XCTest
@testable import TimeTrack

final class ManualIdleMonitorTests: XCTestCase {
    private final class MutableClock {
        private(set) var now: Date
        init(_ s: Date) { now = s }
        func advance(_ s: TimeInterval) { now = now.addingTimeInterval(s) }
        func read() -> Date { now }
    }
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    private func make(threshold: Int = 300)
        -> (ManualIdleMonitor, FakeManualIdleMonitorDelegate, MutableClock) {
        let clock = MutableClock(t0)
        let monitor = ManualIdleMonitor(thresholdSeconds: threshold, clock: clock.read)
        let delegate = FakeManualIdleMonitorDelegate()
        monitor.delegate = delegate
        return (monitor, delegate, clock)
    }

    func testActivateDoesNotStartTracking() {
        let (monitor, delegate, _) = make()
        monitor.activate()
        XCTAssertEqual(monitor.state, .active)
        XCTAssertTrue(delegate.calls.isEmpty, "manual activate has no start-tracking side effect")
    }

    func testThresholdCrossingBeginsAwayWithoutStopping() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(305); monitor.tick(idleSeconds: 305)   // awayStart = (t0+305) - 305 = t0
        XCTAssertEqual(monitor.state, .away(since: t0))
        XCTAssertEqual(delegate.calls, [.beganAway(at: t0)], "no stop decision, only beganAway")
    }

    func testSubThresholdTickStaysActive() {
        let (monitor, delegate, _) = make(threshold: 300)
        monitor.activate()
        monitor.tick(idleSeconds: 120)
        XCTAssertEqual(monitor.state, .active)
        XCTAssertTrue(delegate.calls.isEmpty)
    }

    func testResumePromptsWithAwaySeconds() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)   // away since t0
        clock.advance(120); monitor.tick(idleSeconds: 5)     // resume at t0+420
        XCTAssertEqual(monitor.state, .awaiting(since: t0, until: t0.addingTimeInterval(420)))
        XCTAssertEqual(delegate.calls.last, .becameAway(seconds: 420))
    }

    func testResolveKeepReturnsActiveWithoutRestart() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        clock.advance(120); monitor.tick(idleSeconds: 5)
        monitor.resolve(.keep)
        XCTAssertEqual(monitor.state, .active)
        XCTAssertEqual(delegate.calls.last, .resolved(from: t0, to: t0.addingTimeInterval(420), keeping: true))
    }

    func testResolveDiscardCarriesKeepingFalse() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)
        clock.advance(120); monitor.tick(idleSeconds: 5)
        monitor.resolve(.discard)
        XCTAssertEqual(monitor.state, .active)
        XCTAssertEqual(delegate.calls.last, .resolved(from: t0, to: t0.addingTimeInterval(420), keeping: false))
    }

    func testMarkAwayMirrorsThresholdPath() {
        let (monitor, delegate, _) = make()
        monitor.activate()
        monitor.markAway()                                    // awayStart = now = t0
        XCTAssertEqual(monitor.state, .away(since: t0))
        XCTAssertEqual(delegate.calls, [.beganAway(at: t0)])
    }

    func testDeactivateWhileAwayAbandons() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)    // away since t0
        clock.advance(60)                                     // now t0+360
        monitor.deactivate()
        XCTAssertEqual(monitor.state, .inactive)
        XCTAssertEqual(delegate.calls.last, .abandoned(from: t0, to: t0.addingTimeInterval(360)))
    }

    func testDeactivateWhileAwaitingAbandonsToResumeInstant() {
        let (monitor, delegate, clock) = make(threshold: 300)
        monitor.activate()
        clock.advance(300); monitor.tick(idleSeconds: 300)    // away since t0
        clock.advance(120); monitor.tick(idleSeconds: 5)      // awaiting, resume at t0+420
        monitor.deactivate()
        XCTAssertEqual(monitor.state, .inactive)
        XCTAssertEqual(delegate.calls.last, .abandoned(from: t0, to: t0.addingTimeInterval(420)))
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter ManualIdleMonitorTests`
Expected: FAIL — `cannot find 'ManualIdleMonitor' in scope`.

- [ ] **Step 4: Write the implementation**

```swift
// ManualIdleMonitor.swift
import Foundation

/// The manual-session counterpart of `IdleMonitor`. Same state shape, but manual semantics:
/// going away does NOT stop the timer (a manual entry is the user's own action — CLAUDE.md §1),
/// and resolving does NOT auto-open a new span — the `ManualIdleCoordinator` performs the
/// keep/discard effects. `clock` is injected for deterministic tests. UI/network/capture-free.
protocol ManualIdleMonitorDelegate: AnyObject {
    /// Idle threshold crossed (or sleep/lock). The timer keeps running; the coordinator snapshots
    /// which entry the away window belongs to.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBeginAwayAt awayStart: Date)
    /// Input resumed after being away — present the keep/discard prompt. The delegate must
    /// eventually call `resolve(_:)`.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBecomeAwayForSeconds seconds: Int)
    /// The away window `[awayStart, resume]` was resolved. `keeping` → count it; else discard.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool)
    /// Torn down while still away/awaiting — record UNRESOLVED, no trim.
    func manualIdleMonitor(_ m: ManualIdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date)
}

final class ManualIdleMonitor {
    enum State: Equatable {
        case inactive
        case active
        case away(since: Date)
        case awaiting(since: Date, until: Date)
    }

    weak var delegate: ManualIdleMonitorDelegate?
    private(set) var state: State = .inactive
    private let thresholdSeconds: Int
    private let clock: () -> Date

    init(thresholdSeconds: Int, clock: @escaping () -> Date = Date.init) {
        self.thresholdSeconds = thresholdSeconds
        self.clock = clock
    }

    /// Arm the monitor. Unlike `IdleMonitor.activate`, there is no start-tracking side effect —
    /// the manual timer is started by the user, not by this monitor.
    func activate() { state = .active }

    /// Tear down; if still away/awaiting, record UNRESOLVED.
    func deactivate() {
        switch state {
        case .away(let since):
            delegate?.manualIdleMonitor(self, didAbandonAwayFrom: since, to: clock())
        case .awaiting(let since, let until):
            delegate?.manualIdleMonitor(self, didAbandonAwayFrom: since, to: until)
        case .inactive, .active:
            break
        }
        state = .inactive
    }

    /// Periodic idle sample. active→away at threshold (NO stop); away→awaiting when input resumes.
    func tick(idleSeconds: Int) {
        switch state {
        case .active where idleSeconds >= thresholdSeconds:
            let awayStart = clock().addingTimeInterval(-Double(idleSeconds))
            state = .away(since: awayStart)
            delegate?.manualIdleMonitor(self, didBeginAwayAt: awayStart)
        case .away(let since) where idleSeconds < thresholdSeconds:
            transitionToAwaiting(since: since)
        default:
            break
        }
    }

    /// System sleep / screen lock: away now (don't wait for threshold). Still no stop.
    func markAway() {
        guard case .active = state else { return }
        let awayStart = clock()
        state = .away(since: awayStart)
        delegate?.manualIdleMonitor(self, didBeginAwayAt: awayStart)
    }

    /// Explicit resume (wake/unlock); the tick path also transitions away→awaiting on its own.
    func resume() {
        guard case .away(let since) = state else { return }
        transitionToAwaiting(since: since)
    }

    private func transitionToAwaiting(since: Date) {
        let resumeAt = clock()
        state = .awaiting(since: since, until: resumeAt)
        delegate?.manualIdleMonitor(self, didBecomeAwayForSeconds: Int(resumeAt.timeIntervalSince(since)))
    }

    /// The user's keep/discard choice. Returns to `.active` (re-armed) WITHOUT opening a span —
    /// the coordinator applies the effect.
    func resolve(_ action: AwayResolution) {
        guard case let .awaiting(since, until) = state else { return }
        delegate?.manualIdleMonitor(self, didResolveAwayFrom: since, to: until, keeping: action == .keep)
        state = .active
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter ManualIdleMonitorTests`
Expected: PASS (all 9 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Tracking/ManualIdleMonitor.swift apps/client-macos/Tests/TimeTrackTests/ManualIdleMonitorTests.swift apps/client-macos/Tests/TimeTrackTests/Support/FakeManualIdleMonitorDelegate.swift
git commit -m "feat(client): manual idle state machine (no stop-on-away)"
```

---

## Task 4: `ManualIdleCoordinator` (effects, guards, reconciliation)

**Files:**

- Create: `apps/client-macos/Sources/TimeTrack/App/ManualIdleCoordinator.swift`
- Test: `apps/client-macos/Tests/TimeTrackTests/ManualIdleCoordinatorTests.swift`

**Interfaces:**

- Consumes: `ManualIdleMonitor` + `ManualIdleMonitorDelegate` (Task 3); `AutoTrackingSignalReceiver` (`WorkspaceObserver.swift`); `TimeTracker` (`.state`, `.State.tracking(entryId:startedAt:selection:source:)`, `.Source.manual`, `.stop(at:)`, `.start(projectId:taskId:source:)`, `.Selection`); `TimeEntryBuffering`; `IdleEventEnqueuer` (Task 2); `AwayResolution`; `UUIDv7.generate(now:)`.
- Produces: `final class ManualIdleCoordinator: ManualIdleMonitorDelegate, AutoTrackingSignalReceiver` with
  `init(tracker:buffer:thresholdSeconds:presentAwayPrompt:clock:idGen:dismissPrompt:)` and `func deactivate()`.
  - `presentAwayPrompt: (_ minutes: Int, _ resolve: @escaping (AwayResolution) -> Void) -> Void`
  - `dismissPrompt: () -> Void` (defaults to `AwayResolutionWindowController.dismissIfShowing()`; injected so tests avoid AppKit).

- [ ] **Step 1: Write the failing tests**

```swift
// ManualIdleCoordinatorTests.swift
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

    private func make(threshold: Int = 300)
        -> (ManualIdleCoordinator, TimeTracker, BufferSpy, MutableClock, () -> ((AwayResolution) -> Void)?, () -> Int) {
        let clock = MutableClock(t0)
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: clock.read, idGen: sequentialIdGen())
        var pendingResolve: ((AwayResolution) -> Void)?
        var dismissals = 0
        let coordinator = ManualIdleCoordinator(
            tracker: tracker,
            buffer: spy,
            thresholdSeconds: threshold,
            presentAwayPrompt: { _, resolve in pendingResolve = resolve },
            clock: clock.read,
            idGen: sequentialIdGen(),
            dismissPrompt: { dismissals += 1 }
        )
        return (coordinator, tracker, spy, clock, { pendingResolve }, { dismissals })
    }

    // Helper: decoded idle-events only (kind == .idleEvent).
    private func idleEvents(_ spy: BufferSpy) -> [[String: Any]] {
        spy.entries.enumerated()
            .filter { spy.entries[$0.offset].kind == .idleEvent }
            .map { spy.object(at: $0.offset) }
    }

    func testKeepLeavesEntryRunningAndEmitsKeptIdleEvent() {
        let (c, tracker, spy, clock, resolver, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // manual entry opens at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0 (timer NOT stopped)
        XCTAssertTrue(tracker.isRunning, "manual timer keeps running while away")
        clock.advance(120); c.tick(idleSeconds: 5)            // resume at t0+420 → prompt
        resolver()?(.keep)

        XCTAssertTrue(tracker.isRunning, "keep leaves the entry running, untouched")
        let events = idleEvents(spy)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0]["resolvedAction"] as? String, "KEPT")
        // No time-entry was enqueued (nothing closed).
        XCTAssertFalse(spy.entries.contains { $0.kind == .timeEntry })
    }

    func testDiscardTrimsAtAwayStartAndStartsNewManualEntry() {
        let (c, tracker, spy, clock, resolver, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A opens at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        clock.advance(120); c.tick(idleSeconds: 5)            // resume at t0+420 → prompt
        resolver()?(.discard)

        // Entry A closed at away-start (t0..t0), a new manual entry is now running.
        let timeEntries = spy.entries.enumerated().filter { $0.element.kind == .timeEntry }.map { spy.object(at: $0.offset) }
        XCTAssertEqual(timeEntries.count, 1, "the trimmed entry A is flushed")
        XCTAssertEqual(timeEntries[0]["source"] as? String, "MANUAL")
        XCTAssertEqual(timeEntries[0]["endTime"] as? String, timeEntries[0]["startTime"] as? String,
                       "entry A trimmed to away-start (start == end == t0)")
        XCTAssertEqual(timeEntries[0]["projectId"] as? String, "p1")
        XCTAssertTrue(tracker.isRunning, "a fresh manual entry continues from the return instant")

        let events = idleEvents(spy)
        XCTAssertEqual(events.last?["resolvedAction"] as? String, "DISCARDED")
    }

    func testSignalsAreNoOpWhenNotInManualSession() {
        let (c, tracker, spy, clock, _, _) = make(threshold: 300)
        // tracker is idle (no manual session)
        clock.advance(300); c.tick(idleSeconds: 300)
        clock.advance(120); c.tick(idleSeconds: 5)
        XCTAssertFalse(tracker.isRunning)
        XCTAssertTrue(spy.entries.isEmpty, "no prompt, no events without a manual session")
    }

    func testAutoSessionIsIgnored() {
        let (c, tracker, spy, clock, resolver, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1", source: .auto)  // AUTO, not manual
        clock.advance(300); c.tick(idleSeconds: 300)
        clock.advance(120); c.tick(idleSeconds: 5)
        XCTAssertNil(resolver(), "manual coordinator does not act on an AUTO session")
        XCTAssertTrue(idleEvents(spy).isEmpty)
    }

    func testSessionEndsWhileAwayAbandonsAndLaterResumeDoesNotTrim() {
        let (c, tracker, spy, clock, resolver, dismissals) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A at t0
        clock.advance(300); c.tick(idleSeconds: 300)          // away since t0
        tracker.stop()                                        // user stops the manual timer mid-away
        clock.advance(60); c.tick(idleSeconds: 360)           // next signal reconciles

        let events = idleEvents(spy)
        XCTAssertEqual(events.last?["resolvedAction"] as? String, "UNRESOLVED")
        XCTAssertEqual(dismissals(), 1, "a showing prompt would be dismissed on abandon")
        XCTAssertNil(resolver(), "no keep/discard prompt is presented for the abandoned window")
    }

    func testDiscardAfterEntryChangedRecordsUnresolvedNoTrim() {
        let (c, tracker, spy, clock, resolver, _) = make(threshold: 300)
        tracker.start(projectId: "p1", taskId: "k1")          // entry A at t0
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
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter ManualIdleCoordinatorTests`
Expected: FAIL — `cannot find 'ManualIdleCoordinator' in scope`.

- [ ] **Step 3: Write the implementation**

```swift
// ManualIdleCoordinator.swift
import Foundation

/// The manual-session sibling of `AutoTrackingCoordinator`. Fed the same `WorkspaceObserver`
/// signals (via `FanOutSignalReceiver` in auto mode, or alone in manual mode), it drives a
/// `ManualIdleMonitor` and applies the keep/discard effects — but ONLY while a `.manual` session
/// is live. It never stops a running manual timer on its own (CLAUDE.md §1); the only stop it
/// performs is the user-chosen Discard trim. All callbacks arrive on the main thread.
final class ManualIdleCoordinator: ManualIdleMonitorDelegate, AutoTrackingSignalReceiver {
    private let tracker: TimeTracker
    private let buffer: TimeEntryBuffering
    private let monitor: ManualIdleMonitor
    private let presentAwayPrompt: (_ minutes: Int, _ resolve: @escaping (AwayResolution) -> Void) -> Void
    private let idGen: (Date) -> String
    private let dismissPrompt: () -> Void

    /// The entry the current away window belongs to. Guards Discard/reconciliation against a
    /// session that ended or was replaced while away.
    private var awayEntryId: String?

    init(
        tracker: TimeTracker,
        buffer: TimeEntryBuffering,
        thresholdSeconds: Int,
        presentAwayPrompt: @escaping (_ minutes: Int, _ resolve: @escaping (AwayResolution) -> Void) -> Void,
        clock: @escaping () -> Date = Date.init,
        idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) },
        dismissPrompt: @escaping () -> Void = { AwayResolutionWindowController.dismissIfShowing() }
    ) {
        self.tracker = tracker
        self.buffer = buffer
        self.monitor = ManualIdleMonitor(thresholdSeconds: thresholdSeconds, clock: clock)
        self.presentAwayPrompt = presentAwayPrompt
        self.idGen = idGen
        self.dismissPrompt = dismissPrompt
        self.monitor.delegate = self
    }

    /// Sign-out / teardown: record any pending away as UNRESOLVED (no trim). The caller dismisses
    /// the prompt AFTER this, so its resolve is a no-op on the now-inactive monitor.
    func deactivate() { monitor.deactivate() }

    // MARK: AutoTrackingSignalReceiver (from WorkspaceObserver)

    func tick(idleSeconds: Int) { reconcileThenRoute { self.monitor.tick(idleSeconds: idleSeconds) } }
    func markAway() { reconcileThenRoute { self.monitor.markAway() } }
    func resume() { reconcileThenRoute { self.monitor.resume() } }

    /// Guard + reconcile, then forward to the monitor only while a `.manual` session is live and
    /// armed. Arms the monitor lazily on the first manual signal.
    private func reconcileThenRoute(_ forward: () -> Void) {
        reconcileSessionEnd()
        guard isManualSessionLive else { return }
        if monitor.state == .inactive { monitor.activate() }
        forward()
    }

    /// If the monitor is mid-cycle (away/awaiting) but the away entry is no longer the live manual
    /// entry (user hit Stop/Pause, or stopped-then-started a different entry), abandon the window:
    /// records UNRESOLVED and dismisses any showing prompt. This is the crux integrity guard —
    /// same mis-attribution class as the sign-out prompt leak.
    private func reconcileSessionEnd() {
        switch monitor.state {
        case .away, .awaiting:
            if !isSameManualEntryLive {
                monitor.deactivate()          // → didAbandonAwayFrom → UNRESOLVED
                dismissPrompt()
            }
        case .inactive, .active:
            break
        }
    }

    private var isManualSessionLive: Bool {
        if case .tracking(_, _, _, .manual) = tracker.state { return true }
        return false
    }

    private var isSameManualEntryLive: Bool {
        guard let awayEntryId, case let .tracking(id, _, _, .manual) = tracker.state else { return false }
        return id == awayEntryId
    }

    // MARK: ManualIdleMonitorDelegate

    func manualIdleMonitor(_ m: ManualIdleMonitor, didBeginAwayAt awayStart: Date) {
        if case let .tracking(id, _, _, .manual) = tracker.state { awayEntryId = id }
    }

    func manualIdleMonitor(_ m: ManualIdleMonitor, didBecomeAwayForSeconds seconds: Int) {
        let minutes = max(1, Int((Double(seconds) / 60.0).rounded()))
        presentAwayPrompt(minutes) { [weak m] action in m?.resolve(action) }
    }

    func manualIdleMonitor(_ m: ManualIdleMonitor, didResolveAwayFrom awayStart: Date, to resume: Date, keeping: Bool) {
        defer { awayEntryId = nil }
        if keeping {
            enqueueIdle(from: awayStart, to: resume, action: .kept)
            return
        }
        // Discard: trim ONLY if the same manual entry is still running.
        if case let .tracking(id, _, selection, .manual) = tracker.state, id == awayEntryId {
            tracker.stop(at: awayStart)
            tracker.start(projectId: selection.projectId, taskId: selection.taskId, source: .manual)
            enqueueIdle(from: awayStart, to: resume, action: .discarded)
        } else {
            enqueueIdle(from: awayStart, to: resume, action: .unresolved)
        }
    }

    func manualIdleMonitor(_ m: ManualIdleMonitor, didAbandonAwayFrom awayStart: Date, to lastKnown: Date) {
        enqueueIdle(from: awayStart, to: lastKnown, action: .unresolved)
        awayEntryId = nil
    }

    private func enqueueIdle(from: Date, to: Date, action: ResolvedAction) {
        IdleEventEnqueuer.enqueue(into: buffer, id: idGen(from), from: from, to: to, action: action)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter ManualIdleCoordinatorTests`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Run the full monitor+coordinator suite (no regressions)**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter "IdleMonitorTests|AutoTrackingCoordinatorTests|ManualIdleMonitorTests|ManualIdleCoordinatorTests|FanOutSignalReceiverTests"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/App/ManualIdleCoordinator.swift apps/client-macos/Tests/TimeTrackTests/ManualIdleCoordinatorTests.swift
git commit -m "feat(client): manual idle coordinator with keep/discard + session-end guard"
```

---

## Task 5: Wire the manual coordinator into `AppDelegate` (both modes) + teardown

Wires the new coordinator so it actually runs: fed by the existing `WorkspaceObserver` in auto mode (via fan-out) and by a dedicated observer in manual mode, and torn down on sign-out alongside the away prompt.

**Files:**

- Modify: `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift`
  - fields near `autoCoordinator`/`workspaceObserver` (`:46-47`)
  - `installAutoTracking(thresholdMinutes:)` (`:494-517`)
  - `installManualNudges(thresholdMinutes:)` (`:328-339`)
  - `stopAutoTracking()` (`:519-...`, the sign-out teardown)

**Interfaces:**

- Consumes: `ManualIdleCoordinator` (Task 4), `FanOutSignalReceiver` (Task 1), `WorkspaceObserver`, `AwayResolutionWindowController.present`.
- Produces: no new public surface — internal wiring only.

> This task has no unit test of its own for the wiring (AppDelegate assembles AppKit singletons and is not unit-tested in this package). The behavior it enables is already covered by `ManualIdleCoordinatorTests`. The one testable teardown guarantee is asserted by extending an existing sign-out test if present; if there is no AppDelegate-level test harness, verify manually per Step 6 and rely on the coordinator's `deactivate()` unit coverage.

- [ ] **Step 1: Add fields for the manual coordinator + fan-out**

Near `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift:46-47` (`autoCoordinator`, `workspaceObserver`), add:

```swift
    private var manualIdleCoordinator: ManualIdleCoordinator?
    private var signalFanOut: FanOutSignalReceiver?
```

- [ ] **Step 2: Auto mode — build both coordinators and fan the observer out**

In `installAutoTracking(thresholdMinutes:)`, replace the observer wiring (currently
`AppDelegate.swift:512-516`) so one observer feeds both coordinators:

```swift
        let manual = ManualIdleCoordinator(
            tracker: timeTracker,
            buffer: BufferStore.shared,
            thresholdSeconds: thresholdMinutes * 60,
            presentAwayPrompt: { minutes, resolve in
                AwayResolutionWindowController.present(minutes: minutes, resolve: resolve)
            }
        )
        let fanOut = FanOutSignalReceiver([coordinator, manual])
        let observer = WorkspaceObserver(receiver: fanOut)
        self.autoCoordinator = coordinator
        self.manualIdleCoordinator = manual
        self.signalFanOut = fanOut
        self.workspaceObserver = observer
        observer.start()
        coordinator.activate()      // manual coordinator self-arms on first manual signal
```

- [ ] **Step 3: Manual mode — install the manual coordinator + its observer**

In `installManualNudges(thresholdMinutes:)`, after the existing `ManualNudgeMonitor` wiring
(`AppDelegate.swift:329-338`), add (still inside the `guard … notifier` scope so it shares the
AckGate-gated install path):

```swift
        let manual = ManualIdleCoordinator(
            tracker: timeTracker,
            buffer: BufferStore.shared,
            thresholdSeconds: thresholdMinutes * 60,
            presentAwayPrompt: { minutes, resolve in
                AwayResolutionWindowController.present(minutes: minutes, resolve: resolve)
            }
        )
        let observer = WorkspaceObserver(receiver: manual)
        self.manualIdleCoordinator = manual
        self.workspaceObserver = observer
        observer.start()
```

- [ ] **Step 4: Teardown — deactivate the manual coordinator before dismissing the prompt**

In `stopAutoTracking()`, extend the existing teardown. Currently (`AppDelegate.swift:519-526`):

```swift
    @MainActor private func stopAutoTracking() {
        workspaceObserver?.stop()
        autoCoordinator?.deactivate()
        // Deactivate first (records any pending away as UNRESOLVED and makes the monitor
        // inactive), THEN close a still-open away prompt so its resolve() is a no-op.
        AwayResolutionWindowController.dismissIfShowing()
        workspaceObserver = nil
        autoCoordinator = nil
```

Change to also deactivate the manual coordinator **before** the dismiss, and nil the new fields:

```swift
    @MainActor private func stopAutoTracking() {
        workspaceObserver?.stop()
        autoCoordinator?.deactivate()
        manualIdleCoordinator?.deactivate()
        // Deactivate first (records any pending away as UNRESOLVED and makes the monitors
        // inactive), THEN close a still-open away prompt so its resolve() is a no-op.
        AwayResolutionWindowController.dismissIfShowing()
        workspaceObserver = nil
        autoCoordinator = nil
        manualIdleCoordinator = nil
        signalFanOut = nil
```

- [ ] **Step 5: Build + full test suite**

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build`
Expected: builds clean (no unused-variable / retain warnings on the new fields).

Run: `cd apps/client-macos && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS — the whole `TimeTrackTests` suite, including the untouched auto tests.

- [ ] **Step 6: Manual smoke (optional but recommended)**

With a **manual-mode** policy (`autoStartOnLogin=false`): start a manual timer, stay idle past the
threshold (a "still tracking?" notification appears — kept), then move the mouse. The
"You were away — Keep / Discard" window must appear. Keep → entry unchanged. Repeat and Discard →
the idle gap is trimmed and a fresh manual entry continues.

- [ ] **Step 7: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift
git commit -m "feat(client): run manual idle prompt in both tracking modes"
```

---

## Self-review — coverage against the spec

- Behavior §2 (keep running while away; keep=unchanged+IdleEvent; discard=trim@away-start+new manual entry+IdleEvent): Tasks 3–4.
- §2 sleep/lock away signal: `markAway` path — Task 3 (`testMarkAwayMirrorsThresholdPath`), delivered by `WorkspaceObserver` sleep/lock notifications — Task 5.
- §2 abandon → UNRESOLVED: Task 3 (`testDeactivateWhile…`) + Task 4 (`testSessionEndsWhileAway…`).
- §3 threshold reuse, no new setting: Tasks 4–5 pass `thresholdMinutes * 60`; no setting added.
- §4.1 `ManualIdleMonitor` incl. `didBeginAwayAt`: Task 3.
- §4.2 `ManualIdleCoordinator` effects + entry-identity discard guard: Task 4.
- §4.3 session-end reconciliation: Task 4 (`reconcileSessionEnd`, `testSessionEndsWhileAway…`, `testDiscardAfterEntryChanged…`).
- §4.4 both-mode wiring + `FanOutSignalReceiver`: Tasks 1 + 5.
- §4.5 reuse (WorkspaceObserver / AwayResolution UI / TimeTracker / IdleEventPayload / ManualNudgeMonitor unchanged): honored — no edits to those files.
- §5 sign-out safety (deactivate before dismiss, both modes): Task 5 Step 4.
- §6 tests: Tasks 1, 3, 4 (+ Task 2 regression net).
- §7 server audit-only (no API change): no API task — correct.
- §8 out-of-scope (ManualNudgeMonitor unchanged; project-refresh separate): honored.
