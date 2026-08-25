# Nifty Timer for Windows — build plan and progress

Working status for the Windows client, written so the next two slices can be picked up on a
different machine without re-deriving anything.

- **Design doc (the "why"):** [`docs/superpowers/specs/2026-08-25-windows-client-design.md`](../../docs/superpowers/specs/2026-08-25-windows-client-design.md)
- **Client guide (the "how", day to day):** [`README.md`](./README.md)
- **This file (the "where we are"):** what is done, what is left, and what must not be broken.

| Slice  | Contents                                                           | State          |
| ------ | ------------------------------------------------------------------ | -------------- |
| **S1** | Auth · AckGate · tray indicator · manual timer · buffer + sync     | ✅ **done**    |
| **S2** | Idle detection · away keep/discard · crash recovery                | ✅ **done**    |
| **S3** | Screenshots · activity sampling · categorizer                      | ✅ **done**    |
| **S4** | Notifications · hotkey · updater · packaging · signing · dashboard | ⬜ not started |

Branch: `feat/client-windows`. Nothing is merged to `main` yet.
Current: **331 tests pass offline** (13 integration skipped). Release build clean,
`TreatWarningsAsErrors` on.

---

## Picking this up on another machine

```powershell
git clone <repo> && cd timetrack
git checkout feat/client-windows

winget install Microsoft.DotNet.SDK.9      # the only prerequisite for the client itself

cd apps/client-windows
dotnet build NiftyTimer.sln -c Release      # also the lint gate — warnings are errors
dotnet test  NiftyTimer.sln -c Release
dotnet run --project src/NiftyTimer         # points at 127.0.0.1:3001 by default
```

`dotnet` may not be on `PATH` in a fresh shell after install. `$env:PATH = "$env:ProgramFiles\dotnet;$env:PATH"`.

A checkout build carries the `.dev` app id, so its state lives in `%LOCALAPPDATA%\NiftyTimer-dev\`
and cannot touch a released install's buffers.

### Running the integration tests

Twelve of the thirteen skipped tests are `Integration/LiveApiTests`. They drive the **real** HTTP
clients against a running API — everything else stops at the `IUploader` / `IPolicyProvider` seam, so
without these the request construction itself is never executed. Worth the setup before shipping
either remaining slice.

```powershell
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate; pnpm db:seed; pnpm --filter api dev

$env:NIFTYTIMER_E2E_API      = "http://127.0.0.1:3001/v1"
$env:NIFTYTIMER_E2E_EMAIL    = "admin@example.com"
$env:NIFTYTIMER_E2E_PASSWORD = "<seeded password>"
dotnet test
```

They acknowledge monitoring for that account and briefly open and close entries. They share one
seeded user and are **state-sensitive**: a test that fails mid-way can leave an open row behind,
which then fails every later live-entry test until it goes stale (300s) or is closed by hand:

```bash
docker exec <pg> psql -U timetrack -d timetrack \
  -c 'UPDATE time_entries SET "endTime" = COALESCE("heartbeatAt","startTime") WHERE "endTime" IS NULL;'
