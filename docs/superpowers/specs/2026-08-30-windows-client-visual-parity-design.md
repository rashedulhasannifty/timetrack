# Windows client visual pass — teal token layer, templated controls, dark mode

Design doc · 2026-08-30 · covers 3 PRs, each of which gets its own plan.

## Context

`apps/client-windows` ships four WPF windows — `TrayPopupWindow`, `LoginWindow`, `AckWindow`, `TimePromptWindow` — plus a 30-line `UI/Tokens.xaml`. The functionality is complete and tested. The appearance is not: the client looks visibly unfinished next to both the macOS client and the dashboard.

Two independent causes, and the second is the larger one.

**1. `Tokens.xaml` is a third palette.** The repo now carries three unrelated colour systems:

| Surface                                     | Accent                | Ground                | Dark |
| ------------------------------------------- | --------------------- | --------------------- | ---- |
| `apps/dashboard/src/app/globals.css`        | `#0f766e` / `#43c0af` | `#f6f6f4` / `#111113` | yes  |
| `apps/client-macos` `TimeTrackTokens.swift` | `#007AFF` / `#0A84FF` | `#F4F4F6` / `#1C1C1E` | yes  |
| `apps/client-windows` `UI/Tokens.xaml`      | `#16A34A`             | `#FFFFFF` only        | no   |

The Windows values match neither. The file says so itself — _"Kept deliberately small: a handful of shared values, not a design system."_ It was a placeholder that shipped.

The macOS/dashboard split was deliberate and is documented at `globals.css:10-12`: _"these values now differ from the macOS client's TimeTrackTokens.swift … restyling the client is a separate pass and was deliberately left out of this change."_ No such pass is scheduled in `docs/superpowers/plans/`, and the macOS design bundle (`design files/timetrack-design-system-mac-os-client/`) still carries `#007AFF`, so it documents the _current_ Mac build rather than a teal future.

**2. Every control is stock WPF.** `Button`, `TextBox`, `PasswordBox`, `ComboBox` and `ScrollBar` render Aero-era grey gradients regardless of which brushes are bound to them. **Recolouring alone does not fix the reported problem.** The control templates are the larger half of this work.

Outcome: the Windows client reads as the same product as the dashboard — same semantic roles, same type voice, no stock WPF chrome anywhere — in both light and dark.

---

## Decisions locked

| Decision                | Choice                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Target palette          | **Dashboard teal** (`globals.css`), not the macOS client's blue                                                             |
| Windows/macOS parity    | **Deferred.** The two clients will differ until the macOS teal pass lands                                                   |
| Dark mode               | **In scope**, follows the OS                                                                                                |
| Theming mechanism       | **Two swapped dictionaries + `DynamicResource`** (not in-place brush mutation)                                              |
| Font                    | **Segoe UI Variable**, tokenized. The dashboard's Schibsted Grotesk is **not** shipped                                      |
| Tabular digits          | `Typography.NumeralAlignment=Tabular`, replacing the `Consolas` hack                                                        |
| Scope                   | **Four existing windows.** `AwayResolutionWindow` / `RecoveryWindow` / `DistractionNudgeWindow` are **out** — see Non-goals |
| Third-party WPF theming | **None.** No WPF-UI / ModernWpf / MahApps                                                                                   |
| Phasing                 | **3 PRs**, each independently shippable and green                                                                           |
| Commit scope            | `client` (CLAUDE.md §0 enum)                                                                                                |

### Palette decision — why teal rather than matching macOS

The literal request was that Windows match the Mac client. Teal was chosen anyway, with the trade-off stated and accepted: **Windows will match the dashboard and will not match the macOS client** until the deferred Mac pass runs. Targeting Mac's blue would have satisfied the request sooner but left both clients diverged from the dashboard and required a second restyle of both.

Consequence for this doc: _"does it look like the Mac app"_ is **not** an acceptance criterion. See Verification.

### Dependency policy

Unchanged from `2026-08-25-windows-client-design.md`: the client has zero third-party runtime dependencies. This pass adds none.

Worth recording, because the earlier design doc implies otherwise: **`Microsoft.Windows.CsWin32` is not actually in `NiftyTimer.csproj`.** All P/Invoke in this client is hand-rolled `[DllImport]`. `DwmSetWindowAttribute` (below) follows that existing pattern rather than reintroducing the generator.

---

## Non-goals

`2026-08-25-windows-client-design.md:108` lists `AwayResolutionWindow`, `RecoveryWindow` and `DistractionNudgeWindow` under `UI/`. None exist. All three stay out of this pass, for two different reasons.

