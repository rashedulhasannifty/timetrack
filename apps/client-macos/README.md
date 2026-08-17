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
in the dashboard) that rides `EffectivePolicy` to the client. It selects the tracking
mode, not a login item: on, `Tracking/WorkspaceObserver` starts tracking on active-app
and auto-stops on idle; off, tracking is manual and `Tracking/ManualNudgeMonitor` runs
instead. Exactly one idle poller per mode.

The app does not register itself as a macOS login item — there is no `SMAppService` call
and no LaunchAgent in the bundle. Launching at login is the user's own System Settings
choice today.