```

---

## ✅ S1 — Foundation (done)

Sign in, acknowledge the policy, track manually from the tray, buffer offline, sync.

| Area        | Files                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `App/`      | `AppDelegate` (wiring + launch), `TrayIconController`, `MessageWindow`, `MenuViewModel`, `AppConfig`, `AppInstall`, `BuildStamp` |
| `Auth/`     | `AuthClient`, `AuthSession` (single-flight refresh), `TokenStore` (DPAPI), `JwtDecoder`, `AuthorizedJsonClient`                  |
| `Policy/`   | `AckGate`, `AckClient`, `AckMarker`, `LivePolicy`, `PolicyClient`, `EffectivePolicy`                                             |
| `Tracking/` | `TimeTracker`, `UuidV7`                                                                                                          |
| `Storage/`  | `BufferStore` (file-per-record), `UserSettings`                                                                                  |
| `Sync/`     | `SyncEngine`, `TimeEntryUploader`, `LiveEntryPublisher`, `BackoffPolicy`, `TimeEntryPayload`, `UploadResult`                     |
| `Projects/` | `ProjectClient`, `ProjectCache`, `SelectionStore`, `SelectionResolver`                                                           |
| `Reports/`  | `SelfTotalsClient`                                                                                                               |
| `UI/`       | `TrayPopupWindow`, `LoginWindow`, `AckWindow`, `Tokens.xaml`                                                                     |

Also done in S1's tooling commit, so **S4 does not need to redo them**: `.github/workflows/client-windows.yml`,
`.gitignore` entries, `.dockerignore`, `eslint.config.mjs` ignore, `scripts/generate-tray-icons.ps1`.

## ✅ S2 — Idle, away resolution, crash recovery (done)

| Area             | Files                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tracking/`      | `IdleMonitor`, `ManualIdleMonitor`, `IdleState` (+ `AwayResolution`, `AwayMinutes`), `SessionObserver` (+ `FanOutSignalReceiver`, `ISignalReceiver`), `IdleEventPayload` (+ `IdleEventEnqueuer`), `LiveSpanRecovery`, `DailyTotalAccumulator`, `ManualNudgeMonitor` |
| `App/`           | `AutoTrackingCoordinator`, `ManualIdleCoordinator`                                                                                                                                                                                                                  |
| `Storage/`       | `LiveSpanStore` (+ `LiveSpan`, `ILiveSpanRecorder`, `NoopLiveSpan`)                                                                                                                                                                                                 |
| `UI/`            | `TimePromptWindow` (+ `TimePrompt`, `TimePrompts`, `OneShotResolution`)                                                                                                                                                                                             |
| `Notifications/` | `ILocalNotifier` — interface only; the toast implementation is S4                                                                                                                                                                                                   |

**Built but deliberately not wired.** Both are tested and inert; wire them in S4:

- `ManualNudgeMonitor` — needs the S4 toast notifier. Wiring it against a no-op notifier would mean
  a live 15s timer with zero observable effect.
- `DailyTotalAccumulator` — feeds the S4 end-of-day summary. It uses the machine's **local**
  calendar, which is only acceptable because nothing it produces reaches the API. Routing it into a
  request body or showing it as an authoritative total breaks the `APP_TIMEZONE` rule.

### Defects found and fixed while building S2 — do not reintroduce

Each has a regression test, and each test was verified by mutation (revert the fix, watch the named
test fail).

| Defect                                                                                                                                                                                          | Origin | Guarded by                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Tray host was a **message-only window**, so `TaskbarCreated` never arrived — the indicator stayed gone after any Explorer restart (PRD §4.2 failing silently)                                   | S1     | `MessageWindowTests.IsATopLevelWindowSoBroadcastsReachIt`                                                                                   |
| **409 on reopen**: closes rode the buffer (≤90s late), opens published immediately, so close-then-reopen hit the one-open-entry index → "already tracking on another machine", no other machine | S1     | `LiveApiTests.ClosingAndReopeningOnThisMachineIsNotAConflict` (live), `LiveEntryPublisherTests.ACloseIsAlwaysSentBeforeAnOpenQueuedAfterIt` |
| `AbandonRunningSpan` left `live-span.json` behind — next launch offered to recover a span the server had refused                                                                                | S2     | `TimeTrackerLiveSpanTests.AbandoningAfterAConflictClearsTheRecord`                                                                          |
| `AckGate` resumes on a thread-pool thread (`ConfigureAwait(false)`), where `DispatcherTimer` never ticks and `HwndSource` throws                                                                | S2     | none — runtime-only; the fix is the `_dispatcher.InvokeAsync` hop in `StartIdleDetectionAsync`                                              |

---

## ✅ S3 — Capture: screenshots, activity sampling, categorization (done)

The first slice where capture code exists. Everything is installed only in
`AppDelegate.StartCaptureAsync`, reached from `ProceedToPolicyAsync` after `!AckRequired`, inside
`_ackGate.WithCaptureAllowedAsync`, marshalled onto the UI thread — the same shape as
`StartIdleDetectionAsync`.

