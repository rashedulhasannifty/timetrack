# Nifty Timer for Windows

Native Windows client. C# / .NET 9 + WPF, tray-resident, talking to the same `/v1` API and
dashboard as the macOS client.

- **Design doc** — the reasoning behind the port: [`docs/superpowers/specs/2026-08-25-windows-client-design.md`](../../docs/superpowers/specs/2026-08-25-windows-client-design.md)
- **[`ROADMAP.md`](./ROADMAP.md)** — what is built, what still needs a real machine, and how to
  pick it up elsewhere. **Start there if you are continuing the work.**
- **[`SIGNING.md`](./SIGNING.md)** — what the unsigned pilot costs, and how to switch signing on.

This directory is **outside the pnpm graph**, exactly like `apps/client-macos`. `pnpm-workspace.yaml`
enumerates apps explicitly, so nothing here is built by `pnpm build` and nothing here may import
from `packages/*` — the wire contract is mirrored by hand and kept honest by tests.

## Status — all four slices complete

Shipped: sign-in, the acknowledgement gate, the always-visible tray indicator, manual and auto
tracking, the durable offline buffer, sync, idle detection with the away keep/discard prompt,
crash recovery, periodic screenshots, activity sampling and categorization, local nudges, a global
hotkey, self-updating, and packaging.

**On counts versus content, precisely.** The client counts input events, it never reads them:
`Activity/EventCounter` asks Windows for the raw-input message _header_ and nothing else, so key
identity is not merely ignored, it is never copied into the process. See "counts, never content"
below.

| Slice | Contents                                                           | State |
| ----- | ------------------------------------------------------------------ | ----- |
| S1    | Auth · AckGate · tray indicator · manual timer · buffer + sync     | done  |
| S2    | Idle detection · away keep/discard · crash recovery                | done  |
| S3    | Screenshots · activity sampling · categorizer                      | done  |
| S4    | Notifications · hotkey · updater · packaging · signing · dashboard | done  |

Everything is code-complete. What is left is the end-to-end checks that need a real machine and a
published release — see [`ROADMAP.md`](./ROADMAP.md). In particular nobody has yet run a real
screen grab, and row 9 (type a known string, grep every outbound body and local file) is the only
empirical demonstration of counts-not-content.

## What gets captured, and what cannot be

Everything below is installed **only** on the online, acknowledged branch of `AppDelegate`, and
each subsystem re-checks `AckGate` on **every tick** — so revoking an acknowledgement stops
capture within one interval rather than at the next launch.

| Subsystem                     | Cadence                               | Sends                                                  |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `Activity/EventCounter`       | continuous                            | nothing — two in-memory counters, read by the sampler  |
| `Activity/ActivitySampler`    | 60s, while the clock runs             | app name, bundleId, window title, activity %, category |
| `Capture/ScreenshotScheduler` | policy interval, while the clock runs | one JPEG per attached display                          |

Capture is tied to the clock: a stopped timer captures nothing, and — deliberately — does not even
cost a policy fetch.

### The `bundleId` convention — decided once, permanent

`ObservedAppsSchema` surfaces whatever the client sends straight into the admin's rule picker, so
an inconsistent convention pollutes that picker forever and cannot be cleaned up without touching
every team's saved rules.

This client sends **the lowercased executable filename without its extension** — `code`, `chrome`,
`devenv` — as `bundleId`, and the executable's `FileDescription` (falling back to that filename) as
`appName`. Full paths were rejected because they vary per machine and would fragment the picker
into one entry per install location; AUMIDs were rejected because most Win32 applications have
none.

The macOS client sends reverse-DNS (`com.microsoft.VSCode`) for the same application, so a
mixed-platform team sees both forms. That is unavoidable without a schema change, and harmless:
`Categorizer` matches a rule against the bundleId **or** the display name, so one rule on the
display name covers both platforms.

### Known gap: no site categorization on Windows

The macOS client reads the active browser tab's URL via AppleScript and categorizes by host.
Windows has no equivalent — UI Automation against address bars is fragile and per-browser, and an
extension is a separate product — so `host` is always null here.

The site-matching rules are still ported in full (they are shared with the Mac and the server still
sends site lists), they simply never fire. **The consequence is worth telling admins:** a Windows
user browsing in Chrome is categorized by the _Chrome app rule_, not by the site they are on.

## Build and test

Requires the .NET 9 SDK (`winget install Microsoft.DotNet.SDK.9`).

