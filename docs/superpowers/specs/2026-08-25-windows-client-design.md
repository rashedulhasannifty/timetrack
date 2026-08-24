# Native Windows client — Nifty Timer for Windows

Design doc · 2026-08-25 · covers slices S1–S4, each of which gets its own plan and PR.

## Context

Nifty Timer today is a macOS-only menu bar client (`apps/client-macos`, Swift, 79 files / ~7.6k lines / 59 test files) talking to a NestJS `/v1` API and a Next.js dashboard. Windows-using employees have no client at all, so their time is either untracked or entered by hand in the dashboard.

The backend is **already platform-agnostic**: there is no `Device` model, no `platform`/`os` column, no platform enum, no user-agent inspection, and no version gating anywhere in `apps/api`. The macOS-ness lives entirely in client code, in a few `TeamSettings` seed defaults, and in dashboard copy. So a Windows client is additive — it reuses `/v1` and the existing dashboard unchanged on the wire.

Two things are _not_ free, and this design handles both:

1. **Shipping Windows can regress the Mac product.** GitHub has one `releases/latest` per repo. `UpdateFeed` requires an asset literally named `NiftyTimer-pilot.zip` on it, and `MacDownloadPlate.DOWNLOAD_URL` resolves through it. A Windows release published to the same repo becomes `latest` → installed Mac clients go silently blind to updates and the dashboard download button 404s.
2. **"Counts, not content" changes character on Windows.** On macOS `CGEventSource.counterForEventType` _physically cannot_ return key identity. On Windows, Raw Input can. The invariant stops being enforced by the API and has to be enforced by structure. This is the one place the Windows client is structurally weaker than the Mac one, and it is called out rather than buried.

Outcome: a Windows employee installs Nifty Timer, acknowledges the monitoring policy, and produces time entries, idle events, activity samples and screenshots indistinguishable from a Mac client's — with the same always-visible indicator and the same acknowledgement gate.

---

## Decisions locked

| Decision                          | Choice                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Stack                             | **C# / .NET 9 + WPF**, tray via Win32 `Shell_NotifyIcon`                                                                                   |
| Product name                      | **Nifty Timer** (same as macOS)                                                                                                            |
| Phasing                           | **4 slices**, each its own spec → plan → PR                                                                                                |
| Concurrent Mac+Windows tracking   | **Not supported** — client-side 409 UX only, no backend change                                                                             |
| Code signing                      | **Unsigned pilot**, signing step wired as a no-op until a cert exists                                                                      |
| Browser-URL categorization        | **Cut from v1** (documented gap — see Known gaps)                                                                                          |
| `platform`/`Device` schema column | **Not added** — out of scope, would touch frozen `/v1`                                                                                     |
| Distribution                      | **Separate GitHub distribution repo** for Windows assets                                                                                   |
| Commit scope                      | `client` (matches CLAUDE.md §0 enum; the commit-msg hook regex `[a-z-]+` would also accept `client-windows`, but the documented enum wins) |

### Dependency policy

The Swift client has **zero** third-party dependencies by CLAUDE.md §2 policy. The Windows client mirrors that. Planned NuGet packages:

- `Microsoft.Windows.CsWin32` — build-time source generator for Win32 P/Invoke signatures. Ships no runtime assembly.
- `Microsoft.Windows.SDK.BuildTools` — pulled transitively by CsWin32 for WinRT projections (Windows Graphics Capture).
- `xunit` / `xunit.runner.visualstudio` (test project only).

**Nothing else without asking**, per CLAUDE.md §2. In particular: no Hardcodet.NotifyIcon (hand-roll `Shell_NotifyIcon`), no Serilog, no Refit, no SQLite/EF.

---

## Non-negotiable invariants

From CLAUDE.md §1 and PRD §3/§4. A build that violates any of them does not ship.

1. **`AckGate` is a structural gate, not a boolean.** Port it as a closure-taking gate, exactly as `apps/client-macos/Sources/TimeTrack/Policy/AckGate.swift` does:

   ```csharp
   Task<T> WithCaptureAllowedAsync<T>(Func<Task<T>> body);
   ```

   It fetches `GET /v1/policy/effective` on every call, throws `AckGateException.NotAcknowledged` when `ackRequired`, publishes the policy to `LivePolicy` _before_ invoking the body, and fails **closed** on any error (offline, 401, malformed). No admin override, no debug flag. Six call sites mirror the Mac ones: 2 idle-poller installs, screenshot install, activity install, and the per-tick re-check inside the screenshot scheduler and the activity sampler.

2. **Preserve the `AckMarker` asymmetry.** An offline launch with a stored `ackedPolicyVersion:{userId}` marker re-enables **manual time tracking only**. It must remain _structurally impossible_ to reach capture offline — capture installers exist only on the online `!ackRequired` branch, never in the offline `catch`. This is the easiest thing to lose in a rewrite; it gets its own test.