| Area        | Files                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Activity/` | `EventCounter` (+ `IInputCounting`), `AppSampler` (+ `IAppSampling`, `AppSnapshot`), `ActivitySampler`                                                 |
| `Capture/`  | `IDisplayGrabber` (+ `DisplayCapture`, `DisplayGrabResult`, `DisplayGrabException`), `WindowsDisplayGrabber`, `ScreenshotScheduler`                    |
| `Policy/`   | `Categorizer` (+ `Category`, `Categories`)                                                                                                             |
| `Tracking/` | `ActivityRateMeter`                                                                                                                                    |
| `Storage/`  | `ImageBufferStore` (+ `CaptureGroup`, `BufferedImage`, `IImageBuffer`), `ActivitySampleStore` (+ `IActivitySampleBuffer`)                              |
| `Sync/`     | `ScreenshotUploader` (+ `IScreenshotUploading`), `ScreenshotSyncEngine`, `ActivityBatchSyncEngine`, `ActivitySamplePayload` (+ `ActivityBatchPayload`) |
| `App/`      | `MessageWindowHost` / `IMessageHost` (moved out of `Activity` so a window factory is not forced to take a gate)                                        |

**Decisions taken during S3, with reasons — do not silently reverse them:**

- **GDI, not Windows Graphics Capture** (the design doc had locked WGC). WGC needs a TFM bump plus
  several hundred lines of CI-unverifiable D3D11 interop, and draws a yellow capture border on
  Windows 10 builds predating the opt-out. Cost of the swap: DRM video and some exclusive-fullscreen
  D3D capture as black. `IDisplayGrabber` is the seam, so WGC later is one file and no test changes.
- **`RID_HEADER`, not `RID_INPUT`.** Key identity is never copied into the process, rather than
  fetched and ignored. This is the one place the Windows client is arguably _stronger_ than the Mac.
- **No `ActivitySampleUploader` type.** `TimeEntryUploader` already takes a path; pointing it at
  `activity-samples/batch` reuses the JSON POST, the 401 refresh-retry and `Classify` verbatim
  instead of growing a second copy to drift.
- **No permission preflight.** The macOS `isPermitted`/`onPermissionDenied` plumbing has no Windows
  analogue — there is no TCC gate on screen capture — so it was dropped rather than ported as a
  `() => true` stub with a warning state that can never be entered.
- **`InternalsVisibleTo NiftyTimer.Tests`** added, so pure test seams (`MultipartBody`, `Describe`,
  `Ordered`, `FileName`) stay `internal` instead of being made public to reach them.

### Verification

- `ActivitySamplerTests.MeasuredCyclesRescheduleContiguouslyRatherThanWaitingTheInterval` was
  **mutation-verified**: changing `measured ? TimeSpan.Zero : _interval` to always wait the interval
  fails that test with "got 1" sample instead of many.
- `CaptureGateGuardTests` **caught a real offender during S3** (`MonitorEnumProc`, a P/Invoke
  callback delegate). Delegates are now excluded — a delegate type is a signature with no body, so
  it cannot bypass a gate — and the test additionally asserts it inspected ≥4 types, so it cannot
  rot into a guard over an empty set.
- `OfflineCaptureUnreachableTests` now covers all three installers in both directions, plus
  `TheReachabilityWalkIsNotVacuous`, because an IL walk that silently stops resolving tokens would
  make the negative test pass for the wrong reason.

### Original build notes (kept for reference)

- `Activity/EventCounter` — **Raw Input** (`RegisterRawInputDevices` + `WM_INPUT`) on its own
  `MessageWindow`. Discard `RAWKEYBOARD.VKey` / `MakeCode` inside the message handler. The only type
  crossing into the rest of the app is `IInputCounting { long KeyEvents; long PointerEvents; }` — two
  counters, nothing else. Do **not** implement the S4 hotkey through this path; `RegisterHotKey` sees
  only the one combination.
- `Activity/AppSampler` — foreground process + window title. `GetForegroundWindow` →
  `GetWindowThreadProcessId` → `QueryFullProcessImageName`; title via `GetWindowText`. Title gated on
  the policy flag `captureWindowTitles`. Truncate title to 120, app name to 200.
- `Activity/ActivitySampler` — 60s window in 12 sub-buckets; a bucket is active if any key **or**
  pointer event occurred; `activityPct = active / 12 * 100`. Contiguous windows when measuring,
  full-interval backoff when skipped. `ACTIVITY_SAMPLE_INTERVAL_SECONDS = 60` mirrored by convention.
- `Activity/Categorizer` — port the rules exactly: site and app lists separate; host wins over app;
  most-specific site term wins by suffix-length scoring; ties → `UNPRODUCTIVE`; app rules match
  `bundleId` **or** display name, exact and case-insensitive; `UNPRODUCTIVE` wins on overlap.
- `Capture/DisplayGrabber` (Windows Graphics Capture + `Direct3D11CaptureFramePool`) +
  `Capture/ScreenshotScheduler` — interval from policy; **every attached display** per tick under one
  shared `captureGroupId` with `displayIndex`/`displayCount`, ordered deterministically (primary
  first, then by device name via `EnumDisplayMonitors` + `GetMonitorInfo`). JPEG q=0.6
  (`JpegBitmapEncoder`, `QualityLevel = 60`) at native pixel resolution, per-monitor DPI aware. Only
  while the clock is running. **Partial success is success** — one flaky external monitor must not
  kill the desk.
- `Storage/ImageBufferStore` + `Storage/ActivitySampleStore`.
- `Sync/ScreenshotSyncEngine` (≤20/cycle) and `Sync/ActivityBatchSyncEngine` (**one** batch of
  ≤500/cycle — deliberately one, so a failed delete cannot spin a re-take loop).
- Local file deleted **only** after confirmed upload (PRD §6.2).

### The `bundleId` convention — decide once, it is permanent

`ObservedAppsSchema` surfaces whatever the client sends into the admin rule picker, so an
inconsistent convention pollutes the admin UI forever.

**Send the lowercased executable filename without extension** (`code`, `chrome`, `devenv`) as
`bundleId`, and the process's `FileDescription` (falling back to the filename) as `appName`. Full
paths vary per machine and would fragment the picker; AUMIDs are absent for most Win32 apps.
Document it in the README when it lands.

### Tests

`EventCounterBoundaryTests` (reflection assertion on the `IInputCounting` surface),
`ActivitySamplerTests`, `ActivityRateMeterTests`, `AppSamplerTests`, `CategorizerTests`,
`ScreenshotSchedulerTests` (including the gate re-check per tick), `ImageBufferStoreTests`,
`ActivitySampleStoreTests`, `ScreenshotSyncEngineTests`, `ActivityBatchSyncEngineTests`,
`ScreenshotUploaderTests` (**multipart field-order assertion**), `ActivitySampleUploaderTests`.
`DisplayGrabber` is build-verified only, matching the Swift `ScreenCaptureKitGrabber`.

Two existing guards start doing real work in S3 — **read them before writing capture code**:

- `CaptureGateGuardTests` asserts every type in `NiftyTimer.Capture` / `NiftyTimer.Activity` takes an
  `AckGate` in its constructor. It currently guards an empty set. It starts failing the moment an
  ungated sampler or grabber appears.
- `OfflineCaptureUnreachableTests` IL-scans `AppDelegate.ProceedOffline` for installer calls. **Add
  each new installer to its `Installers` array** — there is a `// S3 adds ... here` marker.

