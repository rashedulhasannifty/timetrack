# Manual-timer idle keep/discard prompt — design

**Date:** 2026-07-26
**Scope:** `apps/client-macos` (Swift)
**Status:** Approved (brainstorming), architecture revised after code review, pending implementation plan

> **Revision note:** the client runs in one of two mutually-exclusive modes keyed on the
> `autoStartOnLogin` policy flag. In **auto mode** `WorkspaceObserver` + `AutoTrackingCoordinator`
> run; in **manual mode** neither is installed — only a notify-only `ManualNudgeMonitor`. The
> first draft assumed the auto machinery is always present, which is false for the primary case
> (a manual-mode deployment). Architecture below is the corrected version: a **dedicated
> `ManualIdleCoordinator`** installed in **both** modes, mutual-exclusion by guard rather than by
> an internal router.

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

The existing auto `IdleMonitor` and `AutoTrackingCoordinator` are **not** modified. The auto
model (stop-at-away, bridge-on-keep, auto-reopen an AUTO entry on resolve) is wrong for manual
and must not regress. The manual path is a **separate, independent** unit — mutual exclusion with
the auto path is achieved by each side _guarding on session type_, not by an internal router.

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

Also add a `didBeginAway` callback to the manual delegate (the auto monitor has no equivalent
because auto stops the entry at away-start; manual doesn't, so the coordinator needs an explicit
signal to snapshot which entry the away window belongs to):

```
    func manualIdleMonitor(_ m: ManualIdleMonitor, didBeginAwayAt awayStart: Date)
```

### 4.2 New unit: `ManualIdleCoordinator`

A dedicated coordinator (sibling to `AutoTrackingCoordinator`, not merged into it) that owns the
`ManualIdleMonitor`, conforms to `AutoTrackingSignalReceiver` (`tick`/`markAway`/`resume`), and
performs the manual keep/discard/trim effects on `TimeTracker`. It **guards every signal on
session type**, so it is inert unless a `.manual` session is live:

```
func tick(idleSeconds:)  { reconcileThenRoute { monitor.tick(idleSeconds:) } }
func markAway()          { reconcileThenRoute { monitor.markAway() } }
func resume()            { reconcileThenRoute { monitor.resume() } }
```

`reconcileThenRoute` runs the **session-end reconciliation** (§4.3) first, then forwards to the
monitor only while a `.manual` session is live. Because the auto coordinator already ignores
signals during a manual session and this coordinator only acts during one, the two are mutually
exclusive with no shared state — one prompt at most (also enforced by the
`AwayResolutionWindowController` singleton).

Snapshot: on `didBeginAwayAt`, capture `awayEntryId` = the current `.tracking` entry's id.

Coordinator handling of `ManualIdleMonitor` decisions:

- `didBeginAwayAt awayStart` → snapshot `awayEntryId` from `tracker.state`.
- `didBecomeAwayForSeconds` → `presentAwayPrompt(minutes) { resolve }` (reuses the same
  presentation closure and `AwayResolutionView` as auto).
- `didResolveAwayFrom …, keeping: true` → enqueue `IdleEvent(kept)`. No tracker change. (Safe:
  the server treats IdleEvents as audit-only — see §7 — so recording a kept window that a running
  entry already covers does not double-count.)
- `didResolveAwayFrom …, keeping: false` → **only if** `tracker.state` is still
  `.tracking(entryId == awayEntryId, selection, .manual)`: `tracker.stop(at: awayStart)` then
  `tracker.start(projectId, taskId, source: .manual)` inheriting **that running entry's own
  `selection`** (read from `tracker.state`, _not_ the live menu selection, which the user may
  have changed while away). Then enqueue `IdleEvent(discarded)`. If the entry changed/stopped
  while away, do not trim — enqueue `IdleEvent(unresolved)` instead.
- `didAbandonAwayFrom …` → enqueue `IdleEvent(unresolved)`. No tracker change.

`IdleEvent` enqueue reuses the same payload shape + buffer path as `AutoTrackingCoordinator`
(`IdleEventPayload`, `ResolvedAction`). Extract the tiny `enqueueIdleEvent` helper into a shared
place both coordinators call, rather than duplicating it.

### 4.3 Crux correctness: manual session ends mid-cycle

If the manual timer stops or pauses (user hits Stop/Pause, or any stop) **while the manual
monitor is mid-cycle** (`.away` or `.awaiting`), the away window belongs to an entry that no
longer exists. Left unhandled, a later `resume`/resolve would act on the wrong tracker state —
the same mis-attribution class as the sign-out prompt leak (which recurred twice). Handling:

- `reconcileThenRoute` checks, before forwarding any signal: if the monitor is non-`inactive`
  **and** the current session is not `.tracking(entryId == awayEntryId, …, .manual)`, then
  `monitor.deactivate()` (→ `didAbandonAwayFrom` → `IdleEvent(unresolved)`), reset `awayEntryId`,
  and dismiss any showing prompt. This catches Stop/Pause and stop-then-restart-new-entry.
- The discard path's entry-identity guard (§4.2) is the second line of defense at resolve time.

### 4.4 Wiring in `AppDelegate` (both modes, behind `AckGate`)

One `WorkspaceObserver` is the system edge in both modes. `WorkspaceObserver.receiver` is a
single `AutoTrackingSignalReceiver`; to feed two coordinators in auto mode, introduce a small
`FanOutSignalReceiver` that forwards `tick`/`markAway`/`resume` to an ordered list of receivers.