**`AwayResolutionWindow` + `RecoveryWindow` — deliberately consolidated, do not build.** `UI/TimePromptWindow.xaml.cs` is one shared keep-or-discard card serving both prompts; only the copy and the default button differ (`TimePrompts.PresentAway` defaults to Discard so the clock never invents time; `PresentRecovery` defaults to Keep so Enter never throws away real work). The consolidation is documented in the type's own header and covered by `TimePromptTests.cs`. Splitting it back into two windows would undo shipped, tested work under cover of a visual pass.

**`DistractionNudgeWindow` — a feature, not a style.** `Policy/EffectivePolicy.cs:53-59` parses `DistractionAlertsEnabled`, `DistractionThresholdMinutes` and `DistractionRepeatMinutes`, and **nothing consumes them**. There is no `DistractionMonitor` and no fallback notifier; macOS has both (`Notifications/FallbackDistractionNotifier.swift`, `UI/DistractionNudgeView.swift`). Building the window means building the monitor, the policy plumbing and their tests. That is its own spec.

Also out: the macOS teal pass, and any change to `apps/dashboard` or `apps/client-macos`.

---

## Theming mechanism

The one real architectural choice, because WPF provides nothing for dark mode.

**Rejected — mutate brush colours in place.** `{StaticResource}` hands every consumer a reference to the same `SolidColorBrush`; assigning `.Color` at runtime updates all of them with no sweep. It fails on two counts: it cannot carry non-colour tokens, and the dashboard's dark theme _does_ change one (`--tt-elevation-1: none` — the mockup drops card shadows entirely in dark). It also breaks silently the first time someone adds a frozen brush.

**Chosen — two dictionaries, swapped.** `UI/Theme.Light.xaml` and `UI/Theme.Dark.xaml` hold the raw values; `App.xaml` merges one at `MergedDictionaries[0]`; `UI/Tokens.xaml` and `UI/Styles.xaml` merge after it and reference it. Swapping index 0 re-themes the app.

### The `StaticResource` trap — a required, verified step

`{StaticResource}` **resolves once at load and never again.** All four XAML files use it exclusively today.

`TrayPopupWindow` is constructed once and lives for the whole session (`TrayIconController` shows and hides it; it is not recreated). So a partial sweep produces exactly one failure mode: **the tray popup is the single window that never re-themes**, and a fresh-launch test in either theme passes anyway. This is why the sweep is a numbered implementation step with its own verification, not cleanup.

Rule: every brush and elevation reference moves to `{DynamicResource}`. `Style` and `ControlTemplate` references may stay `StaticResource`; the brushes _inside_ them may not.

### Theme detection

- Read `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\AppsUseLightTheme` at startup. Missing value → light.
- Subscribe to `WM_SETTINGCHANGE`, filtered to `lParam == "ImmersiveColorSet"` — the canonical theme-change broadcast — on a hidden `MessageWindow`: the same kind of window the tray icon already uses to catch `TaskbarCreated` and `WM_POWERBROADCAST`. It is **top-level rather than message-only** precisely so broadcasts like this one reach it; a message-only window would silently drop it, the same reason the tray icon's window is top-level.
- **A window procedure runs on the UI thread**, which removes rather than mitigates the problem the spec originally reached for `SystemEvents.UserPreferenceChanged` to solve: `SystemEvents` delivers its callback on a dedicated non-UI thread and requires marshalling to the dispatcher before touching `Application.Current.Resources`. `MessageWindow`'s `WndProc` needs no such marshalling — it is already on the UI thread.
- Unsubscribe on shutdown — disposing the message host removes the hook and tears down the window.

---

## Token mapping

`UI/Tokens.xaml` becomes the semantic layer, named 1:1 with `globals.css` so the two cannot drift.

| Role            | Light     | Dark      |
| --------------- | --------- | --------- |
| `Surface`       | `#f6f6f4` | `#111113` |
| `SurfaceRaised` | `#ffffff` | `#1a1a1d` |
| `Separator`     | `#eae9e5` | `#28282c` |
| `Text`          | `#191917` | `#f1f1ef` |
| `TextSecondary` | `#73726c` | `#9d9d97` |
| `Neutral`       | `#a4a39d` | `#676762` |
| `Accent`        | `#0f766e` | `#43c0af` |
| `AccentHover`   | `#0d5f59` | `#6bd3c4` |
| `Tint`          | `#edf3f2` | `#1d2725` |
| `Destructive`   | `#bb2020` | `#f47272` |
| `Recording`     | `#0f766e` | `#43c0af` |
| `Good`          | `#15803d` | `#4ade80` |
| `Manual`        | `#b45309` | `#fbbf24` |
| `MarkRemaining` | `#3f7a72` | `#3f7a72` |
| `MarkElapsed`   | `#7fd6c9` | `#7fd6c9` |