## ⬜ S4 — Notifications, hotkey, updater, packaging, dashboard

### Client

- `Notifications/LocalNotifier` — implement `ILocalNotifier` with Windows toasts via an AUMID
  registered by a Start Menu shortcut created at install. Four nudges: idle, forgot-to-start (10 min),
  end-of-day summary (18:00), distraction. Denied/disabled notifications are a silent no-op; the
  distraction nudge alone falls back to a visible in-app window.
- **Wire `ManualNudgeMonitor`** (manual mode only, behind the gate, alongside `ManualIdleCoordinator`)
  and **`DailyTotalAccumulator`** (already fed by `TimeTracker.SpanClosed`; read it for the summary).
- `App/GlobalHotKey` — `RegisterHotKey`, **Ctrl+Alt+T**.
- `Update/` — `UpdateFeed` polls `https://api.github.com/repos/{repo}/releases/latest` unauthenticated
  every 6h plus on menu-open throttled to 30 min (no token ships in a binary on employee laptops);
  `rateLimited` collapses silently to unknown-or-current. `UpdateEvaluator` escalates
  available → overdue after a 7-day grace. `UpdateInstaller` gates the swap on **two independent
  checks**: published SHA-256, and Authenticode publisher identity matching the running module's —
  the unsigned pilot enforces SHA-256 only and refuses a signed→unsigned or cross-publisher
  transition. Gated on `AppInstall.IsProduction`. **Nothing in the update path may stop tracking**;
  the strongest state is a visible warning. Swap mechanism: detached updater `.exe` →
  wait-for-PID → rename aside → move in → rollback → relaunch.

### Packaging