3. **Counts, never content.** `EventCounter` is the only input-adjacent code. It uses **Raw Input** (`RegisterRawInputDevices` + `WM_INPUT`) on a dedicated message-only window. The native boundary discards `RAWKEYBOARD.VKey` / `MakeCode` inside the message handler — the interface crossing into the rest of the app is:

   ```csharp
   interface IInputCounting { long KeyEvents { get; } long PointerEvents { get; } }
   ```

   Two `long` counters and nothing else. No key identity, no scancode, no text, no window handle ever leaves that type. A test asserts the interface surface (reflection over `IInputCounting` members) so a future field addition fails CI.
   Do **not** implement the global hotkey through this path — use `RegisterHotKey`, which sees only the one combination.

4. **Always-visible indicator, no kill switch.** The tray icon is created before any capture subsystem is installed and cannot be hidden by config, policy, build flag, or command-line switch. Three states: idle / tracking / capturing-flash. There is no build target that removes it.

5. **Nothing added that CLAUDE.md §1 forbids:** no stealth mode, no webcam/audio/GPS/clipboard capture, no keystroke content, no way to make screenshots readable to a manager but not the employee.

6. **Capture never ships before the gate and indicator.** Phasing is ordered to make this automatic — S1 delivers gate + indicator + manual tracking; the first capture code lands in S3.

---

## Architecture

`apps/client-windows/` — outside the pnpm graph, exactly like `apps/client-macos`. `pnpm-workspace.yaml` enumerates apps explicitly (no `apps/*` glob), so **no changes are needed** to `pnpm-workspace.yaml`, `turbo.json`, or `tsconfig.base.json`.

```
apps/client-windows/
├── NiftyTimer.sln
├── README.md
├── SIGNING.md
├── src/NiftyTimer/
│   ├── NiftyTimer.csproj          net9.0-windows10.0.19041.0, WinExe, self-contained
│   ├── App/                       App.xaml · TrayIconController · MenuViewModel
│   │                              AutoTrackingCoordinator · ManualIdleCoordinator
│   │                              GlobalHotKey · AppInstall · BuildStamp
│   ├── Auth/                      AuthClient · AuthSession · TokenStore(DPAPI) · JwtDecoder · LoginWindow
│   ├── Policy/                    AckGate · AckClient · AckMarker · AckWindow · LivePolicy · PolicyClient
│   ├── Tracking/                  TimeTracker · IdleMonitor · ManualIdleMonitor · ManualNudgeMonitor
│   │                              SessionObserver · DistractionMonitor · DailyTotalAccumulator
│   │                              IdleEventPayload · LiveSpanRecovery · UuidV7
│   ├── Capture/                   ScreenshotScheduler · DisplayGrabber(WGC) · ScreenshotUploader
│   ├── Activity/                  ActivitySampler · ActivitySample · ActivitySampleStore
│   │                              ActivityRateMeter · AppSampler · EventCounter · Categorizer
│   ├── Storage/                   BufferStore · ImageBufferStore · LiveSpanStore
│   ├── Sync/                      SyncEngine · ScreenshotSyncEngine · ActivityBatchSyncEngine
│   │                              TimeEntryUploader · ActivitySampleUploader · LiveEntryPublisher
│   │                              BackoffPolicy · TimeEntryPayload
│   ├── Projects/                  Project · ProjectCache · ProjectClient · SelectionStore · SelectionResolver
│   ├── Notifications/             LocalNotifier(toast) · EndOfDayScheduler · FallbackDistractionNotifier
│   ├── Update/                    UpdateFeed · UpdateCoordinator · UpdateInstaller · UpdateStatus · AppVersion
│   ├── Reports/                   SelfTotalsClient
│   └── UI/                        TrayPopupWindow · TimePromptWindow · AwayResolutionWindow
│                                  RecoveryWindow · DistractionNudgeWindow · BrandMark · Tokens
├── tests/NiftyTimer.Tests/        xUnit — mirrors Tests/TimeTrackTests/ file-for-file
│   └── Support/                   Fake* + Spy* (no mocking framework, same as Swift)
└── scripts/                       build.ps1 · package-app.ps1 · package-dev-app.ps1
                                   sign.ps1 · release-assets.ps1
```

**Naming maps 1:1 to the Swift tree on purpose.** When a bug is fixed in one client, the corresponding file in the other is obvious.

### Testability pattern to preserve

Every Swift type injects `clock: () -> Date`, `idGen:`, and `sleep:` closures, and every hardware touch sits behind a one-method protocol. That is what makes 59 test files possible with zero mocking framework. Port it directly:

| Swift protocol                                   | C# interface                                 |
| ------------------------------------------------ | -------------------------------------------- |
| `PolicyProviding`                                | `IPolicyProvider`                            |
| `DisplayGrabbing`                                | `IDisplayGrabber`                            |
| `InputCounting`                                  | `IInputCounting`                             |
| `AppSampling`                                    | `IAppSampler`                                |
| `Uploading`                                      | `IUploader`                                  |
| `TimeEntryBuffering` / `ActivitySampleBuffering` | `ITimeEntryBuffer` / `IActivitySampleBuffer` |
| `LiveSpanRecording`                              | `ILiveSpanRecorder`                          |
| `LocalNotifying`                                 | `ILocalNotifier`                             |

