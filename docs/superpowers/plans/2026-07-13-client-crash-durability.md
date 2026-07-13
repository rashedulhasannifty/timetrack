# Client crash-durability of an in-progress span — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the currently-running `TimeTracker` span (with a heartbeat) so a crash or quit-while-tracking doesn't lose it; on the next launch, after auth, offer to keep it (ending at the last heartbeat, userId-gated) or discard it.

**Architecture:** A `LiveSpanStore` writes one overwritten JSON file describing the live span; `TimeTracker` calls a `LiveSpanRecording` seam (`begin` on open, `clear` on close). `AppDelegate` heartbeats `lastAlive` every ~60s while tracking, and on `becomeReady` (post-auth, once) loads any leftover span, recovers it via a keep/discard prompt only if its `userId` matches the current user, then clears it.

**Tech Stack:** Swift 6 (tools-version 5.10), Foundation, AppKit/SwiftUI, XCTest. No new SwiftPM dependency. Client at `apps/client-macos`.

## Global Constraints

- **No new SwiftPM dependency.** Foundation `Codable` JSON + an atomic file (mirrors `ProjectCache`/`BufferStore`). (CLAUDE.md §2)
- **Not a capture path** → NOT gated by `AckGate`; do not reference or modify `AckGate.swift`. (CLAUDE.md §1)
- **No stealth / no kill switch.** The recovery prompt is a normal visible window; the menu-bar indicator wiring is untouched. (CLAUDE.md §1, PRD §4.2)
- **Cross-user integrity:** a recovered span is enqueued to the global buffer (attributed by token on sync), so recovery MUST be userId-gated — a span whose `userId` ≠ the current user is cleared without enqueuing. (Consistent with 1.7d sign-out clear.)
- **Recovered entries reuse the buffered `CreateTimeEntry` shape** and 1.7d's buffer+sync — no new upload path. Recovery preserves the original `entryId` (idempotent).
- **Commits:** Conventional Commits, `type(client): …`, imperative ≤72 chars, **no AI attribution / co-author / generated-by footer**, author = repo git user. Commit normally (hooks run — do NOT use `--no-verify`). (CLAUDE.md §0)
- **Client tests** run from `apps/client-macos` with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` prefixed (CommandLineTools lacks XCTest). `@testable import TimeTrack`.

**Run commands (from `apps/client-macos`):** Build `swift build`; Test `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test` (`--filter <Class>` for one). On a stale-module error, `rm -rf .build` and re-run.

---

## File Structure

```
apps/client-macos/
├── Sources/TimeTrack/
│   ├── Storage/LiveSpanStore.swift        (new: LiveSpan + LiveSpanRecording + NoopLiveSpan + store + shouldRecover)
│   ├── Tracking/TimeTracker.swift         (edit: liveSpan seam on open/close; recordSpan(id:))
│   ├── UI/RecoveryView.swift              (new: launch keep/discard prompt, reuses AwayResolution)
│   └── App/AppDelegate.swift              (edit: construct store; heartbeat timer; recovery in becomeReady)
└── Tests/TimeTrackTests/
    ├── LiveSpanStoreTests.swift           (new)
    ├── TimeTrackerTests.swift             (edit: seam calls + recordSpan(id:))
    └── Support/FakeLiveSpanRecorder.swift (new: LiveSpanRecording spy)