- `scripts/package-app.ps1` — self-contained `dotnet publish -r win-x64`; rewrite `ApiBaseUrl` /
  `DashboardUrl` / app id into `appsettings.json`; default to **production**
  (`https://timer.niftyitsolution.com/v1` — the `/v1` suffix is load-bearing, Caddy routes `/v1/*`);
  copy tray icons **by explicit name** so a rename is a build failure.
- `scripts/package-dev-app.ps1` — side-by-side "Nifty Timer Dev" with its own `%LOCALAPPDATA%`
  container and localhost URLs. Sharing state is _lossy_, not untidy: both processes drain the same
  buffers.
- `scripts/sign.ps1` — `signtool sign /fd SHA256 /tr <rfc3161> /td SHA256`. **No-op with a warning
  when no cert env vars are present**, so the pipeline works today and switches on later without
  rework. `SIGNING.md` documents the cutover and the SmartScreen reputation caveat.
- `scripts/release-assets.ps1` — `NiftyTimer-windows-pilot.zip` + `.sha256` sidecar. **Both names are
  contract** (`UpdateFeed` refuses a release with no matching digest). Tag `vX.Y.Z-windows-pilot`.
- Add `./scripts/package-app.ps1` as a third step to `.github/workflows/client-windows.yml` (the
  workflow already exists and runs build + test).

### ⚠️ Distribution — the Mac-regression trap

**Publish Windows assets to a separate GitHub distribution repo.** GitHub has one `releases/latest`
per repo; the Mac client's `UpdateFeed` requires an asset literally named `NiftyTimer-pilot.zip` on
it, and `MacDownloadPlate.DOWNLOAD_URL` resolves through it. A Windows release published to the same
repo becomes `latest` → **every installed Mac client goes silently blind to updates and the dashboard
download button 404s.**

`GitHubReleaseFeed.repo` is already injectable and `release-assets.sh` already takes `--repo`, so a
separate repo needs **zero change to already-shipped Mac clients**.

### Dashboard (`apps/dashboard`)

Several strings become factually wrong the day Windows ships.

- **New** `src/app/install/windows/page.tsx`. `src/app/install/page.tsx` is macOS-only end to end
  (`xattr -dr com.apple.quarantine`, Gatekeeper "Open Anyway", `pgrep` troubleshooting) and **cannot
  be genericised in place** — move it to `src/app/install/macos/page.tsx` and make `/install` a short
  platform chooser. `/install` must keep working; it is already advertised. Reuse
  `MarketingChrome.tsx` (`Section`, `SpecPlate`, `Prose`) and `CopyCommand.tsx`, both
  platform-neutral. Cover the SmartScreen "More info → Run anyway" flow for the unsigned pilot.
- **New** `src/components/marketing/WindowsDownloadPlate.tsx` alongside `MacDownloadPlate.tsx`, with
  its own `DOWNLOAD_URL` pointing at the Windows distribution repo. Do **not** change
  `MacDownloadPlate`'s constants.
- `src/app/page.tsx` — metadata description; "Self-hosted · macOS + web" → "macOS, Windows + web";
  the "Download for Mac" CTA → two buttons; the "A menu bar app on each Mac…" copy; the
  `['Client', 'Swift 6, SwiftUI and AppKit — macOS 14…']` spec row; and the
  `<Section eyebrow="Download" title="macOS client — pilot build">` heading.
- `src/app/(app)/overview/page.tsx:353,361` — "Numbers appear here as soon as someone starts the Mac
  app" and the "Install the Mac app" button → platform-neutral, pointing at `/install`.
- `src/app/(app)/admin/settings/SettingsForm.tsx:187` — "Applies to every macOS client on this team."
  → "every client on this team".
- **`TeamSettings` seed defaults are macOS-shaped** (`packages/contracts/src/team-settings.ts:94-127`:
  `Terminal`, `iTerm2`, `Warp`, `Ghostty`, `Xcode`, `us.zoom.xos`), so Windows users get everything
  `NEUTRAL` until an admin edits the lists. Add Windows equivalents (`windowsterminal`, `powershell`,
  `devenv`, `code`, `zoom`, `teams`, `outlook`, `explorer`). Contracts change → **its own commit**;
  it does not alter any request/response shape.

### Docs

- `PRD.md` — §1 target platforms; §2 stack table (add the Windows client row); new §7.1.8
  `apps/client-windows` tree; §13 the single-device assumption now has a stated resolution (409 UX).
