# Dashboard Redesign — Slice 6: My Time reskin (Implementation Plan)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Reskin `/me` to the mockup — a timesheet-status header card, reskinned tabs, and the
Timeline / Activity / Screenshots / Idle panels (Activity adopts the Slice-2 chart kit). Adopt the
shared `Badge` (the second deferred Slice-1 migration). Keep all self-scoped data loading + degrade.

**Architecture:** `apps/dashboard` only. Server page composes the header card + client `MeTabs`.
Uses `SetPageTitle`, `Card`, `SectionHeader`, `Badge`, and charts `StackedDayBars`/`BarMeter`/
`CategoryMixBar`.

## Global Constraints

- `dashboard` scope only. No api/contracts/db change. No new dependency. No console.log.
- **Preserve behavior:** self-scoped `Promise.all` loads with per-panel `.catch(→[])` degrade;
  `selfApprovals` filter; the 4 tabs; screenshot redact action; idle list. Do NOT change data logic.
- **Data reconciliation:**
  - Timesheet header (mockup L463–473) shows "this week" hours + a status pill + a "Submit for
    approval" button + a "Tracking now" chip. We have the approval rows (`myApprovals`) but **no
    submit-timesheet action and no live "tracking now" signal on this page** → render the header
    from the **latest** approval row (week label + tracked hours + `Badge` status); **omit** the
    Submit button and Tracking-now chip (no backing) unless an existing action is found. Keep the
    remaining weeks as a compact list below the header (don't lose history).
  - Activity tab (mockup L500–545): active-minutes KPI + 7-day daily bars + top apps/sites + category
    mix. Reskin `ActivitySummaryPanel` to use `StackedDayBars` or the existing daily bars, `BarMeter`
    for the apps/sites list, and `CategoryMixBar` for the mix — from the SAME `ActivityDailySummary`
    data it already consumes (no new data).
- Adopt `Badge` in `ApprovalsPanel`; remove its local `BADGE_TONE` (tone map neutral→neutral,
  positive→good, warning→warning). This is the 2nd deferred Slice-1 pill migration.
- Title → header via `SetPageTitle title="My time"`; remove `PageHeader`.
- Commits `feat(dashboard)`/`refactor`/`test` ≤72, NO AI attribution, author = repo git user. Stay on
  `feat/ds-9-metime-reskin`; verify branch; never main.

## Mockup reference

`/private/tmp/claude-501/.../scratchpad/TimeTrack.dc.html` My Time L461–586: header card L463–473;
tabs L475–479; Timeline L481–498; Activity L500–545; Screenshots L548–566; Idle L569–585.

---

### Task 1: Reskin `ApprovalsPanel` → timesheet header card (+ Badge)

**Files:** Modify `me/ApprovalsPanel.tsx`.

- [ ] Keep the null/empty guards. Render a `<Card padding="md">` header for the LATEST row: week
      label (`text-caption text-text-secondary`), big hours `text-[32px] font-semibold tt-numeric` =
      `formatHours(latest.trackedSeconds)`, and a `<Badge tone={TONE[statusBadge(latest.status).tone]}>`
      (TONE map as above). Below, if >1 row, a compact list of the remaining weeks (week · tracked ·
      Badge · approved-hours · note) reskinned minimally. Remove local `BADGE_TONE`. Keep it server-
      rendered (no 'use client'). Commit `feat(dashboard): reskin timesheet status header + Badge`.

### Task 2: Reskin `MeTabs` (minor) + Timeline/Idle panels

**Files:** Modify `me/MeTabs.tsx` (align tab styling to mockup; it's already close), and the
Timeline/Idle rendering in `me/page.tsx` (or keep as-is if already close).

- [ ] MeTabs: match mockup tab styling (active `border-accent border-b-2 -mb-px text-text`, inactive
      `text-text-secondary hover:text-text`, `px-3 py-2 text-label`); keep role=tab/tabpanel + state.
      Timeline: wrap today's entries in a `Card` titled "Today · {date}" with the mockup row layout
      (time range · color dot · project/note · duration). Idle: reskin the list to the mockup row
      (range · duration · project · status badge · Resolve affordance — Resolve only if an action
      exists; else omit the button). Commit `feat(dashboard): reskin my-time tabs, timeline, idle`.

### Task 3: Reskin `ActivitySummaryPanel` (adopt chart kit)

**Files:** Modify `components/activity/ActivitySummaryPanel.tsx`.

- [ ] Read it first. Reskin to the mockup Activity layout using the SAME `ActivityDailySummary` data:
      active-minutes KPI (big number + "% of tracked time"), a 7-day daily-% bars block (reuse the
      existing daily chart or `StackedDayBars`), a "Top apps & sites" list via `BarMeter`, and a
      "Category mix" via `CategoryMixBar`. Keep the existing pure view-transforms (`activity-summary-view`)
  - their tests; only restyle/recompose. Wrap sections in `Card`. Commit `feat(dashboard): reskin activity panel with chart kit`.

### Task 4: Reskin `ScreenshotsPanel` + wire page

**Files:** Modify `me/ScreenshotsPanel.tsx` and `me/page.tsx`.

- [ ] ScreenshotsPanel: reskin to the mockup grid (`grid [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))] gap-3`),
      each figure = blurred thumb (aspect 16/10, rounded, border) + a Redact affordance + caption
      (time · app). Keep the `onRedact` action wiring. page.tsx: add `<SetPageTitle title="My time" />`,
      remove `PageHeader`; keep the `Promise.all` load + `selfApprovals` + MeTabs composition; place the
      reskinned `ApprovalsPanel` header above the tabs. typecheck+lint+build clean. Commit `feat(dashboard): reskin my-time screenshots + page`.

### Task 5: e2e scaffold

**Files:** Create `apps/dashboard/e2e/metime.spec.ts` (skipped, append-only NEW file — `me`/`my-time`
has none). Cases: header shows week hours + status badge; tabs switch Timeline/Activity/Screenshots/
Idle; activity shows KPI + category mix; screenshots grid renders. Skipped; curly apostrophes.
Commit `test(dashboard): scaffold my-time reskin e2e cases`.

---

## Final verification

`pnpm lint && typecheck && test && build` green. Final whole-branch review (opus — several panels).
Visual check = user eyeball (relaunch dev server; localhost:3000/me). Blast radius: /me files +
ActivitySummaryPanel + new e2e only.
