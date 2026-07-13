# Client crash-durability of an in-progress span — Design

**Date:** 2026-07-13
**Scope:** macOS client follow-up (deferred from Slice 1.7)
**Branch:** `slice-client-crash-durability`
**Predecessor:** 1.7d (offline buffer + sync — done, merged)

---

## 1. Goal & scope

Persist the currently-running `TimeTracker` span so an unclean exit — a crash **or** a
quit-while-tracking — does not silently lose the employee's in-progress time. On the next launch,
offer to **keep** the interrupted span (as a completed entry ending at the last heartbeat) or
**discard** it. Client-only; no server, contract, or DB change.

Today a span is only ever written to the buffer when it **closes** (`stop`/`pause`); a crash between
`start` and `stop` loses it entirely (design §4 of the 1.7b/1.7c/1.7d specs deferred this here).

**In scope**

- `Storage/LiveSpanStore` — a single overwritten file holding the in-progress span
  (`entryId, startTime, selection, source, lastAlive`); `begin` / `heartbeat` / `load` / `clear`.
- `TimeTracker` integration via an injected `LiveSpanRecording` seam: `begin` on open
  (start/resume), `clear` on close (stop/pause). Plus a `recordSpan(id:...)` overload so recovery
  preserves the original UUIDv7 (idempotent sync).
- A periodic **heartbeat** (~60s) driven from `AppDelegate` while a span is live, bounding the
  recovered end-time error to one interval (never counting downtime).
- **Recovery after auth**: once the user is known (in `becomeReady`, before any new tracking), load a
  leftover span; **only if its `userId` matches the current user** present a keep/discard prompt —
  keep → enqueue a completed entry; discard → drop; a span belonging to a *different* user on the
  same Mac is cleared without enqueuing (never mis-attributed). Either way, clear the file.

**Out of scope**

- Auto-**resuming** the interrupted session (we close it, we do not continue it).
- Persisting a paused session (a paused span is already a closed, buffered entry — nothing is in
  progress).
- Distinguishing a crash from a deliberate quit-while-tracking (both leave a live-span file and get
  the same recovery prompt; wording is neutral). We deliberately do **not** clear on clean quit — the
  in-progress time must stay recoverable.
- Any server / contract / Prisma change.

---

## 2. Constraints (carried from 1.7a–d + CLAUDE.md/PRD)

- **No new SwiftPM dependency.** Foundation `Codable` JSON + an atomic file, mirroring
  `ProjectCache`/`BufferStore`. (CLAUDE.md §2)
- **Not a capture path** → not gated by `AckGate`; `AckGate` untouched. Persisting/recovering the
  employee's own time entry touches no capture hardware. (CLAUDE.md §1)
- **The menu-bar indicator is unaffected; no stealth, no kill switch.** The recovery prompt is a
  normal visible window. (CLAUDE.md §1, PRD §4.2)
- **Recovered entries reuse the buffered `CreateTimeEntry` shape** and the durable buffer + sync from
  1.7d — no new upload path.
- **Tests via `@testable import TimeTrack`**, `swift test` from `apps/client-macos` with
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
- **Commits:** Conventional Commits, scope `client`, no AI attribution. (CLAUDE.md §0)

---

## 3. Architecture

```
                       begin(entryId,startTime,selection,source) / clear()
   ┌──────────────┐  ──────────────────────────────────────────▶  ┌──────────────────────────────┐
   │ TimeTracker  │      (LiveSpanRecording seam, injected)         │ LiveSpanStore                │
   │  open()/close│  ◀──────────────────────────────────────────   │ live-span.json (atomic)      │
   └──────┬───────┘                                                 │ {entryId,startTime,selection,│
          │ recordSpan(id:…) on recovery-keep                        │  source,lastAlive}           │
          ▼                                                         └──────┬────────────┬──────────┘
   ┌──────────────┐                                    heartbeat(at:) │            │ load()
   │ BufferStore  │ ◀── recovered completed entry ─────────┐         │ (≈60s timer while running) │
   └──────────────┘                                        │         ▼            ▼
                                                    ┌───────┴──────────────────────────────┐
                                                    │ AppDelegate                          │
                                                    │  • heartbeat timer (isRunning→beat)   │
                                                    │  • launch recovery: load→prompt→      │
                                                    │    recordSpan(keep)/drop→clear        │
                                                    └───────────────┬───────────────────────┘
                                                                    ▼ RecoveryView (keep/discard)
```

