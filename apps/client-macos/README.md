# Nifty Timer macOS client

Swift 6 / SwiftUI + AppKit. Outside the pnpm graph — built with Xcode.

## Hard constraints (PRD §3, §4 — not backlog items)

- `App/StatusItemController` is always visible. There is no build flag, config
  key, or API response that can hide it. There is no stealth target.
- `Policy/AckGate` sits between EVERY capture path and the hardware APIs.
  If `monitoringAckAt` is null, capture cannot start. Not "should not" — cannot.
  Do not turn this into a scattered runtime `if`; it is a structural gate.
- `Activity/EventCounter` counts keyboard and mouse events. It has no code path
  that reads key content. If a task appears to need key content, it is a misread
  task — ask.
- No webcam, no audio, no GPS, no clipboard content.

## Structure

Sources/TimeTrack/
App/ AppDelegate · StatusItemController
Tracking/ TimeTracker · WorkspaceObserver · IdleMonitor
Capture/ ScreenshotScheduler · ScreenCaptureKitGrabber · ScreenshotUploader · ScreenRecordingPermission
Activity/ EventCounter (counts only) · Categorizer
Sync/ SyncEngine · UploadQueue · BackoffPolicy
Storage/ GRDB buffer — 24h capacity, UUIDv7 keys
Policy/ PolicyClient · AckGate
UI/ MenuBarView · MyDataView (employee self-view) · SettingsView

## Permissions required

**Screen Recording — the only TCC grant.** It covers screenshot capture and window
titles (`kCGWindowName` comes back empty without it; `Activity/AppSampler` degrades to
nil rather than blocking). Capture also needs the policy acknowledged — see `AckGate`.

Not Accessibility, not Input Monitoring. `Activity/EventCounter` reads
`CGEventSource.counterForEventType` and idle detection reads
`secondsSinceLastEventType` — passive counters, no event tap, which is why
counts-not-content is enforced by the API choice and not just by policy.

Local notifications ask separately at first launch; denied is a silent no-op
(`Notifications/LocalNotifier`), so the nudges just don't fire.

## Auto-start

`autoStartOnLogin` is a **team setting** (`TeamSettings`, default off, edited by an admin
in the dashboard) that rides `EffectivePolicy` to the client and does two things.

It selects the tracking mode: on, `Tracking/WorkspaceObserver` starts tracking on
active-app and auto-stops on idle; off, tracking is manual and
`Tracking/ManualNudgeMonitor` runs instead. Exactly one idle poller per mode.

And it owns the login item (`Policy/LoginItem`), because a menu bar app cannot start
tracking on a Mac that never opened it. On, the app registers itself through
`SMAppService.mainApp`; off, it unregisters. There is no LaunchAgent in the bundle and
nothing hidden: the item shows in System Settings › General › Login Items, macOS
announces it when it is added, and an employee who switches it off there is left alone —
that lands the item in `.requiresApproval`, which the client never re-registers over.

Registration only runs while the app is open, so flipping the toggle reaches an employee
at their **next** login, not the one already in progress. The settings page says so.

## Inactivity timeout

`idleThresholdMinutes` does more than drive a nudge: it is the point at which a session
stops. Both modes now bound unattended time, but they answer the idle minutes differently.

**Auto** (`Tracking/IdleMonitor`) closes the span at the away-start — every idle minute is
trimmed — and offers the window back on return through the keep/discard prompt.

**Manual** (`Tracking/ManualIdleMonitor`) closes it at `awayStart + threshold`, so the
minutes up to the timeout stay on the entry and are recorded as a KEPT idle window for the
Idle panel. Everything after the timeout is untracked, and there is no prompt on return —
policy has already decided, so there is nothing left to adjudicate. The person restarts the
timer themselves. Sleep and screen lock stop at the instant input stopped, crediting no idle
minutes: a closed lid is not a long read.

Manual tracking used to run straight through the away window and KEEP it unless the employee
came back and discarded it. A Mac left awake produced a 47-hour span whose start day reported
50h tracked out of a possible 24. Time Doctor's equivalent is its "Timeout After" setting
(default 15 min, max 6 h) — same shape, except we reuse the idle threshold rather than adding
a second knob.

Inactivity is measured from when the monitor armed, not from the raw OS idle counter: that
counter keeps running across a Stop/Start, and an inherited reading would close a new span
the moment it opened.

`SMAppService.mainApp` registers **whichever bundle is running**, and `status` is
per-bundle. On a machine with both `Nifty Timer.app` and `Nifty Timer Dev.app` installed,
each one sees itself as unregistered and will register itself — so opening the dev build
against a policy with auto-start on puts a _second_ entry in Login Items. Check there
after testing with both installed.