`MarkRemaining` / `MarkElapsed` are **theme-invariant on purpose**, matching the same note in `globals.css` and `TimeTrackTokens.swift`: the same two values are baked into the app artwork, which cannot follow a theme.

The table maps **roles**, so the four brushes in today's `Tokens.xaml` retire onto it explicitly rather than by inference:

| Today                | Becomes         |
| -------------------- | --------------- |
| `SurfaceBrush`       | `SurfaceRaised` |
| `BorderBrushSubtle`  | `Separator`     |
| `TextPrimaryBrush`   | `Text`          |
| `TextSecondaryBrush` | `TextSecondary` |
| `WarningBrush`       | `Manual`        |
| `AccentBrush`        | dropped         |

`Tint` backs the selected row in PR 2's project picker and the update-row chip. `Good` and `Neutral` are carried for role-parity with `globals.css` but have **no consumer in these four windows** — they exist so a later surface does not invent a fifth palette, and PR 1 should not manufacture a use for them.

Radii `sm 6 / md 11 / lg 20`, 4px spacing base, and the `e1`/`e2` elevations port directly.

### Type

Segoe UI Variable throughout. Only the part of the dashboard's scale these windows actually use is ported — micro 11 / caption 12 / label 13 / body 15 / h2 19. The dashboard's `h1` and 52px `display` have no counterpart here; the largest text in the client is the 34px elapsed timer, which gets its own `Elapsed` style rather than being forced onto a dashboard step.

**Why not Schibsted Grotesk.** Shipping the dashboard's webfont into the client was considered and rejected on rendering grounds rather than licensing: WPF text rendering is not a browser's, and a webfont-designed grotesk renders measurably worse under ClearType at the 11–13px sizes that dominate these four windows. The type styles are tokenized so a later swap touches only `Tokens.xaml`.

**Tabular digits.** `Tokens.xaml` currently reaches for `Consolas` — a code font — to fake column alignment on the elapsed timer. The correct WPF answer is `<Typography.NumeralAlignment>Tabular</Typography.NumeralAlignment>` on the normal UI font, which is the direct equivalent of the dashboard's `.tt-numeric` and macOS's `.monospacedDigit()`. Applies to every duration, total and timestamp. Dropping Consolas is on its own a large share of the reported ugliness.

---

## PR 1 — token and style layer

Appearance only. No window's structure changes; all four inherit the new look because they all use stock controls today.

- `UI/Theme.Light.xaml`, `UI/Theme.Dark.xaml` — raw values.
- `UI/Tokens.xaml` — rewritten as the semantic layer above; type styles.
- `UI/Styles.xaml` — new. Implicit and keyed `ControlTemplate`s:
  - `Button` in three variants matching the macOS client's SwiftUI vocabulary — `.borderedProminent` (accent fill), `.bordered` (separator outline), `.link` (accent text, no chrome). The tray popup's footer currently uses stock push buttons where macOS uses text links, which alone reads as a different product.
  - `TextBox`, `PasswordBox` — recessed `Surface` fill, `Radius.sm`, no 3D border.
  - `ComboBox` — restyled here; **replaced** in PR 2.
  - `ScrollBar` / `ScrollViewer` — stock WPF scrollbars are instantly recognisable as undesigned.
  - `FocusVisualStyle` — replaces the default dotted rectangle with the dashboard's `2px accent, 2px offset`.
- `App.xaml` — merge order, theme swap plumbing, `WM_SETTINGCHANGE` subscribe/unsubscribe via `MessageWindow`.
- The `DynamicResource` sweep across all four windows.
- The tray popup corner change — **one atomic step**, see below.

### The corner change is one step, not three

`TrayPopupWindow.xaml` sets `AllowsTransparency="True"` to get its rounded card. That **forces software rendering for that window**, which degrades ClearType — on the one surface where text quality is the entire deliverable. So it goes. But the rounding is currently produced by three cooperating settings, and removing one of them alone ships something worse than today:

1. `AllowsTransparency="True"` + `Background="Transparent"` on the `Window`
2. `WindowStyle="None"`, which stays
3. the inner `<Border CornerRadius="8">`