### Components

| Unit | New / edit | Responsibility |
| --- | --- | --- |
| `Storage/LiveSpanStore.swift` | new | `struct LiveSpan: Codable { entryId; startTime; projectId?; taskId?; source; lastAlive; userId? }` + `protocol LiveSpanRecording { func begin(entryId:startTime:selection:source:); func clear() }`. `LiveSpanStore` conforms and adds `heartbeat(at:)`, `load() -> LiveSpan?`. It stamps `userId` from an injected `currentUserId: () -> String?` on `begin`/`heartbeat` (so `TimeTracker`'s seam stays userId-free). Atomic write to `Application Support/TimeTrack/live-span.json`; injectable fileURL + clock. |
| `Tracking/TimeTracker.swift` | edit | Inject `liveSpan: LiveSpanRecording = NoopLiveSpan()`. `open` calls `liveSpan.begin(...)` with the just-minted id/time; `close(at:)` calls `liveSpan.clear()` after enqueue. Add `recordSpan(id: String? = nil, …)` (explicit id → recovery; defaults to `idGen(start)`). |
| `UI/RecoveryView.swift` (+controller) | new | The launch keep/discard prompt, mirroring `AwayResolutionView` (discard-default, fires once, visible window). |
| `App/AppDelegate.swift` | edit | Construct `LiveSpanStore` (`currentUserId: { session.userId() }`); pass it into `TimeTracker`; run a ~60s heartbeat timer (`timeTracker.isRunning → liveSpanStore.heartbeat(now)`); in `becomeReady` (once, post-auth), `load()` → if the span's `userId` matches `session.userId()` present the recovery prompt → keep: `recordSpan(id:…)`; discard: drop; a mismatched-user span is cleared without enqueuing; then `clear()`. |

`source` here is `TimeTracker.Source` (`.manual`/`.auto`); the recovered entry keeps its original
kind. `NoopLiveSpan` keeps existing `TimeTracker` tests and the pure-unit posture unchanged.

---

## 4. Data flow & the heartbeat/recovery contract

### Persist / clear (tied to state transitions)

- **`open(selection, source)`** (start/resume): compute `id = idGen(now)`, `now = clock()`, set
  `.tracking(...)`, then `liveSpan.begin(entryId: id, startTime: now, selection: selection, source: source)`.
  The file now describes the live span with `lastAlive = startTime`.
- **`close(at:)`** (stop/pause): after enqueuing the completed entry, `liveSpan.clear()` (delete the
  file). A cleanly-closed span leaves no leftover.

### Heartbeat (bounds the recovered end)

- `AppDelegate` runs a repeating ~60s `Timer` on the main run loop. Each tick: if
  `timeTracker.isRunning`, `liveSpanStore.heartbeat(at: Date())` rewrites the file with an updated
  `lastAlive`. So on recovery the counted end is accurate to within one interval and **never counts
  the crash→relaunch gap**.
- The heartbeat only matters while `.tracking`; a paused/idle tracker leaves the file absent (paused
  cleared it) so the tick is a cheap no-op.

### Recovery (post-auth, once)

- Recovery runs inside `becomeReady` — **after** the user is authenticated (so `session.userId()` is
  known) and **before** any new tracking can begin — guarded by a `hasAttemptedRecovery` flag so the
  multiple `becomeReady` paths (online, offline-marker, post-ack) run it only once. `liveSpanStore.load()`:
  - `nil` (clean prior exit) → nothing to do.
  - a `LiveSpan` whose `userId != session.userId()` (a **different** user on this Mac) → `clear()`
    **without** enqueuing. A leftover span is never mis-attributed to the current user — the same
    cross-user posture as 1.7d's sign-out buffer clear.
  - a `LiveSpan` whose `userId` matches (or the span predates userId stamping → treat as current) →
    present `RecoveryView`:
    _"TimeTrack was tracking **Project › Task** since **HH:MM** (~**X** min) when it last closed —
    keep or discard?"_ (project/task from the selection; **X** from `lastAlive − startTime`).
    - **Keep** → `timeTracker.recordSpan(id: span.entryId, start: span.startTime, end: span.lastAlive,
      projectId: span.projectId, taskId: span.taskId, source: span.source)` → the completed entry is
      buffered (kind `timeEntry`) and syncs like any other. **Discard** → nothing enqueued.
    - Either outcome → `liveSpanStore.clear()`.
- Preserving the **original `entryId`** keeps recovery idempotent: even in a pathological
  double-recovery it upserts to the same server row rather than duplicating. (The live span was never
  synced — only closed entries are — so a fresh id would also be safe; preserving it is the cleaner
  invariant.)

### Ordering guarantees

- Recovery runs (once) in `becomeReady`, after auth and before tracking is enabled, so a leftover
  span can never be confused with a fresh one and the prompt can never race a new `begin()`.
- Recovery is independent of `AckGate` (not a capture path) — it only replays the employee's own
  interrupted entry into the buffer, and only when the userId matches.

### Related pre-existing hole (noted, not fixed here)

A crash bypasses sign-out, so 1.7d's "clear the buffer on sign-out" does not run: a different user
logging in afterward on the same Mac would sync the prior user's **buffered** entries under their own
token. This slice closes that hole for the *live span* (via the userId gate) but does **not** change
the buffer's crash behavior — that is a separate 1.7d follow-up (e.g. per-user buffer dirs, or
clearing/quarantining the buffer on a user switch). Flagged so it isn't mistaken for solved.

