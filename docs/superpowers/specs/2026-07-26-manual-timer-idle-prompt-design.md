# Manual-timer idle keep/discard prompt — design

**Date:** 2026-07-26
**Scope:** `apps/client-macos` (Swift)
**Status:** Approved (brainstorming), pending implementation plan

---

## 1. Problem

Today the away/keep-discard idle prompt only exists for **automatic** tracking. When an
employee starts a **manual** timer and then goes idle, nothing happens — by deliberate design,
`AutoTrackingCoordinator` no-ops all idle/sleep/resume signals during a manual session
(`isManualSessionLive` gate). The manual entry keeps running and counts the idle stretch as
worked time, with no way to reconcile it.

We want manual timers to also detect idle and, on return, let the user keep or discard the
idle stretch — but with **manual semantics**, not the auto-tracking semantics.

## 2. Chosen behavior

While a manual timer is running:

- The timer **keeps running** the whole time the user is away. It is never auto-stopped
  mid-away (this preserves the principle that a manual entry is the user's own action).
- Going away is triggered by **either** keyboard/pointer inactivity crossing the configured
  idle threshold **or** a system sleep / screen-lock event.
- When the user **returns**, a keep/discard prompt appears (the existing `AwayResolutionView`),
  showing the away duration in minutes.
- **Keep** → the entry is left exactly as-is (the idle stretch stays counted as worked).
  An `IdleEvent` with `resolvedAction: kept` is recorded for reconciliation/analytics.
- **Discard** → the running entry is closed at the **away-start** instant, and a **new manual**
  entry is opened from the **return** instant, so tracking continues. The idle gap
  `[awayStart, resume]` is not tracked. An `IdleEvent` with `resolvedAction: discarded` is
  recorded.

### Worked examples

Idle at 2:00pm, return at 2:30pm (30 min away):

```
Keep:
  [start … now]         one entry, unchanged, still running
  IdleEvent kept  [2:00, 2:30]

Discard:
  [start … 2:00]        closed
  gap 2:00–2:30         not tracked
  [2:30 … now]          new manual entry, running
  IdleEvent discarded [2:00, 2:30]
```

### Abandon (torn down while away/awaiting)

If the app is signed out / quit while away or awaiting resolution, the window is recorded as
`unresolved` (mirrors the auto path's `didAbandonAwayFrom`). The entry is **not** trimmed — a
manual entry stays as the user last left it.

## 3. Defaults (confirmed)

1. **Threshold:** reuse the same policy-configured idle threshold as auto tracking. No new
   setting, no new env var.
2. **Sleep / screen-lock counts as away** during a manual timer, same as auto. The prompt still
   appears only on return.

## 4. Architecture — Approach A (dedicated manual-idle path)

The existing auto `IdleMonitor` is **not** modified. Its model (stop-at-away, bridge-on-keep,
auto-reopen an AUTO entry on resolve) is wrong for manual and must not regress.

### 4.1 New unit: `ManualIdleMonitor`

A small, pure state machine mirroring `IdleMonitor`'s shape but with manual effects. Same
`inactive / active / away / awaiting` states and the same tick/markAway/resume/resolve inputs.
Injected `clock` for deterministic tests. No UI, no network, no capture — decisions only.

Difference from `IdleMonitor`:

- On `active → away` (threshold crossed **or** markAway): it does **not** emit a
  "stop tracking" decision. It only records the away-start.
- On `away → awaiting` (input resumes): it emits `didBecomeAwayForSeconds` (drives the prompt),
  same as auto.
- On `resolve(.keep)`: emits a "keep" decision — no tracker mutation.
- On `resolve(.discard)`: emits a "discard at awayStart, resume at now" decision.
- On `resolve`, it does **not** auto-open a new tracking span the way `IdleMonitor.resolve`
  does; the discard side-effect (close + reopen) is performed explicitly by the coordinator.
- `deactivate()` while away/awaiting emits an "abandon" decision (→ unresolved IdleEvent).

Delegate protocol (manual-specific), all callbacks on the main thread:

```
protocol ManualIdleMonitorDelegate: AnyObject {
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBecomeAwayForSeconds seconds: Int)
    func manualIdleMonitor(_ m: ManualIdleMonitor, didResolveAwayFrom awayStart: Date,
                           to resume: Date, keeping: Bool)
    func manualIdleMonitor(_ m: ManualIdleMonitor, didAbandonAwayFrom awayStart: Date,
                           to lastKnown: Date)
}
```

### 4.2 Routing in `AutoTrackingCoordinator`

The coordinator owns both monitors and routes the `WorkspaceObserver` signals based on the
current `tracker.state` at the moment the signal arrives:

- **Manual session live** (`.tracking(_,_,_,.manual)`): route tick/markAway/resume to the
  `ManualIdleMonitor`. (Note: `.paused` remains fully inert — no timer runs, so no idle
  detection; the existing `.paused` guard stays.)
- **Otherwise** (auto session, or nothing running): route to the existing auto `IdleMonitor`
  exactly as today.

This replaces the current "no-op during manual" gate with "route to the manual monitor during
manual." Only one monitor is ever in an `away`/`awaiting` cycle at a time because only one
session type is live at a time.

Coordinator handling of `ManualIdleMonitor` decisions:

- `didBecomeAwayForSeconds` → `presentAwayPrompt(minutes) { resolve }` (reuses the same
  presentation closure and `AwayResolutionView` as auto).
- `didResolveAwayFrom …, keeping: true` → enqueue `IdleEvent(kept)`. No tracker change.
- `didResolveAwayFrom …, keeping: false` → `tracker.stop(at: awayStart)`,
  then `tracker.start(projectId, taskId, source: .manual)` inheriting the **project/task of the
  just-closed entry** (captured at away-start, _not_ the live menu selection, which the user
  may have changed while away), then enqueue `IdleEvent(discarded)`.
- `didAbandonAwayFrom …` → enqueue `IdleEvent(unresolved)`. No tracker change.

`IdleEvent` enqueue reuses the existing `enqueueIdleEvent` helper and buffer path.

### 4.3 Reused, unchanged

- `WorkspaceObserver` — the single system edge (idle-seconds timer + sleep/lock notifications).
- `AwayResolutionView` — the keep/discard prompt UI.
- `TimeTracker.stop(at:)` / `TimeTracker.start(source:)` — no new tracker API needed.
- `IdleEventPayload` + buffer/sync path — same records, same `ResolvedAction` enum.

## 5. Sign-out / teardown safety (hard requirement)

Regression history: a non-modal keep/discard prompt left on screen across sign-out previously
mis-attributed one user's time to the next (recurred twice). The manual away-prompt is a new
instance of that surface and **must** be covered by the same dismissal:

- On sign-out / user switch, any pending manual away-prompt window is dismissed, and the
  one-shot present guard is reset, exactly as the auto away-prompt and recovery prompt already
  are.
- `deactivate()` on the manual monitor during sign-out records the window as `unresolved`
  (no bridge, no trim).

## 6. Testing

Unit (Swift, no host UI needed for the pure monitor):

- `ManualIdleMonitorTests` — the state machine in isolation with an injected clock and a fake
  delegate:
  - active → threshold crossed → away (asserts **no** stop decision emitted).
  - away → resume → awaiting → `didBecomeAwayForSeconds` with correct seconds.
  - resolve(keep) → `didResolve … keeping:true`, no discard side-effect.
  - resolve(discard) → `didResolve … keeping:false` with correct awayStart/resume.
  - markAway (sleep/lock) path mirrors threshold path.
  - deactivate while away and while awaiting → `didAbandon…` (unresolved).
- `AutoTrackingCoordinatorTests` (extend) — routing:
  - during a manual session, signals reach the manual monitor and the tracker is **not**
    stopped at away-start.
  - discard resolution closes the entry at awayStart and opens a new `.manual` entry.
  - keep resolution leaves the entry untouched and enqueues `IdleEvent(kept)`.
  - auto-session routing is unchanged (existing tests still green).
  - `.paused` remains fully inert.
- Sign-out dismissal test extended to cover the manual away-prompt (guard reset + window
  dismissed).

## 7. Out of scope

- No new user-facing setting for the manual idle threshold.
- No change to the server / API / contracts — `IdleEvent` already models kept/discarded/
  unresolved; the manual path emits the same records.
- No "discard and stop" variant — discard always continues tracking (confirmed).
- The separate (already-noted) gap that the client never refreshes the project list after
  launch is **not** part of this feature; tracked separately.

## 8. Open risks

- Ensuring only one monitor is ever mid-cycle: the router keys off `tracker.state`. A session
  type transition (manual stop → auto resumes) while `awaiting` must be reasoned about — the
  manual monitor should reach a terminal resolution or be deactivated before the auto monitor
  takes over. To be pinned down in the implementation plan.
