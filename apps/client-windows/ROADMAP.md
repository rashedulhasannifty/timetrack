# Nifty Timer for Windows — build plan and progress

Working status for the Windows client. All four slices are code-complete; what is left is the
end-to-end checks that need a real machine, listed at the bottom.

- **Design doc (the "why"):** [`docs/superpowers/specs/2026-08-25-windows-client-design.md`](../../docs/superpowers/specs/2026-08-25-windows-client-design.md)
- **Client guide (the "how", day to day):** [`README.md`](./README.md)
- **This file (the "where we are"):** what is done, what is left, and what must not be broken.

| Slice  | Contents                                                           | State       |
| ------ | ------------------------------------------------------------------ | ----------- |
| **S1** | Auth · AckGate · tray indicator · manual timer · buffer + sync     | ✅ **done** |
| **S2** | Idle detection · away keep/discard · crash recovery                | ✅ **done** |
| **S3** | Screenshots · activity sampling · categorizer                      | ✅ **done** |
| **S4** | Notifications · hotkey · updater · packaging · signing · dashboard | ✅ **done** |

Merged to `main` (PR #167, `c4642f2`); released as 0.6.0.
Current: **381 tests pass offline** (14 integration skipped — 13 need a live API, 1 needs a real
display). Release build clean, `TreatWarningsAsErrors` on. The root
`pnpm lint && typecheck && test && build` is green too.

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
without these the request construction itself is never executed. Worth the setup before the pilot
goes out. Note they do **not** yet cover the S3 upload paths (`screenshots` multipart and
`activity-samples/batch`), which are exercised only against fakes.

```powershell
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate; pnpm db:seed; pnpm --filter api dev

$env:NIFTYTIMER_E2E_API      = "http://127.0.0.1:3001/v1"
$env:NIFTYTIMER_E2E_EMAIL    = "admin@example.com"
$env:NIFTYTIMER_E2E_PASSWORD = "<seeded password>"
dotnet test
```

The fourteenth needs a **display** rather than an API. `Integration/LiveDisplayGrabTests` is the
only test that actually executes `WindowsDisplayGrabber`; everything else stops at the
`IDisplayGrabber` seam. It stays skipped in CI, where the agent's session may enumerate a single
virtual display that captures as black:

```powershell
$env:NIFTYTIMER_E2E_DISPLAY = "1"
dotnet test --filter LiveDisplayGrabTests --logger "console;verbosity=detailed"
```

It prints `COVERAGE:` lines saying whether this machine's displays actually exercise the
multi-monitor and DPI-scaled cases, so a green run on one unscaled monitor is not mistaken for
covering either. Run it on a scaled multi-monitor desk before the pilot goes out.

The live-API tests acknowledge monitoring for that account and briefly open and close entries. They
share one seeded user and are **state-sensitive**: a test that fails mid-way can leave an open row
behind, which then fails every later live-entry test until it goes stale (300s) or is closed by
hand:

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

**Both of these were resolved in S4, in opposite directions:**

- `ManualNudgeMonitor` is now wired, manual mode only, behind the gate, driven by the same poller
  through `NudgeSignalAdapter` rather than a second timer over the same idle scalar.
- `DailyTotalAccumulator` was **deleted**. It tallied against the machine's local calendar while
  the product calendar is `Asia/Dhaka`, so the end-of-day toast it fed would have contradicted the
  dashboard for anyone not on Dhaka time — its own documentation predicted exactly that. The
  summary reads `reports/my-totals` instead, which arrives with the day boundary already resolved
  server-side, and the accumulator had no remaining consumer.

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
`WindowsDisplayGrabber` itself is covered by `Integration/LiveDisplayGrabTests`, which needs a
real display and is skipped unless `NIFTYTIMER_E2E_DISPLAY=1`.

Two existing guards start doing real work in S3 — **read them before writing capture code**:

- `CaptureGateGuardTests` asserts every type in `NiftyTimer.Capture` / `NiftyTimer.Activity` takes an
  `AckGate` in its constructor. It currently guards an empty set. It starts failing the moment an
  ungated sampler or grabber appears.
- `OfflineCaptureUnreachableTests` IL-scans `AppDelegate.ProceedOffline` for installer calls. **Add
  each new installer to its `Installers` array** — there is a `// S3 adds ... here` marker.

## ✅ S4 — Notifications, hotkey, updater, packaging, dashboard (done)

| Area             | Files                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Notifications/` | `LocalNotifier` (tray balloon + per-id de-duplication), `EndOfDayScheduler`                                                        |
| `App/`           | `GlobalHotKey`, `MenuViewModel.ToggleTracking`, `AppConfig.UpdateRepo`, tray balloon on `TrayIconController`                       |
| `Tracking/`      | `NudgeSignalAdapter` (rides the existing poller rather than starting a second timer)                                               |
| `Update/`        | `AppVersion`, `UpdateStatus` (+ `ReleaseManifest`, `UpdateEvaluator`), `GitHubReleaseFeed`, `UpdateInstaller`, `UpdateCoordinator` |
| `scripts/`       | `package-app.ps1`, `package-dev-app.ps1`, `sign.ps1`, `release-assets.ps1`                                                         |
| repo             | `SIGNING.md`, dashboard `/install` split + `WindowsDownloadPlate`, contracts seed defaults, PRD/CLAUDE.md/docs                     |

**Decisions taken during S4, with reasons — do not silently reverse them:**

- **Tray balloons, not WinRT toasts.** Verified rather than assumed: `Windows.UI.Notifications` does
  not resolve from `net9.0-windows`, so real toasts would cost the same TFM bump declined for screen
  capture, plus an AUMID registered by a Start Menu shortcut the unsigned pilot has no installer to
  create. Windows 10/11 render balloons through the Action Center anyway. Cost: no action buttons,
  body truncated at 255 characters. All four nudges are informational.
- **`DailyTotalAccumulator` deleted, not wired.** See S2 above — the end-of-day figure comes from
  `reports/my-totals` so it agrees with the dashboard for everyone, not only for people on Dhaka
  time.
- **`RegisterHotKey`, never the input counter.** Recognising a chord through raw input would mean
  inspecting keys, which is the capability `EventCounter` exists to lack. Losing the registration to
  an app that already owns Ctrl+Alt+T degrades to no hotkey; it never throws at launch.
- **PowerShell swap script, not a second updater binary.** A running executable cannot replace
  itself, so the swap must outlive the process. The macOS client shells out to a small script for
  the same reason. A dedicated updater `.exe` is the obvious follow-up and is a second binary to
  build, sign and ship.
- **Updates apply only when asked.** The coordinator finds them; a menu action applies them. An
  update that installed itself would restart the app mid-task, which for a time tracker means
  restarting the thing recording someone's day. `UpdateWiringTests` reads the IL of
  `ApplyUpdateAsync` and fails if it stops reaching `StageAsync`/`LaunchDetachedSwap` — the client
  shipped once in exactly that state, detecting updates it had no path to apply, with every unit
  test green because each half worked alone.
- **Publisher TRANSITION rule, not a signature check.** While the pilot is unsigned there is no
  signature to verify, so the rule is: unsigned may replace unsigned, a publisher may replace
  itself, and everything else — signed → unsigned especially — is refused. Skipping the check
  entirely would make the updater the mechanism for downgrading a signed install later.

### ⚠️ Distribution — the Mac-regression trap

**Windows assets publish to a separate GitHub repository** (`Chishty-NiftyIT/niftytimer-windows`,
set in `AppConfig.UpdateRepo` and `WindowsDownloadPlate`). GitHub has one `releases/latest` per
repo; the Mac client's `UpdateFeed` requires an asset named `NiftyTimer-pilot.zip` on it, and
`MacDownloadPlate.DOWNLOAD_URL` resolves through it. A Windows release published to the same repo
becomes `latest` → **every installed Mac client goes silently blind to updates and the dashboard
download button 404s** — fixable only by shipping a Mac update through the path that just broke.

**The repository does not exist yet.** `UpdateFeed` and `WindowsDownloadPlate` are written against
the configured name, and both filenames are asserted by `PackagingContractTests`, but nobody has
confirmed the feed resolves or that the Mac path survives a real Windows release. Checklist row 10
stays open.

### Verification

- The packaging pipeline was **run**, not just written: `package-app.ps1 -Dev` produces a
  self-contained build carrying the stamped `appsettings.json` and both tray icons;
  `release-assets.ps1` produces the zip and a sidecar whose digest matches `Get-FileHash`.
- `sign.ps1` with no certificate exits 0 with a warning, as the pipeline requires.
- `PackagingContractTests` reads the scripts and asserts they still agree with the constants the
  client compiles against. That failure mode is otherwise invisible: publishing succeeds, the
  release looks correct, and every installed client simply stops seeing updates.
- Root `pnpm lint && typecheck && test && build` green; all three `/install` routes build.

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
- **Unsigned pilot** — SmartScreen warns once on first run. `scripts/sign.ps1` is wired in and is a
  no-op with a warning until a certificate exists; see `SIGNING.md` for the cutover, including the
  fact that a signing-identity change **cannot** be delivered by the updater (the transition rule
  refuses it, by design) and needs a manual re-download.
- **The Windows distribution repo does not exist yet**, so the update feed has never resolved
  against a real release and checklist row 10 — "the Mac path is not regressed" — is unverified.
- **No integration coverage for the S3 upload paths.** `LiveApiTests` covers time entries, idle
  events, auth and policy against a real API; the `screenshots` multipart POST and
  `activity-samples/batch` are exercised only against fakes. The multipart field-order rule in
  particular is asserted on a pure builder, not against `@fastify/multipart`.
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
  becoming self-sustaining but does not raise it. Do not "optimize" this by dropping a gate call —
  the gate is the product requirement; the throttler is the thing that should change.

  **Resolved server-side.** `apps/api` now runs two buckets rather than one: per-IP at 600 req/min
  (outermost, so `@Public()` login is still protected before Argon2) and per-authenticated-user at
  120 req/min beneath it. At ~4 req/min per tracking client that moves the shared ceiling from
  ~25 concurrent trackers on one office address to ~150, while a single misbehaving client can no
  longer consume everyone else's budget. The per-user bucket keys on the VERIFIED user, which is
  why it runs after `JwtAuthGuard` — a `sub` read from an unverified bearer token is
  attacker-chosen and would let anyone mint unlimited buckets.

- **`apps/api` robustness gap, unrelated to this client:** `src/infra/storage/minio.service.ts:59-64`
  does HeadBucket → catch → CreateBucket in `onModuleInit`, and crashes the API on
  `BucketAlreadyOwnedByYou`. One `catch` away from robust. Not fixed — out of scope.

## Working agreements

- **One slice, one PR.** Spec → plan → PR, as S1–S4 were done.
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

Against a local stack with a dev-packaged client. Status as of S4:

| #   | Check                                                                              | Status                      |
| --- | ---------------------------------------------------------------------------------- | --------------------------- |
| 1   | Gate closed — un-acknowledged user produces no capture at all                      | ⬜ **needs a manual pass**  |
| 2   | Gate opens — ack succeeds, `AuditLog` row written, capture begins next tick        | ⬜ **needs a manual pass**  |
| 3   | Offline asymmetry — manual works, capture structurally absent, buffer drains       | ✅ verified live            |
| 4   | Round-trip — live entry ticks, samples and screenshots arrive grouped              | ⬜ **needs a manual pass**  |
| 5   | Idle — lock past threshold, away marked immediately, prompt defaults to discard    | ⬜ **needs a manual pass**  |
| 6   | Crash recovery — kill mid-span, relaunch, Keep closes at `lastAlive`               | ⬜ **needs a manual pass**  |
| 7   | 409 path — start on Mac then Windows, clear message, buffer not wedged             | ✅ verified live            |
| 8   | Sign-out — buffers flush then clear; second user uploads nothing of the first's    | unit-tested, not in-app     |
| 9   | Counts-not-content — type a known string, grep every request body and local file   | ⬜ **needs a manual pass**  |
| 10  | Mac not regressed — update feed and download URL still resolve after a Win release | ⬜ **blocked: no repo yet** |
| 11  | Nudges — idle, forgot-to-start and the 18:00 summary appear as real notifications  | ⬜ **needs a manual pass**  |
| 12  | Hotkey — Ctrl+Alt+T starts and stops from another app, and loses gracefully        | ⬜ **needs a manual pass**  |
| 13  | Update — a staged build verifies, swaps, relaunches, and rolls back on failure     | ⬜ **needs a manual pass**  |

**These are the honest gaps, and they are the real remaining risk.** Every state machine, store,
uploader, scheduler, parser and guard is unit-tested — 381 tests — the two structural guards are
mutation-verified, and the packaging pipeline has actually been run end to end. But several things
cannot be tested without a display, a person, and a published release:

- **Row 9 is the important one.** It is the only thing that demonstrates counts-not-content
  _empirically_ rather than by reading the source: type a known string into Notepad while capturing
  traffic, then grep every outbound body and every file under `%LOCALAPPDATA%\NiftyTimer-dev\` for it. Zero hits.
  That result belongs in the PR description, which is where CLAUDE.md §1 expects it reviewed.
- **`WindowsDisplayGrabber` has now been executed — on one unscaled display only.**
  `LiveDisplayGrabTests` grabs for real and checks the frame against `EnumDisplaySettings`, an
  oracle independent of the `EnumDisplayMonitors` path the grabber uses. Observed on a 1366×768
  laptop panel at 96 DPI: a decodable JPEG at exactly the display's native resolution, 57–73 kB
  across runs — **around 0.6% of the server's 10 MB multipart cap** — and a non-black bottom-right
  corner. The size varies with what is on screen, so treat it as an order of magnitude rather than
  a constant; even so, quality 60 leaves so much headroom that a 4K panel would still land far
  inside the cap. That settles the "does it run at all" and the JPEG-size questions.

  **Two of the three original unknowns remain open, and no green run on this machine can close
  them:** a genuine two-monitor grab, and the DPI handling on a **scaled** display. The grabber
  reads `DESKTOPHORZRES` for true pixel dimensions, which is belt and braces if WPF is already
  per-monitor DPI aware — but if that assumption is wrong on a scaled monitor, `BitBlt` reads past
  the logical surface and produces a partly black frame that looks exactly like a DRM artifact. On
  a 96 DPI panel `HORZRES == DESKTOPHORZRES`, so the two cannot be told apart. The test prints a
  `COVERAGE:` line stating exactly this, and samples the **bottom-right corner** rather than a
  whole-frame average, because that is where an over-read would land. Re-run it on a scaled
  multi-monitor desk.

- **Row 10 is blocked, not pending.** The Windows distribution repository does not exist, so the
  update feed has never resolved and the claim that the Mac path is unaffected is reasoning rather
  than evidence.
- **Rows 5 and 6 have been open since S2.**

None of these is blocked on anything except a machine and a repository.
