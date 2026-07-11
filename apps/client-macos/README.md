# TimeTrack macOS client

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
  App/        AppDelegate · StatusItemController
  Tracking/   TimeTracker · WorkspaceObserver · IdleMonitor
  Capture/    ScreenshotCapturer (ScreenCaptureKit)
  Activity/   EventCounter (counts only) · Categorizer
  Sync/       SyncEngine · UploadQueue · BackoffPolicy
  Storage/    GRDB buffer — 24h capacity, UUIDv7 keys
  Policy/     PolicyClient · AckGate
  UI/         MenuBarView · MyDataView (employee self-view) · SettingsView

## Permissions required

Screen Recording, Accessibility (window titles + idle detection).
Ship as a LaunchAgent for auto-start on login (default OFF).