Constructor-inject `Func<DateTimeOffset> clock` and `Func<DateTimeOffset, string> idGen` everywhere the Swift code does.

### Platform API mapping

| macOS                                               | Windows                                                                                                                | Where                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| ScreenCaptureKit `SCScreenshotManager`              | `Windows.Graphics.Capture` (WGC) + `Direct3D11CaptureFramePool`                                                        | `Capture/DisplayGrabber.cs`      |
| `CGMainDisplayID` / display ordering                | `EnumDisplayMonitors` + `GetMonitorInfo`; primary first, then by device name                                           | `Capture/DisplayGrabber.cs`      |
| `NSBitmapImageRep` JPEG q=0.6                       | WIC `JpegBitmapEncoder`, `QualityLevel = 60`                                                                           | `Capture/DisplayGrabber.cs`      |
| `CGPreflightScreenCaptureAccess`                    | **no analogue** — no TCC for capture on Windows; the whole permission-warning surface collapses                        | —                                |
| `CGEventSource.counterForEventType`                 | **Raw Input** (`WM_INPUT`), counters only                                                                              | `Activity/EventCounter.cs`       |
| `CGEventSource.secondsSinceLastEventType`           | `GetLastInputInfo`                                                                                                     | `Tracking/SessionObserver.cs`    |
| `NSWorkspace.frontmostApplication`                  | `GetForegroundWindow` → `GetWindowThreadProcessId` → `QueryFullProcessImageName`                                       | `Activity/AppSampler.cs`         |
| `CGWindowListCopyWindowInfo` / `kCGWindowName`      | `GetWindowText` (no permission needed)                                                                                 | `Activity/AppSampler.cs`         |
| `NSWorkspace` sleep/wake notifications              | `WM_POWERBROADCAST` (`PBT_APMSUSPEND` / `PBT_APMRESUMESUSPEND`)                                                        | `Tracking/SessionObserver.cs`    |
| `com.apple.screenIsLocked`                          | `WTSRegisterSessionNotification` → `WTS_SESSION_LOCK` / `UNLOCK`                                                       | `Tracking/SessionObserver.cs`    |
| Keychain                                            | **DPAPI** `ProtectedData.Protect(scope: CurrentUser)`, ciphertext at `%LOCALAPPDATA%\NiftyTimer[-variant]\refresh.bin` | `Auth/TokenStore.cs`             |
| `UNUserNotificationCenter`                          | `ToastNotificationManager` with an AUMID registered by a Start Menu shortcut                                           | `Notifications/LocalNotifier.cs` |
| `NSStatusItem` + `NSPopover`                        | `Shell_NotifyIcon` + a borderless WPF `Window`, `ShowInTaskbar=false`, `Topmost`, closed on deactivate                 | `App/TrayIconController.cs`      |
| Carbon `RegisterEventHotKey`                        | `RegisterHotKey` (⌥⌘T → **Ctrl+Alt+T**)                                                                                | `App/GlobalHotKey.cs`            |
| `Security` designated-requirement check             | `WinVerifyTrust` + publisher thumbprint compared to the running module's                                               | `Update/UpdateInstaller.cs`      |
| `ditto` + `/bin/sh` swap script                     | detached updater `.exe`: wait-for-PID → rename aside → move in → rollback → relaunch                                   | `Update/UpdateInstaller.cs`      |
| `~/Library/Application Support/TimeTrack[-variant]` | `%LOCALAPPDATA%\NiftyTimer[-variant]\`                                                                                 | `App/AppInstall.cs`              |
| `Info.plist` `TimeTrackAPIBaseURL`                  | `appsettings.json` rewritten at package time                                                                           | `App/AppInstall.cs`              |

`NSAppleScript` browser-URL reading has **no port** — see Known gaps.

---

## Slices

Each slice is a separate spec → plan → PR. The macOS client was built the same way; its specs (`2026-07-13-slice-1.7a-client-auth-ack-design.md`, `-1.7b-`, `-1.7c-`, `-1.7d-`, `2026-07-13-client-crash-durability-design.md`, `2026-07-14-slice-idle-events-design.md`, `2026-07-17-slice-2.2b-client-capture-design.md`, `2026-07-18-slice-2.3b-client-activity-capture-design.md`) are the behavioural source of truth for the state machines and should be read before writing each Windows spec.

### S1 — Foundation: auth, gate, indicator, manual tracking, sync

**Ships:** an employee can sign in, acknowledge the monitoring policy, and track time manually from the tray, with offline buffering and reliable sync. No capture of any kind exists in this build.

- Solution scaffold, `AppInstall` (variant-aware container under `%LOCALAPPDATA%`), `BuildStamp`, `appsettings.json` config read.
- `Auth/`: `AuthClient` (`POST auth/login`, `auth/refresh`), `AuthSession`, `TokenStore` (DPAPI), `JwtDecoder` (base64url payload only, no signature verification — the API verifies).
  - **Single-flight refresh** — port the Swift actor's shared in-flight `Task` using a `SemaphoreSlim` + cached `Task<string>`. Two concurrent refreshes more than 10s apart trip server-side reuse detection and revoke the whole token family.
  - Only a **401** clears the stored refresh token. Offline / 5xx / 429 → `Offline`, token retained. (Laptops waking before Wi-Fi associated were being permanently signed out on macOS — this was a real bug.)
  - Mirror `auth.lastUserId` to app settings; an offline launch has no access token to decode.
- `Policy/`: `PolicyClient` (`GET policy/effective`), `AckGate`, `AckMarker`, `LivePolicy` (lock-guarded snapshot), `AckClient` (`POST users/{ownSub}/ack-monitoring`), `AckWindow`.
- `App/TrayIconController` + `UI/TrayPopupWindow`: always-visible icon, 3 states, dropdown with start/stop/pause/resume, note field, project/task picker with search, day/week/month totals, pending-sync count, My Data (opens dashboard `/me`), Sign Out, Quit, build stamp.
- `Tracking/TimeTracker` + `UuidV7` (RFC 9562: 48-bit big-endian ms · version nibble · variant · random). Pause closes the entry; resume opens a new one. `end = max(end, start)` clamp survives a backwards clock step.
- `Storage/BufferStore`: file-per-record, `<createdMs>__<kind>__<uuidv7>.json`, write-to-`.tmp-<id>`-then-rename, startup `.tmp-*` sweep, 7-day prune. **The filename is the index** — FIFO order, kind, identity and time all read from a directory listing, which is what makes the menu's pending count cheap.
- `Sync/SyncEngine` (90s self-rescheduling timer), `TimeEntryUploader`, `BackoffPolicy`, `LiveEntryPublisher` (60s heartbeat re-POST of the open entry).
- `Projects/`: `ProjectClient` (`GET projects`), `ProjectCache`, `SelectionStore`, `SelectionResolver`, `RecentSelectionClient`.
- `Reports/SelfTotalsClient` (`GET reports/my-totals`).

#### 409 conflict — the only net-new state machine in the port

Everything else in this port is logic already covered by 59 Swift tests. This is not, so it is specified in full.

`POST /v1/time-entries` returns **409** (`type: .../errors/conflict`) when the user already has a _fresh_ running entry on another machine — the partial unique index `time_entries_one_running_per_user` allows exactly one open entry per **user**, not per device. It arrives from `LiveEntryPublisher` **asynchronously, after** `TimeTracker` has already flipped to running and the user is watching the clock tick. So local state must be rolled back:

1. Stop the clock; surface "Already tracking on another machine — stop it there first."
2. Clear `live-span.json`. The span never existed server-side, and leaving it would fire a bogus crash-recovery prompt on next launch.
3. Enqueue **nothing**. The Mac discard path writes a zero-duration entry specifically to release the server's unique index; here the index is held by the _other_ machine's entry, so a zero-duration row would be a fabricated record serving no purpose.
4. **Short-circuit** `LiveEntryPublisher`'s 3-consecutive-failure "not recording" warning. A 409 is a definite answer, not a flaky link — routing it through the transient counter would show the wrong message twice before the right one.

Classified as **permanent** in `Classify`, not transient. Verified safe: the partial index is `WHERE "endTime" IS NULL` (`packages/db/prisma/migrations/20260712104238_add_running_entry_partial_unique_index/migration.sql`) and `BufferStore` only ever holds closed spans — `TimeTracker` enqueues on close, and idle-bridge entries are closed too. So a _buffered_ entry can never 409, and "permanent means drop" cannot silently lose tracked time.

**Tests:** `AuthSessionTests` (incl. single-flight), `JwtDecoderTests`, `AckGateTests` (open/closed/fail-closed/policy-published-before-body), `AckMarkerTests`, **`OfflineCaptureUnreachableTests`** (asserts the offline branch installs no capture subsystem), `LivePolicyTests`, `PolicySettingsDecodeTests` (asserts _every_ field of a full server body — the Mac client silently dropped `distractionAlertsEnabled` for a whole release without this), `TimeTrackerTests`, `BufferStoreTests`, `SyncEngineTests`, `BackoffPolicyTests`, `TimeEntryUploaderTests` (incl. the `Classify` table and the 409 rollback), `TimeEntryPayloadTests` (JSON null/omit rules), `UuidV7Tests`, `MenuViewModelTests`, `AppInstallTests`, `ProjectCacheTests`, `SelectionStoreTests`, `SelectionResolverTests`.

### S2 — Idle detection, away resolution, crash recovery

- `Tracking/IdleMonitor` — port the pure state machine (`inactive → active → away → awaiting`) verbatim from `apps/client-macos/Sources/TimeTrack/Tracking/IdleMonitor.swift`; it has no platform surface beyond the idle-seconds scalar.
- `SessionObserver`: `GetLastInputInfo`, plus `WM_POWERBROADCAST` and `WTS_SESSION_LOCK/UNLOCK` → mark away **immediately**, without waiting for the threshold.
- Two mutually-exclusive modes keyed on the team setting `autoStartOnLogin` (note: this selects tracking _mode_, it is **not** a login item): auto (`AutoTrackingCoordinator`) vs manual (`ManualNudgeMonitor` + `ManualIdleCoordinator`). Exactly one idle poller per mode.
- `UI/AwayResolutionWindow` — keep/discard prompt; **discard is the default action** (PRD §6.1). Keep writes a bridge `TimeEntry` over the away window; discard trims it; teardown-while-away writes `UNRESOLVED`. All three emit an `IdleEvent` → `POST idle-events`.
- `Storage/LiveSpanStore` (`live-span.json`, 60s heartbeat) + `LiveSpanRecovery` + `UI/RecoveryWindow`. Recovery is **userId-gated**: a span belonging to a different user is cleared without enqueuing. Keep closes at `lastAlive`, never counting downtime.
- Launch-at-login: **out of scope**, matching macOS (which has no `SMAppService` registration; it is the user's own OS setting).

**Tests:** `IdleMonitorTests`, `ManualIdleMonitorTests`, `ManualIdleCoordinatorTests`, `ManualNudgeMonitorTests`, `AutoTrackingCoordinatorTests`, `LiveSpanStoreTests`, `LiveSpanRecoveryTests`, `LiveEntryPublisherTests`, `IdleEventPayloadTests`, `DailyTotalAccumulatorTests`.

### S3 — Capture: screenshots, activity sampling, categorization

**This is the first slice where capture code exists.** It cannot start before S1's gate and indicator are merged.

- `Activity/EventCounter` — Raw Input, counters only, per invariant §3.
- `Activity/AppSampler` — foreground process + window title. Title gated on the policy flag `captureWindowTitles`; truncate title to 120 chars, app name to 200.
- `Activity/ActivitySampler` — 60s window in 12 sub-buckets; a bucket is "active" if any key **or** pointer event occurred; `activityPct = active/12 * 100`. Contiguous windows when measuring, full-interval backoff when skipped. `ACTIVITY_SAMPLE_INTERVAL_SECONDS = 60` is mirrored by convention (the client can't import TypeScript).
- `Activity/Categorizer` — port the rules exactly: site and app lists are separate; host wins over app; most-specific site term wins by suffix-length scoring; ties → `UNPRODUCTIVE`; app rules match `bundleId` **or** display name, exact and case-insensitive; `UNPRODUCTIVE` wins on overlap. With no host resolver on Windows the site path never fires and app rules apply cleanly.
- **`bundleId` convention — decide once, it is permanent.** `ObservedAppsSchema` surfaces whatever the client sends into the admin rule picker, so an inconsistent convention pollutes the admin UI forever. **Send the lowercased executable filename without extension** (e.g. `code`, `chrome`, `devenv`) as `bundleId`, and the process's `FileDescription` (falling back to the filename) as `appName`. Full paths vary per machine and would fragment the picker; AUMIDs are absent for most Win32 apps. Document in the client README and the S3 spec.
- `Capture/DisplayGrabber` (WGC) + `ScreenshotScheduler` — interval from policy; **every attached display** per tick under one shared `captureGroupId` with `displayIndex`/`displayCount`, deterministically ordered (primary first). JPEG q=0.6 at native pixel resolution (per-monitor DPI aware). Only while the clock is running. Partial success is success — one flaky external monitor must not kill the desk.
- `Storage/ImageBufferStore` + `ActivitySampleStore`; `Sync/ScreenshotSyncEngine` (≤20/cycle) and `ActivityBatchSyncEngine` (**one** batch of ≤500/cycle — deliberately one, so a failed delete can't spin a re-take loop).
- Local file deleted **only** after confirmed upload (PRD §6.2).

**Tests:** `EventCounterBoundaryTests` (interface surface assertion), `ActivitySamplerTests`, `ActivityRateMeterTests`, `AppSamplerTests`, `CategorizerTests`, `ScreenshotSchedulerTests` (incl. gate re-check per tick), `ImageBufferStoreTests`, `ActivitySampleStoreTests`, `ScreenshotSyncEngineTests`, `ActivityBatchSyncEngineTests`, `ScreenshotUploaderTests` (**multipart field-order assertion**), `ActivitySampleUploaderTests`. `DisplayGrabber` itself is build-verified only, matching the Swift `ScreenCaptureKitGrabber`.

### S4 — Notifications, hotkey, updater, packaging, dashboard

- `Notifications/LocalNotifier` — Windows toasts via an AUMID registered by a Start Menu shortcut created at install. Four nudges: idle, forgot-to-start (10 min), end-of-day summary (18:00), distraction. Denied/disabled notifications are a silent no-op; the distraction nudge alone falls back to a visible in-app window.
- `App/GlobalHotKey` — `RegisterHotKey`, **Ctrl+Alt+T**.
- `Update/` — `UpdateFeed` polls `https://api.github.com/repos/{repo}/releases/latest` unauthenticated every 6h + on menu-open throttled to 30 min (no token ships in a binary on employee laptops); `rateLimited` collapses silently to unknown-or-current. `UpdateEvaluator` escalates available → overdue after a 7-day grace. `UpdateInstaller` gates the swap on **two independent checks**: published SHA-256, and Authenticode publisher identity matching the running module's (once signing exists; the unsigned pilot enforces SHA-256 only and refuses a signed→unsigned or cross-publisher transition). Gated on `AppInstall.IsProduction`. **Nothing in the update path can stop tracking** — the strongest state is a visible warning.
- `scripts/package-app.ps1` — self-contained `dotnet publish -r win-x64`, rewrite `ApiBaseUrl` / `DashboardUrl` / app id into `appsettings.json`, default to **production** (`https://timer.niftyitsolution.com/v1`; the `/v1` suffix is load-bearing — Caddy routes `/v1/*`), copy tray icon assets **by explicit name** so a rename is a build failure. `package-dev-app.ps1` produces a side-by-side "Nifty Timer Dev" install with its own `%LOCALAPPDATA%` container and localhost URLs — sharing state is _lossy_, not untidy, since both processes drain the same buffers.
- `scripts/sign.ps1` — `signtool sign /fd SHA256 /tr <rfc3161> /td SHA256`. **No-op with a warning when no cert env vars are present**, so the pipeline works today and switches on later without rework. `SIGNING.md` documents the cutover and the SmartScreen reputation caveat.
- `scripts/release-assets.ps1` — produce `NiftyTimer-windows-pilot.zip` + `.sha256` sidecar. **Both names are contract** (`UpdateFeed` refuses a release with no matching digest). Tag `vX.Y.Z-windows-pilot`.
- `.github/workflows/client-windows.yml` — clone of `client.yml`: `runs-on: windows-latest`, path-filtered to `apps/client-windows/**` + the workflow itself, `concurrency` with `cancel-in-progress`, `defaults.run.working-directory: apps/client-windows`. Steps: `dotnet build -c Release` → `dotnet test` → `./scripts/package-app.ps1`.
- Sibling entries alongside `apps/client-macos` in **`eslint.config.mjs:89`** (`ignores`), **`.dockerignore`**, **`.gitignore`** (`apps/client-windows/{bin,obj,dist,publish}/`).