---

## 5. Testing

**XCTest (unit):**

- `LiveSpanStoreTests` — `begin` writes a file that `load` round-trips (all fields incl. selection,
  source, and the stamped `userId`); `heartbeat(at:)` updates only `lastAlive` (id/start/selection/
  userId unchanged); `clear` removes the file and `load` then returns `nil`; `load` on a missing/
  undecodable file returns `nil` (fail safe). Temp fileURL + injected clock + injected
  `currentUserId` (mirrors `ProjectCacheTests`).
- The recovery **userId gate** is a pure decision (`LiveSpanStore.shouldRecover(span:currentUserId:)`
  → `Bool`: true when `span.userId == currentUserId` or the span has no userId; false otherwise),
  unit-tested for match / mismatch / nil-span-userId. `AppDelegate` calls it to choose prompt vs
  silent-clear.
- `TimeTrackerTests` (add, via a `LiveSpanRecording` spy) — `start`/`resume` (`open`) calls `begin`
  with the minted entryId + startTime + selection + source; `stop`/`pause` (`close`) calls `clear`;
  `recordSpan(id:)` enqueues with the **explicit** id (and the no-id overload still mints via idGen).
- **Build-verified:** `RecoveryView`/controller and the `AppDelegate` heartbeat timer + launch
  recovery wiring.

**Manual smoke (deferred to a human):** start tracking a project → `kill -9` the app after >1
heartbeat → relaunch → the recovery prompt shows the right project + elapsed → **Keep** → the entry
appears in the buffer ending at ≈ the last heartbeat (not launch time) → it syncs. Repeat choosing
**Discard** → no entry, file cleared. Also: clean **Stop** then relaunch → no prompt.

---

## 6. File structure

```
apps/client-macos/
├── Sources/TimeTrack/
│   ├── Storage/LiveSpanStore.swift        (new: LiveSpan + LiveSpanRecording + NoopLiveSpan + store)
│   ├── Tracking/TimeTracker.swift         (edit: liveSpan seam on open/close; recordSpan(id:…))
│   ├── UI/RecoveryView.swift              (new: launch keep/discard prompt)
│   └── App/AppDelegate.swift              (edit: wire store; heartbeat timer; launch recovery)
└── Tests/TimeTrackTests/
    ├── LiveSpanStoreTests.swift           (new)
    ├── TimeTrackerTests.swift             (edit: seam calls + recordSpan(id:))
    └── Support/FakeLiveSpanRecorder.swift (new: LiveSpanRecording spy)
```

---

## 7. Done when

- A live span is persisted on start/resume and cleared on stop/pause; while tracking, a ~60s
  heartbeat keeps `lastAlive` current.
- After an unclean exit, the next launch presents a keep/discard prompt (before tracking resumes);
  keep enqueues a completed entry ending at the last heartbeat (original entryId, correct
  source/selection) that syncs via 1.7d; discard drops it; the file is cleared either way.
- A clean stop leaves no leftover and no prompt. No `AckGate` involvement; no new dependency.
- `swift build` and `swift test` green; the manual smoke is demonstrated and recorded.
```