```

---

## Task 1: LiveSpanStore (model, seam, store, userId gate)

The durable single-file store for the in-progress span, plus the `LiveSpanRecording` seam `TimeTracker` will call and the pure `shouldRecover` userId gate.

**Files:**
- Create: `apps/client-macos/Sources/TimeTrack/Storage/LiveSpanStore.swift`
- Test: `apps/client-macos/Tests/TimeTrackTests/LiveSpanStoreTests.swift`

**Interfaces:**
- Consumes: `TimeTracker.Selection`, `TimeTracker.Source` (already exist).
- Produces (consumed by Tasks 2 & 4):
  - `struct LiveSpan: Codable, Equatable { let entryId; let startTime: Date; let projectId: String?; let taskId: String?; let source: String; var lastAlive: Date; let userId: String? }`
  - `protocol LiveSpanRecording { func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection, source: TimeTracker.Source); func clear() }`
  - `struct NoopLiveSpan: LiveSpanRecording` (no-op)
  - `final class LiveSpanStore: LiveSpanRecording` with `init(fileURL: URL, clock: @escaping () -> Date = Date.init, currentUserId: @escaping () -> String?)`, `static func defaultURL() -> URL`, `func heartbeat(at: Date)`, `func load() -> LiveSpan?`, `static func shouldRecover(span: LiveSpan, currentUserId: String?) -> Bool`.

- [ ] **Step 1: Write the failing tests**

Create `LiveSpanStoreTests.swift`:
```swift
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

    private let sel = TimeTracker.Selection(projectId: "p1", taskId: "k1")

    func testBeginWritesASpanThatLoadRoundTrips() {
        let (store, _) = makeStore(userId: "user-1")
        store.begin(entryId: "e1", startTime: t0, selection: sel, source: .auto)

        let span = store.load()
        XCTAssertEqual(span?.entryId, "e1")
        XCTAssertEqual(span?.startTime, t0)
        XCTAssertEqual(span?.projectId, "p1")
        XCTAssertEqual(span?.taskId, "k1")
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
        let base = LiveSpan(entryId: "e1", startTime: t0, projectId: nil, taskId: nil,
                            source: "MANUAL", lastAlive: t0, userId: "user-1")
        XCTAssertTrue(LiveSpanStore.shouldRecover(span: base, currentUserId: "user-1"), "same user → recover")
        XCTAssertFalse(LiveSpanStore.shouldRecover(span: base, currentUserId: "user-2"), "different user → refuse")
        let legacy = LiveSpan(entryId: "e1", startTime: t0, projectId: nil, taskId: nil,
                              source: "MANUAL", lastAlive: t0, userId: nil)
        XCTAssertTrue(LiveSpanStore.shouldRecover(span: legacy, currentUserId: "user-2"),
                      "span with no owner → treat as current")
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter LiveSpanStoreTests`
Expected: compile failure — `LiveSpan`/`LiveSpanStore` undefined.

- [ ] **Step 3: Write the implementation**

Create `LiveSpanStore.swift`:
```swift
import Foundation

/// The persisted in-progress span. `source` is `TimeTracker.Source.rawValue`; `lastAlive` is bumped
/// by the heartbeat; `userId` is stamped so recovery can refuse a span from a different user.
struct LiveSpan: Codable, Equatable {
    let entryId: String
    let startTime: Date
    let projectId: String?
    let taskId: String?
    let source: String
    var lastAlive: Date
    let userId: String?
}

/// The seam `TimeTracker` calls on open/close. `NoopLiveSpan` keeps existing tests + the pure-unit
/// posture unchanged; `LiveSpanStore` is the real persister.
protocol LiveSpanRecording {
    func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection, source: TimeTracker.Source)
    func clear()
}

struct NoopLiveSpan: LiveSpanRecording {
    func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection, source: TimeTracker.Source) {}
    func clear() {}
}

/// PRD §7.5 spirit — persists the CURRENT in-progress span so a crash / quit-while-tracking doesn't
/// lose it. One overwritten JSON file under Application Support; the heartbeat keeps `lastAlive`
/// current so recovery closes the span near its true end (never counting downtime). Hand-rolled
/// Foundation JSON, no dependency. Not a capture path — no AckGate.
final class LiveSpanStore: LiveSpanRecording {
    private let fileURL: URL
    private let clock: () -> Date
    private let currentUserId: () -> String?

    init(fileURL: URL, clock: @escaping () -> Date = Date.init, currentUserId: @escaping () -> String?) {
        self.fileURL = fileURL
        self.clock = clock
        self.currentUserId = currentUserId
    }

