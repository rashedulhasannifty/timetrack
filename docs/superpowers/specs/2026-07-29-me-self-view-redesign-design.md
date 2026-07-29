# Design — "My data" self-view redesign (shared day view + time ribbon)

Date: 2026-07-29
Status: approved (pending spec review)

## 1. Problem

The design system (`TimeTrack Design System Mac Os Client.pdf`, "MY DATA · SELF-VIEW") specifies a
single-page day view whose signature element is a **horizontal time ribbon**, topped by a hero stat
row (Tracked / Active% / Untracked) and followed by an activity chart, the time-entry list, and
screenshots. The shipped `/me` page instead renders a plain **vertical `Timeline` list** inside
**tabs** (Timeline / Activity / Screenshots / Idle) — the ribbon, the hero stats, and the unified
layout were never built. The manager per-person view (`people/[userId]`) uses the same plain
components, so both surfaces are the "lesser" version.

All the data needed already exists via the API: time entries, per-60s activity samples
(`/activity-samples`: `timestamp`, `appName`, `category`, `activityPct`), screenshots, and idle
events.

## 2. Goals / non-goals

**Goals**

- Replace the tabbed `/me` layout with the design's single, scrolling day view.
- Build the **`TimeRibbon`** (the signature element) + hero stats + activity chart as **shared,
  reusable components** used by BOTH `/me` (self) and `people/[userId]` (manager).
- Add **date navigation** (`?date=YYYY-MM-DD`) so any past day can be viewed.
- Keep all data logic in a **pure, vitest-tested transform**; keep components presentational.

**Non-goals**

- No new API endpoints or contract changes — the data already exists.
- No live/streaming updates beyond a "Recording now" indicator on today.
- No client-side data framework — the URL is the state (Server Components re-render).
- No work-hours setting; the day window is derived from data.

## 3. Key decisions

1. **Shared components.** A single `PersonDayView` (+ children) renders both surfaces. `/me` passes
   `isSelf: true` (self-only reassurance banner, self screenshot-redaction action); `people/[userId]`
   passes the subject's name and the manager screenshot view. The existing per-page authz on
   `people/[userId]` is unchanged.
2. **Date navigation via URL.** Both pages read `?date=YYYY-MM-DD` (default: today, UTC). Prev / next
   / today are plain links; future days are disabled. No client state.
3. **Data-derived day window.** The ribbon window = earliest→latest of all that day's timestamps
   (entry start/end, sample times, screenshot times), snapped **down/up to the hour**, with a
   **minimum width of 4h**, clamped to the calendar day. An empty day falls back to `09:00–18:00`.
4. **Untracked = in-day gaps (window − tracked).** Activity samples are captured **only while a
   timer runs** (`ActivitySampler` is gated on `isTracking`), so "app-active but no timer" is not
   measurable. The measurable, meaningful realization is the **gaps between tracked sessions inside
   the working-day window** — which is what the mockup's "1h Untracked" depicts (e.g. a lunch gap).
   `untrackedSeconds = max(0, (windowEnd − windowStart) − trackedSeconds)`.
5. **Category coloring** reuses existing tokens: `categoryProductive` / `categoryNeutral` /
   `categoryUnproductive`, plus a muted gray for untracked. No new palette.

## 4. Architecture

Pure transform → presentational Server Components → composed `PersonDayView`.

### 4.1 Pure transform (tested)

`personDayView(input) → PersonDayViewModel`, in `apps/dashboard/src/lib/person-day-view.ts`.

```ts
interface PersonDayInput {
  date: string; // YYYY-MM-DD (UTC day being viewed)
  now: Date; // for "recording now" + open-entry duration
  isSelf: boolean;
  subjectName: string; // "You" (self) or the person's name
  entries: TimeEntry[];
  samples: ActivitySample[];
  screenshots: Screenshot[];
  idle: IdleEvent[];
}

interface PersonDayViewModel {
  date: string;
  subjectName: string;
  isSelf: boolean;
  isToday: boolean;
  recordingNow: boolean; // an open (endTime === null) entry today
  window: { startMs: number; endMs: number }; // derived, epoch ms
  stats: {
    trackedSeconds: number;
    untrackedSeconds: number;
    activePct: number | null; // mean activityPct over the day's samples; null if none
  };
  ribbon: {
    tracked: Array<{
      id: string;
      startPct: number;
      widthPct: number; // % of window
      category: Category;
      label: string;
      startMs: number;
      endMs: number | null;
      running: boolean;
    }>;
    untracked: Array<{ startPct: number; widthPct: number }>; // gaps inside window
    captures: Array<{ atPct: number; screenshotId: string }>;
    hourTicks: Array<{ atPct: number; label: string }>; // "09", "10", …
  };
  activityBuckets: Array<{
    // one per hour of the window
    label: string; // "09"
    activityPct: number | null; // mean over that hour, null if no samples
    category: Category | 'UNTRACKED'; // dominant category, or UNTRACKED if no samples
  }>;
  entries: Array<{ id; startMs; endMs; label; durationSeconds; running }>;
  screenshots: ScreenshotView[]; // via existing toScreenshotView (redaction upstream)
  idle: Array<{ id; startMs; endMs; action }>;
}
```