#### Dashboard work (`apps/dashboard`)

The dashboard must _serve_ Windows — several strings become factually wrong the day Windows ships.

- **New** `src/app/install/windows/page.tsx`. `src/app/install/page.tsx` is macOS-only end to end (the `xattr -dr com.apple.quarantine` command, Gatekeeper "Open Anyway", `pgrep` troubleshooting) and **cannot be genericised in place**. Move it to `src/app/install/macos/page.tsx` and make `/install` a short platform chooser; `/install` must keep working since it is already advertised. Reuse `MarketingChrome.tsx` (`Section`, `SpecPlate`, `Prose`) and `CopyCommand.tsx` — both platform-neutral. Cover the SmartScreen "More info → Run anyway" flow for the unsigned pilot.
- **New** `src/components/marketing/WindowsDownloadPlate.tsx` alongside `MacDownloadPlate.tsx`, exporting its own `DOWNLOAD_URL` pointing at the Windows distribution repo. Do not change `MacDownloadPlate`'s constants.
- `src/app/page.tsx` — metadata description, "Self-hosted · macOS + web" → "macOS, Windows + web", the "Download for Mac" CTA → two buttons, "A menu bar app on each Mac…" copy, the `['Client', 'Swift 6, SwiftUI and AppKit — macOS 14…']` spec row, and the `<Section eyebrow="Download" title="macOS client — pilot build">` heading.
- `src/app/(app)/overview/page.tsx:353,361` — "Numbers appear here as soon as someone starts the Mac app" and the "Install the Mac app" button → platform-neutral, pointing at `/install`.
- `src/app/(app)/admin/settings/SettingsForm.tsx:187` — "Applies to every macOS client on this team." → "every client on this team".
- **`TeamSettings` seed defaults are macOS-shaped** (`packages/contracts/src/team-settings.ts:94-127`: `Terminal`, `iTerm2`, `Warp`, `Ghostty`, `Xcode`, `us.zoom.xos`). Windows users get everything `NEUTRAL` until an admin edits the lists. Add Windows equivalents (`windowsterminal`, `powershell`, `devenv`, `code`, `zoom`, `teams`, `outlook`, `explorer`) to the seed defaults. This is a contracts change; it needs its own commit and does **not** alter any request/response shape.