- **Manual mode** (`autoStartOnLogin == false`, `installManualNudges` path): install a
  `ManualIdleCoordinator` + a `WorkspaceObserver(receiver: manualCoordinator)`. Keep installing
  the existing `ManualNudgeMonitor` unchanged (the "keep both" decision: the while-away
  notification stays; the on-return prompt is new).
- **Auto mode** (`autoStartOnLogin == true`, `installAutoTracking` path): build the existing
  `AutoTrackingCoordinator` **and** a `ManualIdleCoordinator`, and feed both from one observer:
  `WorkspaceObserver(receiver: FanOutSignalReceiver([autoCoordinator, manualCoordinator]))`.
  Call `autoCoordinator.activate()` as today; the `ManualIdleCoordinator` needs no `activate()`
  (it is signal-driven and self-guards).

Store the `ManualIdleCoordinator` in a new `AppDelegate` field so teardown can reach it.

### 4.5 Reused, unchanged

- `WorkspaceObserver` — system edge (idle-seconds timer + sleep/lock notifications). Not modified.
- `AwayResolutionView` / `AwayResolutionWindowController` — the keep/discard prompt UI + its
  `present` / `dismissIfShowing` singleton.
- `TimeTracker.stop(at:)` / `TimeTracker.start(source:)` — no new tracker API needed.
- `IdleEventPayload` + buffer/sync path — same records, same `ResolvedAction` enum.
- `ManualNudgeMonitor` — unchanged; its manual-idle notification stays (keep-both).

## 5. Sign-out / teardown safety (hard requirement)

Regression history: a non-modal keep/discard prompt left on screen across sign-out previously
mis-attributed one user's time to the next (recurred twice). The manual away-prompt is a new
instance of that surface and **must** be covered by the same dismissal, in **both** modes:

- `stopAutoTracking()` (the sign-out teardown) must also `deactivate()` the
  `ManualIdleCoordinator` and nil its field — in addition to the existing auto teardown. Ordering
  mirrors the auto path: deactivate the coordinator/monitor **first** (records any pending away as
  `unresolved`), then `AwayResolutionWindowController.dismissIfShowing()` so its `resolve` is a
  harmless no-op.
- Because manual-mode installs the coordinator via the `installManualNudges` path (not
  `installAutoTracking`), verify `stopAutoTracking()` runs on sign-out in manual mode too, or move
  the manual-coordinator teardown to wherever `manualNudgeMonitor` is already torn down (same
  method today). The manual coordinator + `ManualNudgeMonitor` must be torn down together.

## 6. Testing

Unit (Swift, no host UI needed for the pure monitor):

- `ManualIdleMonitorTests` — the state machine in isolation with an injected clock and a fake
  delegate:
  - active → threshold crossed → `didBeginAwayAt`, and **no** stop decision emitted.
  - away → resume → awaiting → `didBecomeAwayForSeconds` with correct seconds.
  - resolve(keep) → `didResolve … keeping:true`, no discard side-effect.
  - resolve(discard) → `didResolve … keeping:false` with correct awayStart/resume.
  - markAway (sleep/lock) path mirrors threshold path (also emits `didBeginAwayAt`).
  - deactivate while away and while awaiting → `didAbandon…` (unresolved).
- `ManualIdleCoordinatorTests` — the effects + guards, with a spy `TimeTracker`/buffer:
  - during a `.manual` session: signals reach the monitor; tracker is **not** stopped at
    away-start (timer keeps running while away).
  - discard resolution closes the entry at awayStart and opens a **new `.manual`** entry
    inheriting the closed entry's selection; enqueues `IdleEvent(discarded)`.
  - keep resolution leaves the entry untouched and enqueues `IdleEvent(kept)`.
  - **not** in a manual session (auto session live, or idle): all signals are no-ops.
  - `.paused` is fully inert.
  - **session-end mid-cycle** (§4.3): go `.away`, then the manual entry stops → next signal
    deactivates the monitor, enqueues `IdleEvent(unresolved)`, dismisses any prompt, and a later
    resume does **not** trim.
  - **discard after entry changed**: away on entry A, user stops A and starts B, then resolve
    discard → no trim of B; `IdleEvent(unresolved)`.
- `FanOutSignalReceiverTests` — forwards `tick`/`markAway`/`resume` to every receiver in order.
- Sign-out dismissal test extended to cover the manual away-prompt (guard reset + window
  dismissed) — in the manual-mode teardown path.

Existing `AutoTrackingCoordinatorTests` must stay green unchanged (the auto path is not modified).

## 7. Server behavior (verified, no change)

`apps/api/src/modules/idle-events/idle-events.repository.ts:24` documents the row as
"audit/analytics — no reconciliation of overlapping time entries," and upsert only sets
`endTime`/`resolvedAction`. The client is authoritative; manual **keep** emitting an
`IdleEvent(kept)` over a window a running entry already covers is safe (no server-side trim or
double-count). No API/contract change is required.

## 8. Out of scope

- No new user-facing setting for the manual idle threshold.
- No change to the server / API / contracts (see §7).
- No "discard and stop" variant — discard always continues tracking (confirmed).
- `ManualNudgeMonitor` is not modified — the while-away notification stays (keep-both).
- The separate gap that the client never refreshes the project list after launch is **not** part
  of this feature; it is a distinct fix the user also requested, tracked on its own branch.