Drop only (1) and the window becomes an opaque, still-chrome-less square with a rounded rectangle floating inside it and its corners painted in the window background. Keep (3) after adding DWM rounding and the window corner and the border corner produce a visible double-rounded seam, because `DWMWA_WINDOW_CORNER_PREFERENCE` rounds the **window**, not the `Border`.

All three parts land together, in this order, as a single implementation item:

1. Remove `AllowsTransparency="True"` and `Background="Transparent"`; give the `Window` an explicit `SurfaceRaised` background.
2. Set the inner `Border`'s `CornerRadius` to `0` (it stays for padding and the outline).
3. On `SourceInitialized`, call `DwmSetWindowAttribute` with `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND` (attribute 33) on the HWND.

Windows 10 does not support attribute 33; the call returns a failure HRESULT and must be ignored rather than thrown on. The client already targets Windows 10 builds (see the GDI-over-WGC note in `ROADMAP.md`), so square corners on Win10 is the accepted degradation.

**Verify popup placement after this change.** `TrayIconController` positions the window against the notification area; that math is written against a transparent, borderless window and may shift once it is opaque. Check the popup still lands flush with the tray in both themes.

### Tray icons

`Resources/tray-idle.ico` and `tray-tracking.ico` are **state** variants, not light/dark ones. Dark mode changes the notification-area background, and a dark-on-dark tray icon would be the most visible failure of this pass. Dark variants are generated via the existing `scripts/generate-tray-icons.ps1` and selected off the same `AppsUseLightTheme` signal.

`NiftyTimer.csproj` copies the two current icons **by explicit name, not a glob**, precisely so a rename fails the build (the tray icon is the always-visible indicator, PRD §4.2). The new files are added the same way — explicitly, four `Content` entries — and `TrayIconController` continues to throw if any is unreadable.

---

## PR 2 — `TrayPopupWindow` structural parity

The surface an employee sees all day. Ports the structure of `apps/client-macos/Sources/TimeTrack/UI/MenuBarView.swift`.

| Element        | Today                     | After                                                                  |
| -------------- | ------------------------- | ---------------------------------------------------------------------- |
| Status         | bare `StatusLabel` text   | dot + phase label — `● Recording` / `● Paused` / `Idle · Not tracking` |
| Elapsed        | 26px Consolas             | 34px light, tabular                                                    |
| Totals         | three plain columns       | uppercase tracked captions, tabular semibold values, 1px dividers      |
| Project picker | editable stock `ComboBox` | search field + scrolling two-line project/task list with checkmark     |
| Buttons        | fixed 92px, text only     | prominent/bordered variants, play/pause/stop glyphs                    |
| Footer         | stock push buttons        | link variant                                                           |
| Brand          | none                      | `BrandMark`                                                            |

The picker is the only genuine rewrite. `MenuViewModel` exposes `Projects` and `SelectionLabel` but has no query/filter member — macOS's `filteredChoices` + `query` have no counterpart, because the stock `ComboBox` supplied text search for free. PR 2 adds a filtered projection to `MenuViewModel` with unit tests, and the XAML binds a list rather than an items-source.

**Already correct, do not "fix":** `MenuViewModel.cs:176-180` already returns `"—"` for unknown totals rather than a confident zero. That behaviour is right and stays; only its rendering changes.

**Not in this PR:** macOS ticks the totals live while tracking (`TimelineView` adding elapsed-since-fetch on top of the server figure). Windows refreshes them on menu open. That is a behavioural gap, not a visual one — noted here so it is not silently absorbed into a styling PR.

### `BrandMark`

Ported from `apps/client-macos/Sources/TimeTrack/UI/BrandMark.swift`, which itself mirrors the dashboard's geometry exactly: 24×24 box, r=7.3, stroke 3.4, centre `(12, 12.5)`, handover at 161.97°, butt caps. Those constants are load-bearing — reading the centre as `(12, 12)` puts the arcs 4° apart and shows as a seam. Drawn in XAML, not loaded from the `.ico` (1024px artwork reads as mud at 18px).

`NiftyTimer.csproj` does `<Using Remove="System.Windows.Shapes" />` so `System.IO.Path` wins the name collision. This affects **C# code-behind only** — XAML resolves `<Path>` through its xmlns, so markup is unaffected. Any C# that touches shape types needs an explicit `using`.

---

## PR 3 — `LoginWindow`, `AckWindow`, `TimePromptWindow`

Layout and hierarchy on the remaining three, on top of PR 1's chrome.

### Constraints that override any visual preference