- `CLAUDE.md` — §1 add the counts-not-content structural note for Raw Input; §3 layout add
  `apps/client-windows` (Swift and C#, both outside the pnpm graph).
- `docs/ROADMAP.md` — add the Windows workstream.
- `docs/deployment.md:284` and `docs/PREREQUISITES.md:26,88-92` still describe **Sparkle/appcast,
  which was abandoned** — correct them to the GitHub-releases + SHA-256 + signature-check mechanism
  actually shipped, and document both platforms.

---

## Invariants — a build that breaks one of these does not ship

From CLAUDE.md §1 and PRD §3/§4. The [README's "Things that will bite you"](./README.md) covers the
implementation traps; these are the product rules.

1. **`AckGate` is a structural gate, not a boolean.** Capture code is passed _into_ it. It fetches
   the policy on every call, publishes to `LivePolicy` before invoking the body, and fails **closed**
   on any error. No admin override, no debug flag.
2. **The offline branch cannot capture.** `ProceedOffline` re-enables MANUAL tracking only. Capture
   installers exist exclusively on the online acknowledged branch. Do not merge the two branches into
   one with a flag — `OfflineCaptureUnreachableTests` will fail, and it is right.
3. **Counts, never content.** On macOS `CGEventSource.counterForEventType` physically cannot yield
   key identity. On Windows Raw Input _can_, so the invariant degrades from structural to
   disciplinary — that is the one place this client is weaker than the Mac one, and it is why the
   `IInputCounting` boundary and its reflection test exist. Never a `WH_KEYBOARD_LL` hook.
4. **Always-visible indicator, no kill switch.** Created first and unconditionally. No config, policy,
   build flag, or command-line switch hides it.
5. **Nothing CLAUDE.md §1 forbids**: no stealth mode, no webcam/audio/GPS/clipboard capture, no
   keystroke content, no screenshots readable by a manager but not the employee.
6. **Never break `/v1`.** A shipped Mac client pins it and cannot be rolled back.
7. **Zero runtime dependencies**, matching the Swift client (CLAUDE.md §2). The app project references
   no NuGet packages; the test project references only xunit and the test SDK. If S3's Win32 surface
   gets large, CsWin32 (a build-time source generator, no runtime assembly) is the thing to discuss —
   **ask first**.

## Known gaps, stated explicitly

- **Browser-URL site categorization is not implemented on Windows.** macOS reads the active tab URL
  via AppleScript against 5 browsers; Windows has no equivalent (UI Automation against address bars
  is fragile and per-browser; an extension is a separate product). Because `Categorizer` keeps site
  and app lists separate with host-wins-over-app, no host simply means app rules apply. Consequence:
  a Windows user browsing in Chrome is categorized by the _Chrome app rule_, not by the site.
  Document in the README and the admin settings help text.
- **Counts-not-content is enforced by structure, not by the API** — see invariant 3. Say so in the S3
  PR description and have it reviewed as such.
- **Two machines, one user.** The DB allows one running entry per **user**. Starting here while the
  Mac is tracking returns 409 and rolls the clock back with "Already tracking on another machine".
  The quieter case: if the Mac has not heartbeated for `TRACKING_FRESHNESS_SECONDS` (300s — lid
  closed, no network), starting here **succeeds** and silently closes the Mac's entry; the Mac then
  keeps heartbeating a closed row and shows "tracking" while accruing nothing. Inherent to a second
  platform without a schema change.
- **Unsigned pilot** — SmartScreen will warn. Signing is wired as a no-op step in S4.
- **Antivirus/EDR** — expect some enterprise friction the Mac client never had. Raw Input is far less
  likely to trip heuristics than `WH_KEYBOARD_LL`, which is one reason it is the chosen mechanism.
- **Rate limiting — worse after S3, with a number.** The API throttles at a flat 100 req/min keyed
  on `req.ip`, which a whole office shares behind one NAT. S3 gates the hardware seams as well as
  the orchestrators (`CaptureGateGuardTests` requires it, and the re-check immediately before the
  window-title read is worth having), so **an activity tick now costs two `GET /policy/effective`
  instead of one** — `ActivitySampler`'s and `AppSampler`'s. Per tracking client that is ~2 req/min
  for policy, plus 1/min heartbeat and ~0.7/min sync: call it **4 req/min while tracking**, so the
  shared limit is reached at roughly **25 concurrently-tracking clients on one IP**, and a second
  platform makes that arrive sooner. The Windows `BackoffPolicy` has real ±25% jitter (the Swift one
  defaults to identity, so a whole office retries in lockstep on a 429), which stops the limit
  becoming self-sustaining but does not raise it. Follow-up ticket: per-user throttler tracker on
  `apps/api`. Do not "optimize" this by dropping a gate call — the gate is the product requirement;
  the throttler is the thing that should change.
- **`apps/api` robustness gap, unrelated to this client:** `src/infra/storage/minio.service.ts:59-64`
  does HeadBucket → catch → CreateBucket in `onModuleInit`, and crashes the API on
  `BucketAlreadyOwnedByYou`. One `catch` away from robust. Not fixed — out of scope.

## Working agreements for the remaining slices

- **One slice, one PR.** Spec → plan → PR, as S1 and S2 were done.
- **Commit scope is `client`** (CLAUDE.md §0 enum). Type ∈ `feat | fix | refactor | perf | test | docs | chore | build | ci`.
- **No AI attribution anywhere** — not in the author, committer, message, trailers, branch name, tag,
  PR title, or PR body. The commit-msg hook enforces it; CI re-enforces it.
- **No fabricated issue refs.** `Refs: #N` only for an issue that exists — check with `gh issue view N`.
- **Verify claims by mutation.** For anything load-bearing, revert the fix and watch the named test
  fail. That is what makes "this is tested" checkable rather than asserted.
- **Ask before adding a dependency** (CLAUDE.md §2).

Before claiming a slice done:

```powershell
cd apps/client-windows
dotnet build NiftyTimer.sln -c Release   # warnings are errors; this is the lint gate
dotnet test  NiftyTimer.sln -c Release
```

and, for any commit touching the dashboard, contracts, or docs, at the repo root:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## End-to-end checklist (design doc §Verification)

Against a local stack with a dev-packaged client. Status as of S2:

| #   | Check                                                                              | Status                     |
| --- | ---------------------------------------------------------------------------------- | -------------------------- |
| 1   | Gate closed — un-acknowledged user produces no capture at all                      | ⬜ **needs a manual pass** |
| 2   | Gate opens — ack succeeds, `AuditLog` row written, capture begins next tick        | ⬜ **needs a manual pass** |
| 3   | Offline asymmetry — manual works, capture structurally absent, buffer drains       | ✅ verified live           |
| 4   | Round-trip — live entry ticks, samples and screenshots arrive grouped              | ⬜ **needs a manual pass** |
| 5   | Idle — lock past threshold, away marked immediately, prompt defaults to discard    | ⬜ **needs a manual pass** |
| 6   | Crash recovery — kill mid-span, relaunch, Keep closes at `lastAlive`               | ⬜ **needs a manual pass** |
| 7   | 409 path — start on Mac then Windows, clear message, buffer not wedged             | ✅ verified live           |
| 8   | Sign-out — buffers flush then clear; second user uploads nothing of the first's    | unit-tested, not in-app    |
| 9   | Counts-not-content — type a known string, grep every request body and local file   | ⬜ **needs a manual pass** |
| 10  | Mac not regressed — update feed and download URL still resolve after a Win release | S4                         |

**These are the honest gaps, and they are the real remaining risk in S3.** Every state machine,
store, uploader, scheduler and guard is unit-tested — 331 tests — and the two structural guards are
mutation-verified. But three things in this slice cannot be tested without a display and a person:

- **Rows 1, 2, 4 and 9 are new with S3.** Row 9 in particular is the only thing that
  _empirically_ demonstrates invariant 3 rather than arguing it from the code: type a known string
  into Notepad while capturing traffic, then grep every outbound body and every file under
  `%LOCALAPPDATA%\NiftyTimer-dev\` for it. Zero hits. That result belongs in the S3 PR description.
- **`WindowsDisplayGrabber` is build-verified only**, matching the macOS `ScreenCaptureKitGrabber`.
  Nobody has yet confirmed a real two-monitor grab, the DPI handling on a scaled display, or the
  JPEG size against the 10 MB cap.
- **Rows 5 and 6 carry over from S2** and are still open.

Each is a few minutes at a real machine. None of them is blocked on anything.