#### Docs

- `PRD.md` — §1 target platforms, §2 stack table (add the Windows client row), a new §7.1.8 `apps/client-windows` tree, and §13: the single-device assumption now has a stated resolution (409 UX).
- `CLAUDE.md` — §1 add the counts-not-content structural note for Raw Input; §3 layout add `apps/client-windows` (Swift and C#, both outside the pnpm graph).
- `docs/ROADMAP.md` — add the Windows workstream.
- `docs/deployment.md:284` and `docs/PREREQUISITES.md:26,88-92` still describe **Sparkle/appcast, which was abandoned** — correct them to the GitHub-releases + SHA-256 + signature-check mechanism actually shipped, and document both platforms.

---

## Distribution — the Mac-regression trap

**Publish Windows assets to a separate GitHub distribution repo** (e.g. `rashedulhasansojib/niftytimer-windows`).

Why this and not the alternatives: `GitHubReleaseFeed.repo` is already injectable and `release-assets.sh` already takes `--repo`, so this requires **zero change to already-shipped Mac clients**. The alternative — switching `UpdateFeed` from `/releases/latest` to a filtered `/releases` query — would require shipping a Mac update to fix a Windows-caused problem, and the Mac update path is precisely what is currently degraded (expired Apple Developer membership, unnotarized pilot). Combined per-tag releases carrying both platforms' assets would work but couples the two release cadences permanently.

Consequence: the Windows `UpdateFeed` points at the Windows repo, `WindowsDownloadPlate.DOWNLOAD_URL` points at the Windows repo, and nothing about the Mac update path or download button changes.

---

## Wire contract — details that are easy to lose in a rewrite

All confirmed against `apps/api` and the shipped Swift client. Getting any of them wrong produces a client that appears to work and silently loses data.

- **Status classification** — one shared pure function:
  `200..299 → Success` · `401 → AuthFailed` · `408, 429 → Transient` · `500..599 → Transient` · `400..499 → Permanent(status)` (record **dropped**, so poison can't wedge the queue) · default → Transient.
  Narrowing the success range to `200 || 201` is what previously wedged the activity buffer. `POST activity-samples/batch` and `POST idle-events` return **201, not 202**, and the API pins that deliberately.
- **Heartbeat is a re-POST, not an endpoint.** No `/heartbeat` route exists. Re-POST the same open entry (same `id`, `endTime` omitted) to `POST /v1/time-entries`; the server stamps `heartbeatAt`. `TRACKING_FRESHNESS_SECONDS` defaults to **300**; the Mac client heartbeats at **60**. Miss the window and live time is silently truncated by every reporting query.
- **Strict body validation.** Request bodies parse in Zod strict mode — **any unexpected field is a 422**. Do not add a helpful `platform`, `deviceId`, `clientVersion`, or `os` field to any body. (Query/route params are non-strict; multipart fields are picked by name so extras are ignored.)
- **JSON null vs omit.** `.nullable()` fields must serialize as explicit `null`; `.optional()` fields must be **omitted**. In `System.Text.Json` that means default `JsonIgnoreCondition.Never` with `[JsonIgnore(Condition = WhenWritingNull)]` on `note` **only** — `projectId`, `taskId`, `endTime`, `bundleId`, `windowTitle` must all emit `null`. This bit the Swift client (synthesized `Codable` uses `encodeIfPresent`) and needs its own test.
- **Multipart field order.** Text fields (`id`, `timestamp`, then optional `captureGroupId`, `displayIndex`, `displayCount`) **must precede** the file part — `@fastify/multipart`'s `req.file()` only exposes fields parsed before the file. `MultipartFormDataContent` preserves add order; assert it with a test. Never send `userId` — the server attributes by token.
- **Timezone.** `APP_TIMEZONE = 'Asia/Dhaka'`. Every day/week/month boundary in the product is a Dhaka calendar day, not UTC and not the machine's local zone. Do no local date math — `SelfTotalsSchema` returns `day`, `weekStart`, `monthStart` explicitly so the client can label rows without it.
- **Limits.** JSON body 10 MB; multipart exactly 1 file, 10 MB (truncation → 413); activity batch 1–500 samples; `note` ≤2000, `windowTitle` ≤120, `appName` ≤200, `bundleId` ≤255.
- **Rate limit.** Flat **100 req/min keyed on `req.ip`** with no per-route overrides, shared across every client behind one NAT'd office IP. A second client fleet doubles the pressure, 429 classifies as transient, and the Swift `BackoffPolicy.jitter` **defaults to the identity function** — so a whole office retries in lockstep. **Add real jitter to the Windows `BackoffPolicy`** (`min(300s, 5s · 2^failures)` with ±25% randomization) and file the server-side per-user-tracker concern as a follow-up rather than silently absorbing it.

### Sign-out teardown ordering — port verbatim

`CreateTimeEntry` carries no `userId`; the server attributes by token. So for each of the three buffers, in this order: **stop the timer first** (the draining guard is not atomic) → best-effort final drain on the **still-valid** token → **join any in-flight capture cycle** (a cycle suspended mid-grab is not cancelled by stop and could otherwise enqueue into a just-cleared buffer) → clear. Then clear the ack marker, the project cache, and the session. See `AppDelegate.flushAndClearBuffer` (`apps/client-macos/Sources/TimeTrack/App/AppDelegate.swift:740-775`) — that sequence encodes several real production bugs.

---

## Verification

Per slice, before claiming done:

```powershell
cd apps/client-windows
dotnet format --verify-no-changes
dotnet build -c Release
dotnet test
./scripts/package-app.ps1
```

At the repo root, for the dashboard/contracts/docs commits:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

**End-to-end, against a local stack** (`docker compose -f infra/docker-compose.yml up -d`, `pnpm dev`, `pnpm db:seed`), using a dev-packaged client pointed at `http://127.0.0.1:3001/v1`:

1. **Gate closed** — sign in as a user with `monitoringAckAt = NULL`. Confirm the tray icon appears, the ack prompt shows, and **no** screenshot or activity sample is ever produced (`%LOCALAPPDATA%\NiftyTimer-dev\screenshots` and `\activity` stay empty; no rows in the DB).
2. **Gate opens** — acknowledge; confirm `POST users/{id}/ack-monitoring` succeeds, an `AuditLog` row `user.ack_monitoring` is written, and capture begins on the next tick.
3. **Offline asymmetry** — stop the API, relaunch the client. Manual tracking must work; capture must be structurally absent. Restart the API and confirm the buffer drains.
4. **Round-trip** — track ~5 min with two monitors attached. Verify in the dashboard: the entry appears live and ticks (heartbeat), activity samples show a Windows app name and the chosen `bundleId` convention, and screenshots arrive as a group with `captureGroupId` + correct `displayIndex`/`displayCount`, transitioning `PENDING → READY`.
5. **Idle** — lock the workstation past the threshold; confirm away is marked immediately (not after the threshold), the keep/discard prompt appears on unlock with **discard** defaulted, and an `IdleEvent` is posted.
6. **Crash recovery** — kill the process mid-span; relaunch; confirm the recovery prompt, and that Keep closes at `lastAlive`.
7. **409 path** — start tracking on the Mac client, then start on Windows _within_ the freshness window. Confirm the rollback above: clock stops, message shown, `live-span.json` cleared, nothing enqueued, no "not recording" warning.
8. **Sign-out** — sign out mid-capture; confirm buffers flush then clear, and signing in as a second user uploads nothing belonging to the first.
9. **Counts-not-content** — with a network capture running, type a known string into Notepad and grep every outbound request body and every file under the client's `%LOCALAPPDATA%` container for it. Zero hits.
10. **Mac not regressed** — confirm the Mac client still resolves its update feed and `MacDownloadPlate.DOWNLOAD_URL` still returns the Mac zip after the first Windows release is published.

---

## Known gaps, stated explicitly

- **Stale retirement makes the 409 only one of two outcomes, and the other is silent.** Opening an entry first _retires_ the user's stale open entries at `COALESCE(heartbeatAt, startTime)` (`time-entries.repository.ts:97-112`). So when the Mac client has not heartbeated inside `TRACKING_FRESHNESS_SECONDS` (300s default — lid closed, no Wi-Fi), the Windows start **succeeds** and silently closes the Mac entry. The Mac client then keeps heartbeating an entry the server has already closed, and the deliberately field-preserving update will not re-open it — so the Mac shows "tracking" while accruing nothing until the user stops and restarts it. This is inherent to the no-backend-change decision, not a bug to fix here, but it must be in the pilot notes.
- **Browser-URL site categorization is not implemented on Windows.** macOS reads the active tab URL via AppleScript against 5 browsers; Windows has no equivalent (UI Automation against address bars is fragile and per-browser; an extension is a separate product). Because `Categorizer` keeps site and app lists separate with host-wins-over-app, no host simply means app rules apply. Consequence: a Windows user browsing in Chrome is categorized by the _Chrome app rule_, not by the site. Document in the client README and the admin settings help text.
- **Counts-not-content is enforced by structure, not by the API.** Raw Input _can_ yield key identity; the macOS counter API cannot. Mitigated by the single-purpose `IInputCounting` boundary and a test, but it is a weaker guarantee than the Mac client's and should be stated in the PR description and reviewed as such.
- **Unsigned pilot** — SmartScreen will warn. Signing is wired as a no-op step; enabling it is a follow-up.
- **Antivirus/EDR** — a low-level input hook may trip heuristics. Raw Input is far less likely to than `WH_KEYBOARD_LL`, which is one reason it is the chosen mechanism, but expect enterprise AV friction the Mac client never had.
- **Rate limiting** — flat 100 req/min per IP is a rollout risk a second client fleet worsens. Follow-up: per-user throttler tracker on `apps/api`.
- **`packages/contracts` doc comment** describes `bundleId` as "Stable macOS bundle identifier". Worth a one-line comment update noting the Windows convention; the wire type (`z.string().max(255).nullable().optional()`) does not change.