**`AckWindow` — no custom close affordance.** If the window moves to custom chrome, it gets **no titlebar X and no Escape-to-dismiss**. The window deliberately offers no "decline and continue anyway"; a close button that dismisses without acknowledging is a `monitoringAckAt` bypass (CLAUDE.md §1, PRD §4.1). "Not now" stays the only non-acknowledging exit, and it is explicit.

**`NoticeLabel` stays visible.** The monitoring notice in `TrayPopupWindow` is never collapsible, never behind a disclosure, never truncated behind a tooltip (CLAUDE.md §1; `ROADMAP.md` invariants — no setting, build flag or command-line switch hides the indicator). It may be restyled; it may not be made dismissible.

**`TimePromptWindow` named elements are load-bearing.** `TimePromptTests.cs:165` calls `window.FindName("KeepButton")` and casts to `System.Windows.Controls.Button`. Restyling via `ControlTemplate` is safe. Replacing it with a custom control, or renaming `TitleLabel`, `MinutesLabel`, `MessageLabel`, `KeepButton` or `DiscardButton`, is not. Read that test before touching the window.

The prompt's own invariants are unchanged by a visual pass and must survive it: dismissing resolves to **Discard** in both prompt kinds whatever the default button is, and `Resolve` fires exactly once via the shared latch.

---

## Testing

Existing suites stay green — `CaptureGateGuardTests`, `OfflineCaptureUnreachableTests`, `TimePromptTests`.

New unit tests:

- **Theme resolution** — registry value `0` → dark, `1` → light, missing → light. Pure function over an injected reader, following the client's existing closure-injection pattern.
- **Theme dictionary completeness** — every key in `Theme.Light.xaml` exists in `Theme.Dark.xaml` and vice versa. Catches the half-added token, which otherwise surfaces as a `null` brush in one theme only.
- **No `StaticResource` on a themed brush** — reads the four window `.xaml` files as text and asserts zero occurrences of `{StaticResource` followed by any role name from the token table. Crude, deliberately so: dictionary completeness passes whether or not the sweep was finished, so without this test the top-listed risk in this doc has no automated guard at all and rests on someone remembering to toggle the theme by hand. This one fails in CI instead.
- **Picker filtering** (PR 2) — the new `MenuViewModel` projection: match on project and task name, empty query returns all, no match returns empty.

`TreatWarningsAsErrors` is on, so `dotnet build NiftyTimer.sln -c Release` is also the lint gate.

---

## Verification

**`dotnet build` is not verification for this work.** A restyle compiles clean and passes every test while still looking wrong; the entire deliverable is how it looks. Each PR is checked by running the app:

1. Launch, open the tray popup, inspect in **light**.
2. Switch Windows to dark **with the popup open** — this is the `DynamicResource` test, and the one a relaunch cannot perform.
3. Confirm the tray icon is legible against both notification-area backgrounds.
4. Walk all four windows in both themes.

Acceptance criteria — note that _matching the macOS client is deliberately not among them_:

- Roles read the same as the dashboard side by side against a screenshot.
- No stock WPF chrome visible anywhere — no grey gradient buttons, no Aero scrollbars, no dotted focus rectangles.
- Every duration and total is tabular; no Consolas.
- Theme switches live, all four windows, tray icon included.

If the app cannot be launched in the working environment, that is reported plainly rather than substituting build output for a visual result.

---

## Risks

| Risk                                                                       | Mitigation                                                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Partial `DynamicResource` sweep — popup silently never re-themes           | The no-`StaticResource` text test fails it in CI; also verified by hand by toggling the theme with the popup open |
| Half-done corner change ships a square window with a rounded box inside it | The three parts are one atomic implementation item, not three bullets                                             |
| `WM_SETTINGCHANGE` also fires for DPI, locale and accessibility changes    | Filtered to `lParam == "ImmersiveColorSet"`; unsubscribe on shutdown                                              |
| `DWMWA_WINDOW_CORNER_PREFERENCE` unsupported on Windows 10                 | Ignore the failure HRESULT; square corners is the accepted degradation                                            |
| Hand-rolled `ControlTemplate`s lose keyboard/accessibility behaviour       | Template stock controls rather than replacing them; keep `FocusVisualStyle`                                       |
| A visual PR quietly weakening the ack gate or the monitoring notice        | Called out as hard constraints in PR 3; `CaptureGateGuardTests` stays green                                       |
| Scope drift into the three non-goal windows                                | Recorded as non-goals with the reason each is excluded                                                            |