    /// ~/Library/Application Support/TimeTrack/live-span.json
    static func defaultURL() -> URL {
        let dir = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("TimeTrack", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("live-span.json")
    }

    func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection, source: TimeTracker.Source) {
        write(LiveSpan(entryId: entryId, startTime: startTime,
                       projectId: selection.projectId, taskId: selection.taskId,
                       source: source.rawValue, lastAlive: startTime, userId: currentUserId()))
    }

    func heartbeat(at now: Date) {
        guard var span = load() else { return }
        span.lastAlive = now
        write(span)
    }

    func load() -> LiveSpan? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(LiveSpan.self, from: data)
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    /// Recover only if the span belongs to the current user (or predates userId stamping).
    static func shouldRecover(span: LiveSpan, currentUserId: String?) -> Bool {
        guard let owner = span.userId else { return true }
        return owner == currentUserId
    }

    private func write(_ span: LiveSpan) {
        if let data = try? JSONEncoder().encode(span) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter LiveSpanStoreTests`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Storage/LiveSpanStore.swift \
        apps/client-macos/Tests/TimeTrackTests/LiveSpanStoreTests.swift
git commit -m "feat(client): live-span store with heartbeat and userId gate"
```

---

## Task 2: TimeTracker — live-span seam + explicit-id recordSpan

Wire `TimeTracker` to the seam (persist on open, clear on close) and add the `recordSpan(id:)` overload recovery uses to preserve the original entryId.

**Files:**
- Modify: `apps/client-macos/Sources/TimeTrack/Tracking/TimeTracker.swift`
- Create: `apps/client-macos/Tests/TimeTrackTests/Support/FakeLiveSpanRecorder.swift`
- Test: `apps/client-macos/Tests/TimeTrackTests/TimeTrackerTests.swift` (add cases)

**Interfaces:**
- Consumes: `LiveSpanRecording`, `NoopLiveSpan` (Task 1).
- Produces (consumed by Task 4):
  - `TimeTracker.init(buffer:clock:idGen:liveSpan: LiveSpanRecording = NoopLiveSpan())`
  - `func recordSpan(id: String? = nil, start: Date, end: Date, projectId: String?, taskId: String?, source: Source)` (explicit id → recovery; nil → mints via idGen).

- [ ] **Step 1: Write the fake recorder + failing tests**

Create `Support/FakeLiveSpanRecorder.swift`:
```swift
import Foundation
@testable import TimeTrack

final class FakeLiveSpanRecorder: LiveSpanRecording {
    struct Begin: Equatable {
        let entryId: String; let startTime: Date
        let selection: TimeTracker.Selection; let source: TimeTracker.Source
    }
    private(set) var begins: [Begin] = []
    private(set) var clears = 0

    func begin(entryId: String, startTime: Date, selection: TimeTracker.Selection, source: TimeTracker.Source) {
        begins.append(Begin(entryId: entryId, startTime: startTime, selection: selection, source: source))
    }
    func clear() { clears += 1 }
}
```
(`TimeTracker.Source` must be `Equatable` for `Begin: Equatable`. It's a `String`-raw enum, so it already conforms; if the compiler disagrees, add `Equatable` to the enum in `TimeTracker.swift` — it is a safe, non-behavioral change.)

Append to `TimeTrackerTests.swift`:
```swift
    func testOpenPersistsLiveSpan() {
        let clock = MutableClock(t0)
        let recorder = FakeLiveSpanRecorder()
        let tracker = TimeTracker(buffer: BufferSpy(), clock: clock.read,
                                  idGen: sequentialIdGen(), liveSpan: recorder)

        tracker.start(projectId: "p1", taskId: "k1", source: .auto)

        XCTAssertEqual(recorder.begins.count, 1)
        XCTAssertEqual(recorder.begins[0], .init(entryId: "id-1", startTime: t0,
                                                 selection: .init(projectId: "p1", taskId: "k1"),
                                                 source: .auto))
        XCTAssertEqual(recorder.clears, 0)
    }

    func testStopClearsLiveSpan() {
        let recorder = FakeLiveSpanRecorder()
        let tracker = TimeTracker(buffer: BufferSpy(), clock: { self.t0 },
                                  idGen: sequentialIdGen(), liveSpan: recorder)
        tracker.start(projectId: nil, taskId: nil)
        tracker.stop()
        XCTAssertEqual(recorder.clears, 1, "a clean stop clears the live span")
    }

    func testPauseClearsAndResumeReopensLiveSpan() {
        let recorder = FakeLiveSpanRecorder()
        let tracker = TimeTracker(buffer: BufferSpy(), clock: { self.t0 },
                                  idGen: sequentialIdGen(), liveSpan: recorder)
        tracker.start(projectId: nil, taskId: nil)     // begin #1
        tracker.pause()                                 // clear
        tracker.resume()                                // begin #2
        XCTAssertEqual(recorder.begins.count, 2)
        XCTAssertEqual(recorder.clears, 1)
    }

    func testRecordSpanWithExplicitIdKeepsThatId() {
        let spy = BufferSpy()
        let tracker = TimeTracker(buffer: spy, clock: { self.t0 }, idGen: sequentialIdGen())
        tracker.recordSpan(id: "recovered-id", start: t0, end: t0.addingTimeInterval(300),
                           projectId: "p1", taskId: nil, source: .manual)
        XCTAssertEqual(spy.object(at: 0)["id"] as? String, "recovered-id")
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter TimeTrackerTests`
Expected: compile failure — `liveSpan:` init param and `recordSpan(id:)` don't exist.

- [ ] **Step 3: Edit `TimeTracker.swift`**

Add the stored seam + init param. Change the property block + init:
```swift
    private let buffer: TimeEntryBuffering
    private let clock: () -> Date
    private let idGen: (Date) -> String
    private let liveSpan: LiveSpanRecording
    private(set) var state: State = .idle

    init(
        buffer: TimeEntryBuffering,
        clock: @escaping () -> Date = Date.init,
        idGen: @escaping (Date) -> String = { UUIDv7.generate(now: $0) },
        liveSpan: LiveSpanRecording = NoopLiveSpan()
    ) {
        self.buffer = buffer
        self.clock = clock
        self.idGen = idGen
        self.liveSpan = liveSpan
    }
```

Change `recordSpan` to accept an explicit id:
```swift
    func recordSpan(id: String? = nil, start: Date, end: Date,
                    projectId: String?, taskId: String?, source: Source) {
        enqueue(id: id ?? idGen(start), projectId: projectId, taskId: taskId,
                start: start, end: end, source: source)
    }
```

Change `open` to persist and `close` to clear:
```swift
    private func open(_ selection: Selection, source: Source) {
        let now = clock()
        let id = idGen(now)
        state = .tracking(entryId: id, startedAt: now, selection: selection, source: source)
        liveSpan.begin(entryId: id, startTime: now, selection: selection, source: source)
    }

    private func close(at endTime: Date) {
        guard case let .tracking(id, startedAt, selection, source) = state else { return }
        enqueue(id: id, projectId: selection.projectId, taskId: selection.taskId,
                start: startedAt, end: endTime, source: source)
        liveSpan.clear()
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --filter TimeTrackerTests`
Expected: PASS (existing cases + 4 new).

Full suite (the recordSpan signature gained a defaulted first param — existing `recordSpan(start:…)` callers in `AutoTrackingCoordinator` still resolve): `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS (0 failures; count rose by the 4 new cases).

- [ ] **Step 5: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/Tracking/TimeTracker.swift \
        apps/client-macos/Tests/TimeTrackTests/TimeTrackerTests.swift \
        apps/client-macos/Tests/TimeTrackTests/Support/FakeLiveSpanRecorder.swift
git commit -m "feat(client): persist live span on tracker open/close"
```

---

## Task 3: RecoveryView — the relaunch keep/discard prompt

A visible prompt shown on relaunch when a recoverable span is found, reusing the `AwayResolution` enum and mirroring `AwayResolutionView`'s fire-once / discard-default structure.

**Files:**
- Create: `apps/client-macos/Sources/TimeTrack/UI/RecoveryView.swift`

**Interfaces:**
- Consumes: `AwayResolution` (`.keep`/`.discard`, from `IdleMonitor.swift`), `TT` design tokens (`TimeTrackTokens.swift`).
- Produces (consumed by Task 4):
  - `final class RecoveryWindowController` with `static func present(minutes: Int, resolve: @escaping (AwayResolution) -> Void)`.

- [ ] **Step 1: Write the implementation**

Read `apps/client-macos/Sources/TimeTrack/UI/AwayResolutionView.swift` first and mirror its structure (token names `TT.Space.x4`/`x6`, `Font.ttH2`/`ttBody`, the `live`-retained controller, `finish` fire-once, `windowWillClose → .discard`). Create `RecoveryView.swift`:
```swift
import AppKit
import SwiftUI

/// Shown on relaunch when a previous tracking span was interrupted (crash or quit-while-tracking).
/// Keep → the span is recovered as a completed entry ending at the last heartbeat; Discard drops it.
/// Discard is the default action (and the result of dismissing), mirroring the away prompt. Always
/// a visible window; no stealth. `resolve` fires exactly once.
struct RecoveryView: View {
    let minutes: Int
    let onKeep: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TT.Space.x4) {
            Text("Recover interrupted time?")
                .font(.ttH2)
            Text("TimeTrack was tracking for about \(minutes) minute\(minutes == 1 ? "" : "s") when it last closed. Keep this time or discard it?")
                .font(.ttBody)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Keep", action: onKeep)
                Button("Discard", action: onDiscard)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(TT.Space.x6)
        .frame(width: 320)
    }
}

final class RecoveryWindowController: NSWindowController, NSWindowDelegate {
    private var resolve: ((AwayResolution) -> Void)?
    private static var live: RecoveryWindowController?

    static func present(minutes: Int, resolve: @escaping (AwayResolution) -> Void) {
        let controller = RecoveryWindowController(minutes: minutes, resolve: resolve)
        live = controller
        NSApp.activate(ignoringOtherApps: true)
        controller.showWindow(nil)
        controller.window?.makeKeyAndOrderFront(nil)
    }

    private init(minutes: Int, resolve: @escaping (AwayResolution) -> Void) {
        self.resolve = resolve
        let window = NSWindow(
            contentRect: .init(x: 0, y: 0, width: 320, height: 170),
            styleMask: [.titled, .closable],
            backing: .buffered, defer: false
        )
        window.center()
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        window.contentView = NSHostingView(rootView: RecoveryView(
            minutes: minutes,
            onKeep: { [weak self] in self?.finish(.keep) },
            onDiscard: { [weak self] in self?.finish(.discard) }
        ))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func finish(_ action: AwayResolution) {
        guard let resolve else { return }
        self.resolve = nil
        resolve(action)
        window?.close()
        Self.live = nil
    }

    func windowWillClose(_ notification: Notification) {
        if let resolve {
            self.resolve = nil
            resolve(.discard)
            Self.live = nil
        }
    }
}
```

> If any `TT`/`Font` token name differs from `AwayResolutionView.swift`, use whatever that file uses (they were verified in the 1.7c polish work).

- [ ] **Step 2: Build to verify it compiles**

Run: `swift build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/UI/RecoveryView.swift
git commit -m "feat(client): relaunch keep-or-discard recovery prompt"
```

---

## Task 4: AppDelegate — wire store, heartbeat, and post-auth recovery

Construct the `LiveSpanStore` (stamping the session userId), inject it into `TimeTracker`, heartbeat while tracking, and recover a leftover span once in `becomeReady` (userId-gated). Build-verified; the live GUI smoke is deferred to a human.

**Files:**
- Modify: `apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift`

**Interfaces:**
- Consumes: `LiveSpanStore` + `LiveSpanStore.shouldRecover` (Task 1), `TimeTracker(…, liveSpan:)` + `recordSpan(id:)` (Task 2), `RecoveryWindowController.present` (Task 3), `AwayResolution`, existing `AuthSession.userId()` (synchronous), `becomeReady()`.
- Produces: none (top of the wiring tree).

- [ ] **Step 1: Add stored properties + construct the store, injected into the tracker**

In `AppDelegate.swift`, add stored properties near the others:
```swift
    private let liveSpanStore: LiveSpanStore
    private var heartbeatTimer: Timer?
    private var hasAttemptedRecovery = false
```
In `AppDelegate.init`, BEFORE `let tracker = TimeTracker(buffer: BufferStore.shared)`, construct the store and inject it. The `session` local already exists at that point:
```swift
        let liveSpanStore = LiveSpanStore(
            fileURL: LiveSpanStore.defaultURL(),
            currentUserId: { [session] in session.userId() }
        )
        self.liveSpanStore = liveSpanStore

        let tracker = TimeTracker(buffer: BufferStore.shared, liveSpan: liveSpanStore)
        self.timeTracker = tracker
```
(Replace the existing two lines that build `tracker`/`self.timeTracker` with the block above — keep everything else in `init` unchanged. `liveSpanStore` is a `let`, so it must be assigned before `super.init()`; this placement satisfies that.)

- [ ] **Step 2: Start the heartbeat timer**

Add a helper and call it from `applicationDidFinishLaunching` (after `statusItem.install(...)`, before `Task { await start() }`):
```swift
    @MainActor private func startHeartbeat() {
        let timer = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            guard let self, self.timeTracker.isRunning else { return }
            self.liveSpanStore.heartbeat(at: Date())
        }
        RunLoop.main.add(timer, forMode: .common)
        heartbeatTimer = timer
    }
```
Call site in `applicationDidFinishLaunching`:
```swift
        statusItem.install(content: MenuBarView(viewModel: menuViewModel))
        startHeartbeat()
        Task { await start() }
```

- [ ] **Step 3: Recover in `becomeReady` (once, userId-gated)**

Add the recovery method:
```swift
    /// Recover an interrupted span left by a crash / quit-while-tracking. Runs once, AFTER auth
    /// (so `session.userId()` is known) and before the user can start new tracking. A span from a
    /// DIFFERENT user on this Mac is cleared without enqueuing — never mis-attributed (buffer syncs
    /// by token). Keep → replay the completed entry (original id, ending at the last heartbeat).
    @MainActor private func recoverLiveSpanIfNeeded() {
        guard !hasAttemptedRecovery else { return }
        hasAttemptedRecovery = true
        guard let span = liveSpanStore.load() else { return }
        guard LiveSpanStore.shouldRecover(span: span, currentUserId: session.userId()) else {
            liveSpanStore.clear()
            return
        }
        let minutes = max(1, Int((span.lastAlive.timeIntervalSince(span.startTime) / 60).rounded()))
        RecoveryWindowController.present(minutes: minutes) { [weak self] action in
            guard let self else { return }
            if action == .keep {
                self.timeTracker.recordSpan(
                    id: span.entryId, start: span.startTime, end: span.lastAlive,
                    projectId: span.projectId, taskId: span.taskId,
                    source: TimeTracker.Source(rawValue: span.source) ?? .manual
                )
            }
            self.liveSpanStore.clear()
        }
    }
```
Call it from `becomeReady()`. Add as the last line of `becomeReady()` (after the existing `startSyncIfNeeded()` line):
```swift
        await MainActor.run { recoverLiveSpanIfNeeded() }
```

- [ ] **Step 4: Build and run the full suite**

Run: `swift build`
Expected: build succeeds. (A benign Swift-6 `#SendableClosureCaptures`-style warning around the timer/`Task` closures is acceptable — tools-version 5.10; consistent with existing AppDelegate closures.)

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test`
Expected: PASS (no test targets `AppDelegate` directly; full suite stays green).

- [ ] **Step 5: Self-audit + manual smoke note**

Record in the report:
- `recoverLiveSpanIfNeeded()` is called only from `becomeReady`, guarded by `hasAttemptedRecovery` (runs once across the online/offline/post-ack paths).
- The userId gate is applied (`shouldRecover`) before any prompt/enqueue; a mismatched-user span is cleared, not enqueued.
- `AckGate.swift` is unchanged (grep) and recovery/heartbeat reference no capture-gating path.
- **Manual GUI smoke DEFERRED TO A HUMAN** (headless): track → `kill -9` after >1 heartbeat → relaunch → prompt shows ~elapsed → Keep → entry in buffer ends ≈ last heartbeat → syncs; Discard → no entry; clean Stop → no prompt. Do NOT fabricate.

- [ ] **Step 6: Commit**

```bash
git add apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift
git commit -m "feat(client): heartbeat and post-auth crash recovery"
```

---

## Task 5: PRD as-built note

**Files:**
- Modify: `PRD.md` (§7.9 As-built refinements)

- [ ] **Step 1: Append the as-built bullet**

In `PRD.md` §7.9, append:
```markdown
- **Client persists the in-progress span (crash-durability).** The running `TimeTracker` span is written to `Application Support/TimeTrack/live-span.json` with a ~60s heartbeat; on relaunch after an unclean exit the client offers a keep/discard recovery prompt (keep → a completed entry ending at the last heartbeat, original UUIDv7). Recovery is userId-gated: a leftover span belonging to a different user on the same Mac is cleared, never mis-attributed. (The equivalent crash hole for the *buffer* — a crash bypasses the sign-out clear — remains a separate follow-up.)
```

- [ ] **Step 2: Commit**

```bash
git add PRD.md
git commit -m "docs: note client crash-durability as-built"
```

---

## Self-Review

**Spec coverage** (against the design doc §1–§7):
- `LiveSpanStore` (begin/heartbeat/load/clear, atomic, injectable, userId-stamped) + `shouldRecover` gate → Task 1. ✅
- `LiveSpanRecording` seam + `NoopLiveSpan` → Task 1; `TimeTracker` begin-on-open/clear-on-close + `recordSpan(id:)` → Task 2. ✅
- Heartbeat (~60s while `isRunning`) → Task 4. ✅
- Recovery after auth, once (`hasAttemptedRecovery`), userId-gated, keep→`recordSpan(id:)`/discard→drop/mismatch→clear → Task 4. ✅
- Recovery prompt (visible, discard-default, fire-once) → Task 3. ✅
- Original entryId preserved → Task 2 (`recordSpan(id:)`) + Task 4 (passes `span.entryId`). ✅
- Not AckGate-gated; no new dependency → all tasks (constraints). ✅
- PRD as-built + noted buffer-crash follow-up → Task 5. ✅

**Deviation from spec (noted):** the prompt text omits the project/task **names** (§4 mentioned "Project › Task"); recovery only has the ids, and a name lookup would need `ProjectCache` — deferred as a nicety. The prompt shows the elapsed time, which is the load-bearing detail. Not a functional gap.

**Placeholder scan:** none. Swift-6-warning notes are explicit acceptance statements.

**Type consistency:** `LiveSpan` fields, `LiveSpanRecording.begin(entryId:startTime:selection:source:)`/`clear()`, `LiveSpanStore.init(fileURL:clock:currentUserId:)`/`heartbeat(at:)`/`load()`/`shouldRecover(span:currentUserId:)`, `TimeTracker.init(…liveSpan:)`/`recordSpan(id:…)`, `RecoveryWindowController.present(minutes:resolve:)` — names/signatures match across defining and consuming tasks. ✅

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-13-client-crash-durability.md`.**
```
