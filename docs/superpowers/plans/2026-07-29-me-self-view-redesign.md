# My-data self-view redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tabbed `/me` page (and the manager `people/[userId]` view) with the design system's single-page day view — hero stats + a time ribbon + activity bars + entries + screenshots — driven by one pure, tested transform.

**Architecture:** A pure transform `personDayView(input) → PersonDayViewModel` (vitest, node-env) holds all math/geometry. Presentational Server Components render the view model. A shared `PersonDayView` is used by both pages, which become date-aware via `?date=YYYY-MM-DD` (URL is the state; no client data framework).

**Tech Stack:** Next.js 16 (App Router, React 19, Server Components), Tailwind 4, Vitest (node-env), `@timetrack/contracts` types. No new dependencies.

Spec: `docs/superpowers/specs/2026-07-29-me-self-view-redesign-design.md`.

## Global Constraints

- Server Components by default; `'use client'` ONLY for real interaction. The ribbon uses CSS/`title` tooltips and the date nav uses `<Link>`s — **no client component is needed**.
- Types come from `@timetrack/contracts` — never hand-write a response interface.
- Colors come from existing tokens only: `category-productive` / `category-neutral` / `category-unproductive` (Tailwind classes) and their `TT.Palette` equivalents; a muted `separator`/gray for untracked. No new palette, no new dependency.
- Dashboard vitest is **node-env (no jsdom)** — unit-test the pure transform only, never components.
- All times are handled in **UTC** (the app is UTC end-to-end; `toLocaleString(..., { timeZone: 'UTC' })` for labels).
- Commit messages: Conventional Commits, scope `dashboard`, **no AI attribution** (repo rule).
- Run before claiming a JS task done: `pnpm --filter dashboard typecheck && pnpm --filter dashboard test`. For component/page tasks also `pnpm --filter dashboard build`.

---

## File structure

**Create**

- `apps/dashboard/src/lib/person-day-view.ts` — the pure transform + exported types.
- `apps/dashboard/src/lib/person-day-view.spec.ts` — vitest tests.
- `apps/dashboard/src/components/day/DayHeader.tsx` — date nav + recording pill + self banner.
- `apps/dashboard/src/components/day/DayStats.tsx` — hero stat row.
- `apps/dashboard/src/components/day/TimeEntriesList.tsx` — entry list (category dot).
- `apps/dashboard/src/components/day/TimeRibbon.tsx` — the signature ribbon.
- `apps/dashboard/src/components/day/ActivityBars.tsx` — per-hour activity bars + legend.
- `apps/dashboard/src/components/day/PersonDayView.tsx` — composes the above.

**Modify**

- `apps/dashboard/src/app/(app)/me/page.tsx`
- `apps/dashboard/src/app/(app)/people/[userId]/page.tsx`

**Remove (Task 8, only after grep-verified unreferenced)**

- `apps/dashboard/src/app/(app)/me/MeTabs.tsx` and any component left fully unreferenced.

---

## Types (defined in Task 1, consumed everywhere)

```ts
// apps/dashboard/src/lib/person-day-view.ts
import type { TimeEntry, ActivitySample, Screenshot } from '@timetrack/contracts';

export type DayCategory = 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';

export interface PersonDayInput {
  date: string; // 'YYYY-MM-DD' (UTC day being viewed)
  now: Date; // for isToday, recordingNow, open-entry duration
  isSelf: boolean;
  subjectName: string; // 'You' (self) or the person's name
  entries: TimeEntry[];
  samples: ActivitySample[];
  screenshots: Screenshot[];
}

export interface RibbonBlock {
  id: string;
  startPct: number;
  widthPct: number;
  category: DayCategory;
  label: string;
  startMs: number;
  endMs: number | null;
  running: boolean;
}
export interface RibbonGap {
  startPct: number;
  widthPct: number;
}
export interface CaptureMark {
  atPct: number;
  screenshotId: string;
}
export interface HourTick {
  atPct: number;
  label: string;
}
export interface ActivityBucket {
  label: string;
  activityPct: number | null;
  category: DayCategory | 'UNTRACKED';
}
export interface DayEntryRow {
  id: string;
  startMs: number;
  endMs: number | null;
  label: string;
  durationSeconds: number;
  running: boolean;
}

export interface PersonDayViewModel {
  date: string;
  subjectName: string;
  isSelf: boolean;
  isToday: boolean;
  recordingNow: boolean;
  window: { startMs: number; endMs: number };
  stats: { trackedSeconds: number; untrackedSeconds: number; activePct: number | null };
  ribbon: {
    tracked: RibbonBlock[];
    untracked: RibbonGap[];
    captures: CaptureMark[];
    hourTicks: HourTick[];
  };
  activityBuckets: ActivityBucket[];
  entries: DayEntryRow[];
}

export function personDayView(input: PersonDayInput): PersonDayViewModel;
```