```powershell
dotnet build NiftyTimer.sln
dotnet test  NiftyTimer.sln
dotnet run --project src/NiftyTimer      # talks to 127.0.0.1:3001 by default
```

`TreatWarningsAsErrors` is on for both projects, so the build is also the lint gate. CI runs build,
test, package and sign on `windows-latest` (`.github/workflows/client-windows.yml`) — packaging is
part of the gate rather than a release-day step, so it cannot fail for the first time against a
build nobody had a chance to test.

To produce a distributable build:

```powershell
./scripts/package-app.ps1        # production URLs; -Dev for localhost
./scripts/sign.ps1               # no-op with a warning until a certificate exists
./scripts/release-assets.ps1     # NiftyTimer-windows-pilot.zip + .sha256 sidecar
```

Both asset filenames are contract — the update feed refuses a release missing either — and
`PackagingContractTests` asserts the scripts still agree with the constants the client compiles
against.

To run against a local stack: `docker compose -f infra/docker-compose.yml up -d`, `pnpm dev`,
`pnpm db:seed`, then launch the client. `src/NiftyTimer/appsettings.json` already points at
localhost and carries the `.dev` app id, so a checkout build keeps its state in
`%LOCALAPPDATA%\NiftyTimer-dev\` and cannot touch a released install's buffers.

### Integration tests

`tests/NiftyTimer.Tests/Integration/LiveApiTests.cs` drives the **real** HTTP clients against a
running API — login, refresh rotation, the acknowledgement round-trip, projects, self-totals, a
closed entry, the heartbeat, the 409 conflict, and both strict-mode 422 cases. The rest of the
suite stops at the `IUploader` / `IPolicyProvider` seam, so without these the request construction
itself is never executed.

They skip unless you point them at an API, so `dotnet test` and CI stay green without a stack:

```powershell
$env:NIFTYTIMER_E2E_API      = "http://127.0.0.1:3001/v1"
$env:NIFTYTIMER_E2E_EMAIL    = "admin@example.com"
$env:NIFTYTIMER_E2E_PASSWORD = "<your seeded password>"
dotnet test
```

Note they acknowledge monitoring for the account you sign in as, and briefly open and close a
running time entry.

## Dependencies

The macOS client has zero third-party dependencies by CLAUDE.md §2 policy, and this one mirrors
that. The app project references **no** NuGet packages at all; the test project references only
xunit and the test SDK.

Consequences worth knowing, since each replaces a package someone will reach for:

- **DPAPI** is called through P/Invoke (`Auth/TokenStore.cs`) rather than taking
  `System.Security.Cryptography.ProtectedData`.
- **The tray icon** is hand-rolled over `Shell_NotifyIcon` (`App/TrayIconController.cs`) rather
  than taking a tray-icon package.
- **Win32 signatures** are hand-written `DllImport`s throughout — raw input, GDI capture, monitor
  enumeration, DPAPI, the tray, the hotkey. The surface stayed small enough that CsWin32 (a
  build-time source generator, no runtime assembly) was never adopted; if it grows much further,
  that is the conversation to have — ask first.
- **Toasts are tray balloons**, not `Windows.UI.Notifications`. WinRT does not resolve from
  `net9.0-windows` — the same target-framework bump declined for screen capture — and a real toast
  would additionally need an AUMID registered by a Start Menu shortcut the unsigned pilot has no
  installer to create. Windows 10 and 11 render balloons through the Action Center regardless.

## Things that will bite you

Each of these cost the macOS client a real bug. They are enforced by tests; do not "clean them up".

- **`AckGate` is a closure-taking gate, not a boolean.** Capture code is passed _into_ it, so
  there is no way to reach a capture API without going through it. It fetches the policy on every
  call and fails **closed**. No admin override, no debug flag.
- **The offline branch cannot capture.** `AppDelegate.ProceedOffline` re-enables manual tracking
  only; capture subsystems are installed exclusively on the online, acknowledged branch. The two
  branches must not be merged into one with a flag.
- **The tray icon is created first and unconditionally.** No config, policy, build flag, or
  command-line switch hides it (PRD §4.2).
- **`.nullable()` vs `.optional()`.** `projectId`, `taskId`, `endTime` must serialize as explicit
  `null`; `note` must be **omitted**. Request bodies are parsed in Zod strict mode, so an extra
  field — a helpful `platform` or `deviceId` — is a 422.
- **A close must reach the server before the next open.** The server allows one open entry per
  **user** and only retires a previous one once it has gone stale, which a just-heartbeated row has
  not. Closes ride the durable buffer and arrive up to 90s later; opens publish immediately. So
  close-then-reopen — a project switch, a resume, a resolved away window, recovery-then-start — put
  a second open against a slot the first still holds: 409, clock stopped, "already tracking on
  another machine", no other machine. `LiveEntryPublisher` publishes the close too, and chains every
  publish so the ordering is a property of the code rather than of the network.
- **Any 2xx is success.** Narrowing `Classify` to 200/201 is what wedged the Mac client's buffer
  when an endpoint answered 202.
- **The heartbeat is a re-POST of the same open entry.** There is no `/heartbeat` route. Miss the
  server's freshness window (300s default; we heartbeat at 60s) and live time is silently
  truncated by every reporting query.
- **Refresh must stay single-flighted.** The server rotates refresh tokens single-use and treats
  one presented outside a 10s grace as reuse — revoking the whole token family and signing the
  machine out.
- **No local date maths.** The product's calendar is `Asia/Dhaka`. The server returns
  `day`/`weekStart`/`monthStart` already resolved precisely so the client never computes them.
- **A message-only window does not receive broadcast messages.** `HWND_MESSAGE` looks strictly
  better than a hidden top-level window — cheaper, unenumerable, invisible by construction — and
  everything directed still arrives, so it tests fine. But `TaskbarCreated` (Explorer restarted;
  re-add your tray icon) and `WM_POWERBROADCAST` (the machine slept) are broadcasts, and both are
  silently dropped. That is the always-visible indicator and sleep detection failing with no error
  anywhere. Use `App/MessageWindow`, which is top-level and hidden the honest way.
- **Idle detection reads a duration, never input.** `GetLastInputInfo` returns one tick-count
  scalar. Do not "improve" it into a hook: `WH_KEYBOARD_LL` sees key content, which CLAUDE.md §1
  forbids outright and which the macOS counterpart is physically incapable of.
- **Discard is the default for the away prompt, Keep for the recovery prompt — but dismissing
  either is always a Discard.** The default button answers "what should Enter do"; dismissal
  answers "what if nobody looks". An ignored prompt must never invent time.
- **Counts, never content — and on Windows that has to be built, not inherited.**
  `CGEventSource.counterForEventType` on macOS is physically incapable of returning key identity;
  Windows Raw Input can. So `EventCounter` calls `GetRawInputData` with **`RID_HEADER`, not
  `RID_INPUT`** — what comes back is the device type and nothing else, and the `RAWKEYBOARD`
  payload carrying `VKey`/`MakeCode` never enters this process. That is deliberately stronger than
  fetching the key and choosing not to look: there is no buffer here for a future change to start
  reading. Never a `WH_KEYBOARD_LL` hook (CLAUDE.md §1 forbids it outright, and it is the classic
  keylogger signature that enterprise EDR flags). The whole boundary is
  `IInputCounting { long KeyEvents; long PointerEvents; }` and `EventCounterBoundaryTests` asserts
  that member set **exactly**, so adding a third member fails CI.
- **The counters are only ever compared against zero.** A keyboard raises raw input on press _and_
  release, where the macOS counterpart counts only key-down, so the same typing yields roughly
  twice the count here. Nothing depends on the magnitude — a sub-bucket is "active" if the delta is
  positive — and telling press from release would mean reading `RAWKEYBOARD.Flags`, i.e. opening
  the payload. Do not "fix" the double count.
- **Screenshots use GDI, not Windows Graphics Capture.** WGC is the modern API and the design doc
  originally picked it, but it needs a target-framework bump plus several hundred lines of D3D11
  interop that CI cannot verify, and it draws a visible yellow capture border on Windows 10 builds
  predating the opt-out — a border flashing on every monitor every ten minutes. The trade is real
  and one-directional: GDI reads the composited desktop, so **DRM-protected video and some
  exclusive-fullscreen D3D capture as black**. `IDisplayGrabber` is the seam, so switching later
  touches one file and no test.
- **A measured activity cycle reschedules at zero, a skipped one waits the full interval.** The
  measurement itself consumes the interval, so rescheduling immediately is what keeps windows
  contiguous — …[0,60][60,120]… Collapse it to "always wait the interval" and every measured window
  is followed by a dead one: activity is sampled half as often and every rollup silently
  under-reports. A skipped cycle must wait, or a closed gate busy-loops the policy endpoint.
- **Every multipart TEXT field must precede the file part.** `@fastify/multipart`'s `req.file()`
  only exposes fields parsed before the file, so a file-first body arrives with undefined metadata
  and 422s every upload — permanently, so the screenshot is dropped rather than retried. That is
  why `ScreenshotUploader` hand-builds the body instead of using `MultipartFormDataContent`: field
  order in a pure builder can be asserted, order across a series of `Add` calls cannot.
- **`displayIndex` is capped at 15 and `displayCount` at 16 by the server schema.** Over either is
  a 422, which classifies as permanent and drops the capture, so the grabber caps the display count
  rather than letting an unusual desk silently lose its screenshots.
- **A screenshot's `timestamp` is stamped once, into the buffer filename, and reused verbatim on
  every retry.** It is half the server's composite key `[id, timestamp]` **and** its monthly
  partition key, so a retry that recomputed "now" would land in a different partition under a
  different key — duplicating the row instead of upserting it.
- **Never set `InvariantGlobalization`.** It looks like free hardening for an app whose wire
  formats are all culture-invariant, and it builds and unit-tests perfectly — but WPF reads the
  current input language through `CultureInfo` whenever keyboard focus moves, so the first Tab
  between two text fields throws `CultureNotFoundException` on the UI thread and kills the
  process. Culture independence is bought explicitly instead, with `CultureInfo.InvariantCulture`
  at every format and parse call that reaches the API.

## Two modes, one poller

The team setting `autoStartOnLogin` does two things: it selects the tracking **mode**, and it owns a
login item. Both are needed — a tray app cannot start tracking on a machine that never opened it,
which is exactly the bug #169 reported.

- **Auto** — `AutoTrackingCoordinator` opens an AUTO span on launch, closes it when you go idle, and
  asks keep-or-discard when you come back.
- **Manual** — you start the clock. `ManualIdleCoordinator` still asks about away windows, but
  **never stops a running manual entry on its own**; the only stop it performs is the trim you asked
  for by pressing Discard.

`ManualIdleCoordinator` is installed in both modes, because someone in auto mode can still start a
span by hand and that span needs the same prompt. The auto layer stands down for its duration —
enforced by refusing the signal at the edge, not by a check at the point of stopping.

`SessionObserver` is the single system edge for both, fanned out when they coexist. It polls
`GetLastInputInfo` every 15s and takes sleep and lock as immediate away signals rather than waiting
out the threshold.

### The login item

A value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, applied on the `!ackRequired`
policy branch and deliberately **outside `AckGate`** — it launches the app and captures nothing.
Visible and removable in Task Manager › Startup apps (CLAUDE.md §1): no service, no scheduled task,
nothing running as SYSTEM.

Three things to know:

- **It never rewrites a value that already exists.** That is how "don't fight the user" is reached
  here. macOS gets a `requiresApproval` status from `SMAppService` and refuses to register over it;
  Windows has no such read — Task Manager's enable/disable lives in an undocumented blob under
  `Explorer\StartupApproved\Run`, and its absence is indistinguishable from never having
  registered. But disabling there **leaves the Run value in place**, so "an existing value is left
  alone" respects the choice on every later launch without parsing anything undocumented. The one
  case genuinely weaker than macOS: deleting the value by hand in regedit is indistinguishable from
  never registering, so the next launch recreates it.
- **It reaches the employee at their _next_ login**, not the one in progress — registration only
  runs while the app is open. The settings page says so.
- **It survives sign-out, deliberately.** `SignOutAsync` tears down capture and clears the session
  but leaves the Run value alone, so the app still opens at the next login and shows the sign-in
  window — which is what someone who signed out temporarily wants. Removing it would strand them:
  the item can only be recreated by a launch that resolves a policy, so they would have to find and
  open the app by hand first. `HKCU` is per-Windows-account, so this does not leak an entry to a
  different Windows user; two employees sharing one Windows login is out of scope for monitoring
  software generally.
- **The value name is variant-scoped** (`Nifty Timer` vs `Nifty Timer (dev)`), like the
  `%LOCALAPPDATA%` container and the token file. With one shared name a dev build and a released
  install would overwrite each other's entry and whichever ran last would decide which one starts.
  The consequence is the same one the macOS README records for its two bundles: with both installed
  and auto-start on, you get **two** startup entries. Check Task Manager after testing with both.

**All of this is installed only on the online, acknowledged branch, through `AckGate`** — idle
detection watches you continuously and in auto mode moves your clock, so it is a capture path under
CLAUDE.md §1. `OfflineCaptureUnreachableTests` reads the IL of the offline branch and fails if it
can reach an installer.

## Crash recovery

`live-span.json` holds the one span that has started but not finished, rewritten by the same 60s
heartbeat that keeps the server's `heartbeatAt` fresh. It is deliberately not the durable buffer,
which holds completed records only.

On the next launch, if a span is there and belongs to the current user, you are asked to keep or
discard it. Keep closes it at the last heartbeat, so downtime is never counted and at most a minute
of real work is lost. Discard closes it at its **start** — a zero-duration row, not nothing at all,
because the server's row is still open and only a close releases the one-running-entry index. Drop
it instead and every future live entry for that user 409s forever while closed entries keep working,
which is why nobody would notice.

## One user, two machines

The database allows exactly one running entry per **user**, not per device. If someone is already
tracking on their Mac, starting here returns 409 and the clock rolls back with "Already tracking
on another machine" (`LiveEntryPublisher.ConflictDetected` → `MenuViewModel.HandleTrackingConflict`).

The quieter case is worth knowing about: if the _other_ client has not heartbeated for
`TRACKING_FRESHNESS_SECONDS` (300s — lid closed, no network), starting here **succeeds** and
silently closes the Mac's entry. The Mac then keeps heartbeating a row the server has already
closed and shows "tracking" while accruing nothing, until the user stops and restarts it. That is
inherent to supporting a second platform without a schema change; see the design doc's Known gaps.

## Layout

```
src/NiftyTimer/
  App/          AppDelegate (wiring + launch sequence) · TrayIconController · MessageWindow
                MenuViewModel · AutoTrackingCoordinator · ManualIdleCoordinator
                AppConfig · AppInstall · BuildStamp
  Auth/         AuthClient · AuthSession (single-flight refresh) · TokenStore (DPAPI) · JwtDecoder
  Policy/       AckGate · AckClient · AckMarker · LivePolicy · PolicyClient · EffectivePolicy
                Categorizer (pure — app/site rules, no hardware)
  Tracking/     TimeTracker · UuidV7 · IdleMonitor · ManualIdleMonitor · IdleState
                SessionObserver (+ FanOutSignalReceiver) · ManualNudgeMonitor
                IdleEventPayload · LiveSpanRecovery · DailyTotalAccumulator
                ActivityRateMeter (pure)
  Activity/     EventCounter (Raw Input, header only) · AppSampler · ActivitySampler
  Capture/      IDisplayGrabber · WindowsDisplayGrabber (GDI) · ScreenshotScheduler
  Storage/      BufferStore (file-per-record) · ImageBufferStore · ActivitySampleStore
                LiveSpanStore · UserSettings
  Sync/         SyncEngine · ScreenshotSyncEngine · ActivityBatchSyncEngine
                TimeEntryUploader · ScreenshotUploader · LiveEntryPublisher
                BackoffPolicy · TimeEntryPayload · ActivitySamplePayload
  Projects/     ProjectClient · ProjectCache · SelectionStore · SelectionResolver
  Reports/      SelfTotalsClient
  Notifications/ ILocalNotifier (toasts land in S4)
  UI/           TrayPopupWindow · LoginWindow · AckWindow · TimePromptWindow · Tokens.xaml
tests/NiftyTimer.Tests/
```

**Namespace placement is load-bearing**, not filing. `CaptureGateGuardTests` requires every
behavioural type in `NiftyTimer.Capture` / `NiftyTimer.Activity` to take an `AckGate` in its
constructor — which is what makes "no capture path can bypass the gate" literally true rather than
a convention. So the pure pieces live elsewhere on purpose: `Categorizer` classifies policy lists,
`ActivityRateMeter` does arithmetic, the stores hold what was already captured and the sync engines
drain it. Putting one of those in a capture namespace would force an unused gate parameter on it,
and a guard satisfied by ceremony stops being a guard.

File names deliberately mirror `apps/client-macos/Sources/TimeTrack/`, so a bug fixed in one
client points straight at its counterpart in the other.

## Regenerating the tray icons

```powershell
pwsh ./scripts/generate-tray-icons.ps1
```

The `.ico` files are committed, not generated at build time, and the project copies them by
explicit name. A rename becomes a build failure rather than an app that silently starts without
its indicator.