Notes:

- **Dominant category** of a tracked block/hour = the category with the most sample-seconds within
  it; ties break Unproductive > Neutral > Productive (fail toward flagging, mirroring the client
  Categorizer). A block with no overlapping samples → `NEUTRAL`.
- **Open entry** (`endTime === null`) on today: `endMs = null`, `running = true`, duration counted
  to `now`; on a past day it is treated as closed at day-end (defensive; shouldn't occur).
- All positions are `%` of `[windowStart, windowEnd]`, clamped to `[0, 100]`.

### 4.2 Presentational components (`apps/dashboard/src/components/day/`)

- `DayHeader` — `‹ date ›` nav (+ "Today" link), "Recording now" pill (today only), and the
  self-only "You're viewing your own record — the same view your manager sees" banner.
- `DayStats` — hero row: Tracked / Active% / Untracked in `tt-numeric` display sizes.
- `TimeRibbon` — the signature element (see §5).
- `ActivityBars` — per-hour bars (height = `activityPct`), category-colored, + legend.
- `TimeEntriesList` — upgraded from the current `Timeline` (kept minimal; category dot).
- `ScreenshotsRow` — thin wrapper over the existing `ScreenshotsPanel` (redaction preserved).
- `PersonDayView` — composes the above from a `PersonDayViewModel`.

### 4.3 Pages

- `/me` — fetch self-scoped entries/samples/screenshots/idle for the `?date` day → `personDayView({
isSelf: true, subjectName: "You", … })` → `PersonDayView`. Keeps the existing `ApprovalsPanel`
  above. The `MeTabs` tabbed layout is removed.
- `people/[userId]` — same, `isSelf: false`, `subjectName` = the person's name, manager screenshot
  view; existing authz + redaction unchanged.

## 5. TimeRibbon

- A horizontal track over `[windowStart, windowEnd]` with hour ticks + labels along the top.
- **Tracked blocks**: absolutely positioned by `startPct`/`widthPct`, filled with the block's
  category color, small leading dot; title/hover shows `label · time range · duration`.
- **Untracked band**: the gap segments rendered as a muted, hatched gray strip on the same track.
- **Capture marks**: thin ticks at each screenshot's `atPct`.
- Pure SVG + flex, theme-aware via tokens, `min-width` with `overflow-x: auto` on narrow viewports
  (never widens the page). The `dataviz` skill guides the chart/ribbon color + mark specs at build
  time.

## 6. Testing

Vitest (node-env, per the dashboard convention — pure transforms only, not components) on
`person-day-view.ts`:

- Window: data-span derivation, hour snapping, 4h minimum, empty-day fallback, single-entry day.
- Ribbon geometry: block `startPct`/`widthPct` correct as `%` of window; clamping; capture-mark
  positions; hour ticks.
- Hero math: `trackedSeconds` (incl. an open entry counted to `now`); `untrackedSeconds` = window −
  tracked (gaps), never negative; `activePct` mean (and `null` on no samples).
- Category assignment: dominant-by-seconds, tie-break order, no-sample → NEUTRAL / UNTRACKED bucket.
- `recordingNow` / `isToday` flags; screenshot pairing count.

Components stay presentational and untested (logic lives in the transform).

## 7. Files

**Add**

- `apps/dashboard/src/lib/person-day-view.ts` (+ `person-day-view.spec.ts`)
- `apps/dashboard/src/components/day/{PersonDayView,DayHeader,DayStats,TimeRibbon,ActivityBars,TimeEntriesList,ScreenshotsRow}.tsx`

**Change**

- `apps/dashboard/src/app/(app)/me/page.tsx` — date param, new fetches (add `listActivitySamples`),
  render `PersonDayView`; drop `MeTabs` usage.
- `apps/dashboard/src/app/(app)/people/[userId]/page.tsx` — same, manager-scoped.

**Remove / retire**

- `me/MeTabs.tsx` and the old panel wiring, once both pages use `PersonDayView`. `Timeline`,
  `ActivitySummaryPanel`, `ScreenshotsPanel` are reused or superseded — remove only what is fully
  unreferenced after the switch (verified by grep, not assumption).

## 8. Risks / open items

- **Untracked semantics** deviate from the literal "app-active but no timer" wording because that is
  unmeasurable (activity is only sampled while tracking). Realized as in-day gaps (§3.4). Flag on
  review.
- **Activity granularity for a busy day** — many samples → bucketed to hours for the chart; the
  ribbon colors from samples but renders per-entry blocks, so cost stays bounded.
- The 7-day `ActivitySummaryPanel` (daily rollups) is **replaced** on these pages by the single-day
  intra-day view; the rollup remains available elsewhere (reports) and is out of scope here.