Screenshots are rendered by the existing `ScreenshotsPanel` (fed by the page's `toScreenshotView`), passed into `PersonDayView` as a slot — the transform only derives ribbon capture marks from screenshot timestamps. Idle is intentionally dropped from this view (not in the design mockup).

---

### Task 1: Transform core — window, stats, entries, flags

**Files:**

- Create: `apps/dashboard/src/lib/person-day-view.ts`
- Test: `apps/dashboard/src/lib/person-day-view.spec.ts`

**Interfaces:**

- Produces: all types above; `personDayView(input): PersonDayViewModel`. This task fills `date/subjectName/isSelf/isToday/recordingNow/window/stats/entries` and returns **empty** `ribbon` (`{tracked:[],untracked:[],captures:[],hourTicks:[]}`) and `activityBuckets: []` (Task 2 fills those).

**Rules (implement exactly):**

- Parse each entry's `startTime`/`endTime` with `Date.parse` (ISO). An entry with `endTime === null` is **open**.
- `isToday` = `input.date === input.now.toISOString().slice(0,10)`.
- **Window:** collect timestamps = every entry start, every entry end (open entry → `now` if today else the entry start), every sample `timestamp`, every screenshot `timestamp`. If none → window = `date`’s `09:00:00Z`..`18:00:00Z`. Else `startMs = floorToHourUTC(min)`, `endMs = ceilToHourUTC(max)`; enforce `endMs - startMs >= 4h` by extending `endMs` (clamped to `date`’s `23:59:59.999Z`, then if still <4h extend `startMs` down, clamped to `00:00:00Z`).
- **trackedSeconds** = Σ per entry of `(effectiveEnd - start)/1000`, where `effectiveEnd` = `endMs ?? (isToday ? now : start)`; ignore negative.
- **untrackedSeconds** = `max(0, round((window.endMs - window.startMs)/1000) - trackedSeconds)`.
- **activePct** = mean of `samples[].activityPct` rounded to int, or `null` if no samples.
- **recordingNow** = `isToday && entries.some(open)`.
- **entries[]**: map to `DayEntryRow` sorted by `startMs`; `label = note ?? 'Untitled entry'`; `durationSeconds` from the same effectiveEnd rule; `running = open && isToday`.
- Helpers `floorToHourUTC(ms)` / `ceilToHourUTC(ms)` operate on epoch ms via `Date` UTC getters.

- [ ] **Step 1: Write failing tests**

```ts
// person-day-view.spec.ts
import { describe, it, expect } from 'vitest';
import { personDayView } from './person-day-view';
import type { TimeEntry } from '@timetrack/contracts';

const D = '2026-07-13';
const iso = (h: number, m = 0) =>
  `${D}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const entry = (id: string, sh: number, eh: number | null, note = 'work'): TimeEntry =>
  ({
    id,
    userId: 'u1',
    projectId: null,
    taskId: null,
    startTime: iso(sh),
    endTime: eh === null ? null : iso(eh),
    source: 'MANUAL',
    note,
  }) as TimeEntry;
const base = { date: D, isSelf: true, subjectName: 'You', samples: [], screenshots: [] };

describe('personDayView — core', () => {
  it('derives the window from data, snapped to the hour with a 4h minimum', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [entry('a', 9, 10)] });
    expect(new Date(vm.window.startMs).toISOString()).toBe(iso(9));
    // 09:00 tracked one hour → window must be >= 4h, so end extends to 13:00
    expect((vm.window.endMs - vm.window.startMs) / 3_600_000).toBe(4);
  });

  it('empty day falls back to 09:00–18:00', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [] });
    expect(new Date(vm.window.startMs).toISOString()).toBe(iso(9));
    expect(new Date(vm.window.endMs).toISOString()).toBe(iso(18));
    expect(vm.stats.trackedSeconds).toBe(0);
  });

  it('tracked = sum of entry durations; untracked = window minus tracked (gaps)', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 12), entry('b', 13, 17)],
    });
    expect(vm.stats.trackedSeconds).toBe(7 * 3600); // 3h + 4h
    // window 09:00–17:00 = 8h, tracked 7h → untracked 1h
    expect(vm.stats.untrackedSeconds).toBe(3600);
  });

  it('counts an open entry to now on today and flags recordingNow', () => {
    const now = new Date('2026-07-13T15:30:00.000Z');
    const vm = personDayView({ ...base, date: '2026-07-13', now, entries: [entry('a', 14, null)] });
    expect(vm.recordingNow).toBe(true);
    expect(vm.isToday).toBe(true);
    expect(vm.stats.trackedSeconds).toBe(90 * 60); // 14:00 → 15:30
  });

  it('activePct is null with no samples', () => {
    const vm = personDayView({ ...base, now: new Date(iso(20)), entries: [entry('a', 9, 10)] });
    expect(vm.stats.activePct).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter dashboard test person-day-view`
Expected: FAIL (module/function not found).

- [ ] **Step 3: Implement the transform core** (types above + the Rules). Return empty `ribbon`/`activityBuckets` for now.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter dashboard test person-day-view` → PASS. Then `pnpm --filter dashboard typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/person-day-view.ts apps/dashboard/src/lib/person-day-view.spec.ts
git commit -m "feat(dashboard): person-day-view transform core (window + stats)"
```

---

### Task 2: Transform — ribbon geometry, captures, hour ticks, activity buckets

**Files:**

- Modify: `apps/dashboard/src/lib/person-day-view.ts`
- Test: `apps/dashboard/src/lib/person-day-view.spec.ts` (add cases)

**Interfaces:**

- Consumes: `PersonDayViewModel`, `personDayView`, window from Task 1.
- Produces: fully-populated `ribbon` + `activityBuckets`.

**Rules (implement exactly):**

- `pct(ms) = clamp(((ms - window.startMs) / (window.endMs - window.startMs)) * 100, 0, 100)`.
- **tracked blocks**: per entry, `startPct = pct(start)`, `widthPct = pct(effEnd) - startPct` (min 0). `category` = dominant category of samples whose `timestamp` ∈ `[start, effEnd)`; **dominant** = category with the most samples; tie-break `UNPRODUCTIVE > NEUTRAL > PRODUCTIVE`; no samples → `NEUTRAL`. `running` per Task 1.
- **untracked gaps**: walk sorted tracked `[startPct,endPct]` intervals across `[0,100]`; each uncovered span ≥ 0.5% wide → a `RibbonGap`.
- **captures**: per screenshot, `atPct = pct(Date.parse(timestamp))`, keep `screenshotId = id`.
- **hourTicks**: one per UTC hour boundary in `[startMs, endMs]`, `label` = 2-digit UTC hour, `atPct = pct(hourMs)`.
- **activityBuckets**: one per UTC hour in the window; `activityPct` = mean of that hour's samples (int) or `null`; `category` = dominant of that hour’s samples, or `'UNTRACKED'` if none.

- [ ] **Step 1: Write failing tests** (add to spec)

```ts
import type { ActivitySample, Screenshot } from '@timetrack/contracts';
const sample = (h: number, m: number, cat: string, pct: number): ActivitySample =>
  ({
    id: `s${h}${m}`,
    userId: 'u1',
    timestamp: iso(h, m),
    appName: 'x',
    windowTitle: null,
    activityPct: pct,
    category: cat,
  }) as ActivitySample;

describe('personDayView — ribbon', () => {
  it('positions a tracked block as a % of the window and colors by dominant category', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 13)], // fills the 4h min window exactly
      samples: [
        sample(9, 0, 'PRODUCTIVE', 80),
        sample(9, 30, 'PRODUCTIVE', 60),
        sample(10, 0, 'UNPRODUCTIVE', 10),
      ],
    });
    const b = vm.ribbon.tracked[0];
    expect(b.startPct).toBe(0);
    expect(Math.round(b.widthPct)).toBe(100);
    expect(b.category).toBe('PRODUCTIVE'); // 2 productive vs 1 unproductive
  });

  it('emits an untracked gap between two blocks', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 12), entry('b', 13, 17)],
    });
    expect(vm.ribbon.untracked.length).toBe(1); // the 12:00–13:00 gap
  });

  it('derives hour ticks and per-hour activity buckets', () => {
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 13)],
      samples: [sample(9, 0, 'NEUTRAL', 50)],
    });
    expect(vm.ribbon.hourTicks.map((t) => t.label)).toEqual(['09', '10', '11', '12', '13']);
    expect(vm.activityBuckets[0]).toMatchObject({
      label: '09',
      activityPct: 50,
      category: 'NEUTRAL',
    });
    expect(vm.activityBuckets[1].category).toBe('UNTRACKED'); // 10:00 hour has no samples
  });

  it('places a capture mark at the screenshot time', () => {
    const shot = {
      id: 'sh1',
      userId: 'u1',
      timestamp: iso(11),
      storageKey: 'k',
      thumbnailKey: null,
      blurred: false,
      status: 'READY',
      redactedReason: null,
    } as Screenshot;
    const vm = personDayView({
      ...base,
      now: new Date(iso(20)),
      entries: [entry('a', 9, 13)],
      screenshots: [shot],
    });
    expect(vm.ribbon.captures).toHaveLength(1);
    expect(Math.round(vm.ribbon.captures[0].atPct)).toBe(50); // 11:00 is midpoint of 09–13
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter dashboard test person-day-view` (new cases FAIL).
- [ ] **Step 3: Implement** the ribbon/buckets rules.
- [ ] **Step 4: Run, verify pass** + `pnpm --filter dashboard typecheck`.
- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/person-day-view.ts apps/dashboard/src/lib/person-day-view.spec.ts
git commit -m "feat(dashboard): person-day-view ribbon geometry + activity buckets"
```

---

### Task 3: Chrome components — DayHeader, DayStats, TimeEntriesList

**Files:**

- Create: `apps/dashboard/src/components/day/DayHeader.tsx`, `DayStats.tsx`, `TimeEntriesList.tsx`

**Interfaces:**

- Consumes: `PersonDayViewModel` + its sub-types (Task 1). `formatDuration`, `formatTimeRange` from `../../lib/format` (existing).
- Produces (props, consumed by Task 5):
  - `DayHeader({ date, subjectName, isSelf, isToday, recordingNow })`
  - `DayStats({ stats }: { stats: PersonDayViewModel['stats'] })`
  - `TimeEntriesList({ entries }: { entries: DayEntryRow[] })`

**Details:**

- `DayHeader`: prev/next/today as `<Link href={\`?date=...\`}>`(compute prev/next UTC day from`date`); next disabled when `isToday`; a "Recording now" pill when `recordingNow`; when `isSelf`, the banner text “You’re viewing your own record — the same view your manager sees. Nothing here is hidden from you.” Use `Card`/existing tokens.
- `DayStats`: three cells — Tracked (`formatDuration(trackedSeconds)`), Active (`activePct == null ? '—' : activePct + '%'`), Untracked (`formatDuration(untrackedSeconds)`) — large `tt-numeric`, caption labels, matching the mockup.
- `TimeEntriesList`: replaces `Timeline`; each row: time range (`formatTimeRange` of `startMs/endMs`), a category-neutral dot, label, duration (`running ? 'running' : formatDuration`).

- [ ] **Step 1:** Implement the three components (Server Components, no `'use client'`).
- [ ] **Step 2: Verify** `pnpm --filter dashboard typecheck` PASS. (No unit tests — presentational.)
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/day/DayHeader.tsx apps/dashboard/src/components/day/DayStats.tsx apps/dashboard/src/components/day/TimeEntriesList.tsx
git commit -m "feat(dashboard): day-view chrome (header, stats, entries list)"
```

---

### Task 4: Visualization — TimeRibbon + ActivityBars

**Files:**

- Create: `apps/dashboard/src/components/day/TimeRibbon.tsx`, `ActivityBars.tsx`

**Sub-skill:** invoke the **`dataviz`** skill before writing these — apply its color/mark/legend guidance using the existing category tokens (do NOT introduce a new palette).

**Interfaces:**

- Consumes: `PersonDayViewModel['ribbon']` and `PersonDayViewModel['activityBuckets']` (Task 1/2).
- Produces:
  - `TimeRibbon({ ribbon }: { ribbon: PersonDayViewModel['ribbon'] })`
  - `ActivityBars({ buckets }: { buckets: ActivityBucket[] })`

**Details:**

- `TimeRibbon`: a relatively-positioned track (fixed height ~40px). Hour ticks + labels along the top (absolute, `left: atPct%`). Tracked blocks absolute (`left: startPct%`, `width: widthPct%`) filled by category class (`bg-category-productive|neutral|unproductive`), leading dot, `title="{label} · {range} · {duration}"`. Untracked gaps as a hatched muted band. Capture marks as thin 2px ticks (`left: atPct%`). Wrap in `overflow-x-auto` with a sensible `min-width` so it never widens the page.
- `ActivityBars`: a row of bars, one per bucket; height ∝ `activityPct` (0 when null), color by `category` (untracked → muted gray); x-labels = every few hours; a legend line (Productive / Neutral / Unproductive / Untracked / screen captures).
- Category → class map lives in ONE small helper at the top of `TimeRibbon.tsx` and is imported by `ActivityBars.tsx` (DRY).

- [ ] **Step 1:** Invoke `dataviz`, then implement both components.
- [ ] **Step 2: Verify** `pnpm --filter dashboard typecheck && pnpm --filter dashboard build` PASS.
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/day/TimeRibbon.tsx apps/dashboard/src/components/day/ActivityBars.tsx
git commit -m "feat(dashboard): time ribbon + activity bars"
```

---

### Task 5: Compose — PersonDayView

**Files:**

- Create: `apps/dashboard/src/components/day/PersonDayView.tsx`

**Interfaces:**

- Consumes: all Task 3/4 components + `PersonDayViewModel`.
- Produces: `PersonDayView({ model, screenshots }: { model: PersonDayViewModel; screenshots: ReactNode })` — `screenshots` is a slot the page fills with the existing `ScreenshotsPanel` (already wired with the right redaction action per surface).

**Details:** stack, in order, inside the page container: `DayHeader` → `DayStats` → a `Card` with `TimeRibbon` then `ActivityBars` (labeled “Your day” / “Activity”) → a two-column row (`TimeEntriesList` | the `screenshots` slot) collapsing to one column on narrow. Use existing `Card` + spacing tokens.

- [ ] **Step 1:** Implement `PersonDayView`.
- [ ] **Step 2: Verify** `pnpm --filter dashboard typecheck` PASS.
- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/day/PersonDayView.tsx
git commit -m "feat(dashboard): compose PersonDayView"
```

---

### Task 6: Wire the /me page

**Files:**

- Modify: `apps/dashboard/src/app/(app)/me/page.tsx`

**Interfaces:**

- Consumes: `personDayView` (Task 1/2), `PersonDayView` (Task 5), existing `api.listActivitySamples`, `api.listTimeEntries`, `api.listScreenshots`, `toScreenshotView`, `ScreenshotsPanel`, `redactScreenshotAction`, `ApprovalsPanel`.

**Details:**

- Signature: `export default async function MyDataPage({ searchParams }: { searchParams: Promise<{ date?: string }> })`. Resolve `date` (default `new Date().toISOString().slice(0,10)`; validate `^\d{4}-\d{2}-\d{2}$`, else today).
- Build `todayParams` for that `date` (`from = ${date}T00:00:00.000Z`, `to = ${date}T23:59:59.999Z`).
- Fetch in parallel (each `.catch` → `[]`): `listTimeEntries`, `listActivitySamples`, `listScreenshots`. (Drop the idle + 7-day summary fetches from this page.)
- `const model = personDayView({ date, now: new Date(), isSelf: true, subjectName: 'You', entries, samples, screenshots })`.
- Render: `<SetPageTitle title="My time" />`, then `<ApprovalsPanel rows={myApprovals} />` (keep the approvals fetch), then `<PersonDayView model={model} screenshots={<ScreenshotsPanel shots={screenshots.map(toScreenshotView)} onRedact={redactScreenshotAction} />} />`. Remove `MeTabs` usage.

- [ ] **Step 1:** Rewrite the page per Details.
- [ ] **Step 2: Verify** `pnpm --filter dashboard typecheck && pnpm --filter dashboard build` PASS; `pnpm --filter dashboard test` PASS (the existing `me/actions.spec.ts` still green).
- [ ] **Step 3: Commit**

```bash
git add "apps/dashboard/src/app/(app)/me/page.tsx"
git commit -m "feat(dashboard): render the new day view on /me"
```

---

### Task 7: Wire the manager people/[userId] page

**Files:**

- Modify: `apps/dashboard/src/app/(app)/people/[userId]/page.tsx`

**Details:**

- Add `searchParams` `date` handling (same validation/default as Task 6). Keep the existing `params.userId` + authz.
- Add `api.listActivitySamples` for `userId` + the day window (alongside the existing entries/screenshots fetches). Use the subject’s display name for `subjectName`, `isSelf: false`.
- `const model = personDayView({ date, now: new Date(), isSelf: false, subjectName, entries, samples, screenshots })`.
- Replace the `Timeline` + `ActivitySummaryPanel` blocks with `<PersonDayView model={model} screenshots={<ScreenshotsPanel shots={screenshots.map(toScreenshotView)} /* manager: read-only, no onRedact */ />} />`. Keep any manager-only header already present.

- [ ] **Step 1:** Rewrite the page per Details (mirror Task 6, manager-scoped).
- [ ] **Step 2: Verify** `pnpm --filter dashboard typecheck && pnpm --filter dashboard build` PASS; `pnpm --filter dashboard test` PASS.
- [ ] **Step 3: Commit**

```bash
git add "apps/dashboard/src/app/(app)/people/[userId]/page.tsx"
git commit -m "feat(dashboard): render the shared day view on the manager per-person page"
```

---

### Task 8: Remove dead components

**Files:**

- Remove: `apps/dashboard/src/app/(app)/me/MeTabs.tsx` (+ any now-unreferenced: `Timeline`, `ActivitySummaryPanel` — ONLY if grep shows zero remaining imports).

**Details:**

- `grep -rn "MeTabs\|<Timeline\|ActivitySummaryPanel" apps/dashboard/src` — delete only files with no remaining references. If `Timeline`/`ActivitySummaryPanel` are still used elsewhere (e.g. reports), keep them.

- [ ] **Step 1:** Grep, delete the dead files, remove dangling imports.
- [ ] **Step 2: Verify** `pnpm --filter dashboard typecheck && pnpm --filter dashboard test && pnpm --filter dashboard build` all PASS.
- [ ] **Step 3: Commit**

```bash
git add -A apps/dashboard/src
git commit -m "chore(dashboard): remove the tabbed my-data layout superseded by the day view"
```

---

## Self-review

- **Spec coverage:** shared PersonDayView (T5–7 ✓); TimeRibbon (T4 ✓); hero stats (T3 ✓); activity bars (T4 ✓); date nav via ?date (T6/7 ✓, DayHeader T3 ✓); derived window + gap-based untracked (T1 ✓); dominant-category coloring (T2 ✓); pure tested transform (T1/2 ✓); manager redaction/authz preserved (T7 ✓); tabs removed (T8 ✓). Idle intentionally dropped (spec §non-goal alignment; noted in Types section).
- **Placeholders:** none — transform rules + test code are concrete; component tasks list exact props/behavior.
- **Type consistency:** `DayCategory`, `PersonDayViewModel`, `RibbonBlock/Gap`, `CaptureMark`, `HourTick`, `ActivityBucket`, `DayEntryRow`, and `personDayView` names are used identically across tasks. `PersonDayView` prop is `{ model, screenshots }` in T5, T6, T7.
- **Contracts field check to confirm at T1 (implementer):** `ActivitySample.activityPct`/`category`/`timestamp` and `Screenshot.timestamp`/`id` names — mirror the exact `@timetrack/contracts` field names; adjust the test fixtures if a field differs.
