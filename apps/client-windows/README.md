# Nifty Timer for Windows

Native Windows client. C# / .NET 9 + WPF, tray-resident, talking to the same `/v1` API and
dashboard as the macOS client.

Design doc: [`docs/superpowers/specs/2026-08-25-windows-client-design.md`](../../docs/superpowers/specs/2026-08-25-windows-client-design.md).

This directory is **outside the pnpm graph**, exactly like `apps/client-macos`. `pnpm-workspace.yaml`
enumerates apps explicitly, so nothing here is built by `pnpm build` and nothing here may import
from `packages/*` — the wire contract is mirrored by hand and kept honest by tests.

## Status — slice 1 of 4

Shipped: sign-in, the acknowledgement gate, the always-visible tray indicator, manual tracking,
the durable offline buffer, and sync.

**There is no capture code in this build.** No screenshots, no activity sampling, no idle
detection. Those land in S2 and S3, and only ever behind `Policy/AckGate`.

| Slice | Contents                                                           | State       |
| ----- | ------------------------------------------------------------------ | ----------- |
| S1    | Auth · AckGate · tray indicator · manual timer · buffer + sync     | done        |
| S2    | Idle detection · away keep/discard · crash recovery                | not started |
| S3    | Screenshots · activity sampling · categorizer                      | not started |
| S4    | Notifications · hotkey · updater · packaging · signing · dashboard | not started |

## Build and test

Requires the .NET 9 SDK (`winget install Microsoft.DotNet.SDK.9`).

```powershell
dotnet build NiftyTimer.sln
dotnet test  NiftyTimer.sln
dotnet run --project src/NiftyTimer      # talks to 127.0.0.1:3001 by default
```

`TreatWarningsAsErrors` is on for both projects, so the build is also the lint gate. CI runs the
same three commands on `windows-latest` (`.github/workflows/client-windows.yml`).

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
- **Win32 signatures** are hand-written `DllImport`s. The surface is small in S1; if S3's capture
  work makes it large, that is the moment to discuss adopting CsWin32 (a build-time source
  generator, no runtime assembly) — ask first.

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
- **Never set `InvariantGlobalization`.** It looks like free hardening for an app whose wire
  formats are all culture-invariant, and it builds and unit-tests perfectly — but WPF reads the
  current input language through `CultureInfo` whenever keyboard focus moves, so the first Tab
  between two text fields throws `CultureNotFoundException` on the UI thread and kills the
  process. Culture independence is bought explicitly instead, with `CultureInfo.InvariantCulture`
  at every format and parse call that reaches the API.

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
  App/        AppDelegate (wiring + launch sequence) · TrayIconController · MenuViewModel
              AppConfig · AppInstall · BuildStamp
  Auth/       AuthClient · AuthSession (single-flight refresh) · TokenStore (DPAPI) · JwtDecoder
  Policy/     AckGate · AckClient · AckMarker · LivePolicy · PolicyClient · EffectivePolicy
  Tracking/   TimeTracker · UuidV7
  Storage/    BufferStore (file-per-record) · UserSettings
  Sync/       SyncEngine · TimeEntryUploader · LiveEntryPublisher · BackoffPolicy · TimeEntryPayload
  Projects/   ProjectClient · ProjectCache · SelectionStore · SelectionResolver
  Reports/    SelfTotalsClient
  UI/         TrayPopupWindow · LoginWindow · AckWindow · Tokens.xaml
tests/NiftyTimer.Tests/
```

File names deliberately mirror `apps/client-macos/Sources/TimeTrack/`, so a bug fixed in one
client points straight at its counterpart in the other.

## Regenerating the tray icons

```powershell
pwsh ./scripts/generate-tray-icons.ps1
```

The `.ico` files are committed, not generated at build time, and the project copies them by
explicit name. A rename becomes a build failure rather than an app that silently starts without
its indicator.
