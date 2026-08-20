# Multi-display capture, popover pinning, and prompt UX

Branch: `feat/multi-display-capture` (from `main` @ 351c244)

Three asks, split by shipping boundary. **Slice A is client-only** — no contract, no
migration, no deploy ordering. **Slice B crosses db → contracts → api → dashboard → client.**
Both land on one branch as separate commits (a second branch stacked on this one would strand
commits; see the merged-PR lesson from #135).

---

## Slice A — menu-bar popover pinning + prompt visibility

### A1. Popover drifts when a fullscreen app is frontmost

`StatusItemController.togglePopover()` calls `NSApp.activate(ignoringOtherApps: true)` and then
positions the popover from `button.window!.frame`, read **inline**. When the frontmost app is
fullscreen, activation triggers a Space transition; the status bar re-lays out during it (the
fullscreen app's own menu items come and go), so the frame read is not where the icon lands.
The popover ends up offset — to the right, per the report.

Fix, in order:

1. Give the popover window `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]` so
   it can render over a fullscreen space at all.
2. Re-pin on the next runloop turn as well as inline, reading the button frame **fresh** both
   times, so a relayout during the transition is corrected.
3. Clamp x into the `visibleFrame` of the screen that **contains the button**, not
   `NSScreen.main`.

Extract `popoverOrigin(buttonFrame:popoverSize:visibleFrame:) -> NSPoint` as a pure static —
same shape as the existing `static func tooltip(...)` — and unit-test it. The AppKit wiring
around it is manual-verify only; no test claims to cover it.

### A2. Keep/discard prompts are easy to miss and read as bare dialogs

`RecoveryWindowController` and `AwayResolutionWindowController` build a plain `.titled`
`NSWindow` at default level with default collection behavior. Over a fullscreen app that lands
on **another Space** — the user never sees it. That is the "not visible" complaint; the styling
is the second half.

- Window: `level = .floating`, `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`,
  centered on the **active** screen rather than `window.center()`'s main-screen default.
- View: one shared `TimePromptView` in the visual language `DistractionNudgeView` already
  establishes (tinted icon disc, headline, prominent filled default button).

**Load-bearing asymmetry — must survive the refactor.** The two prompts have deliberately
opposite defaults:

| Prompt                                   | `.defaultAction` | Dismiss (close button) resolves to |
| ---------------------------------------- | ---------------- | ---------------------------------- |
| Recovery (relaunch after crash/shutdown) | **Keep**         | Discard                            |
| Away (resume from idle, PRD §6.1)        | **Discard**      | Discard                            |

The default action stays a **parameter** of the shared view. Flattening it into one hardcoded
default is the exact failure a shared component invites. Also untouched: `dismissIfShowing()`
and the fire-once `resolve` guard (`client-signout-prompt-window-leak` — recurred twice).

---

## Slice B — capture every display, grouped per capture instant

Today `ScreenCaptureKitGrabber.grab()` returns **one** JPEG: it prefers `CGMainDisplayID()` and
falls back to `displays.first`. Not random, but on a multi-monitor desk only one screen is ever
recorded, and the fallback ordering is unstable.

"Group them in a time group" = group by **capture instant** (all displays grabbed in one tick),
not a new hourly bucket.

### Grouping key

Explicit `captureGroupId` + `displayIndex` + `displayCount`, not grouping-by-shared-timestamp.
Shared timestamp would work — ids differ, so `[id, timestamp]` PKs never collide — but it
cannot express "display 2 of 2 failed to capture", and legacy rows would need a real fallback.
With an explicit id the fallback for `captureGroupId IS NULL` is "group of one", trivially
correct: historically there was only ever one shot per instant.

No `captureAllDisplays` team setting — the ask is unconditional, and `TeamSettings` changes
carry the `.partial()` default-injection landmine.

### Order (dependency order; each step is a commit)

1. **db** — `packages/db/prisma/schema.prisma` + hand-authored `migration.sql` (`migrate dev`
   needs a TTY this harness doesn't have) → `db:deploy` → `db:generate` → rebuild. Three
   nullable columns on the partitioned parent. No unique constraint that excludes `timestamp`.
2. **contracts** — new fields on `ScreenshotSchema` (nullable) and `UploadScreenshotMetaSchema`
   (**optional**, so an old client still validates). Multipart fields arrive as strings →
   coerce the numerics.
3. **api** — controller assembles meta from form fields; repository has **two** select lists
   (the inline one in `listByUser` and the static `SELECT`) — miss either and reads silently
   drop the new fields.
4. **dashboard** — grouping transform + spec in `screenshot-view.ts`, then `ScreenshotsPanel`.
   Test the pure transform (vitest is node-env, no jsdom). Verify rendering through
   `people/[userId]`, not `/me` — `MeTabs` only puts the active tab in the DOM.
5. **client** — `DisplayGrabber` (returns per-display results; every conformer including test
   fakes updates in the same commit), `ScreenshotScheduler`, `ImageBufferStore`,
   `ScreenshotUploader`, `ScreenshotSyncEngine`.

### Constraints that will bite

- **Multipart field order.** Every TEXT field must precede the file part or `req.file()` never
  sees it → 422 on every upload. New fields go next to `id`/`timestamp`, before the file.
- **Old API accepts a new client.** The controller hand-picks named fields out of
  `part.fields` rather than passing the whole form through a strict schema, so unknown extra
  fields are ignored, not rejected. The client is therefore safe to ship early — but deploy
  API first anyway so the data is actually recorded.
- **Partial capture failure.** Today one throw skips the whole tick; with N displays a flaky
  external monitor would kill capture on all of them. Grab each display independently, enqueue
  what succeeded, treat only zero-captured as a failed tick. `notPermitted` from any display
  still raises the permission warning; a lone `captureFailed` must not.
- **Stable display order.** `SCShareableContent.displays` order is not guaranteed across calls.
  Sort main-display-first, then by `displayID`, and derive `displayIndex` from that — otherwise
  the same physical monitor swaps grid position between groups.
- **Buffer upgrade compatibility.** `ImageBufferStore` encodes identity in the filename
  `<millis>__<uuid>.jpg` and its parser requires exactly 2 components. Entries written by the
  currently-installed build must still drain after the update, so the parser accepts both the
  legacy 2-part form (→ group of one) and the new 4-part form.
- Capture fan-out happens **inside** `ackGate.withCaptureAllowed`, never around it.

### Stated, not solved

Storage and retention now scale by monitor count: a two-monitor user doubles both object count
and bytes at the same interval. `maxCount: 500` on the client buffer is now ~250 capture
instants for that user rather than 500. Flagging, not changing — the retention/interval call
is the user's.
