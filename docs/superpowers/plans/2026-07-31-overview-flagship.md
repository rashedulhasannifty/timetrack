# Overview Flagship Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the manager Overview page into the flagship layout — 6-up KPIs, two trend charts, the full leaderboard grid, the website/app breakdown, and a widgets drawer — consuming sub-project A's three `/reports/*` endpoints plus existing data.

**Architecture:** Server Component page fetches all data server-side and passes it through pure view-transforms into presentational chart/UI components (mostly already built). A thin client "visibility shell" (React context + `localStorage`) lets a widgets drawer toggle each card without refetching. All new logic lives in pure transforms (`lib/overview-view.ts`), unit-tested with Vitest; components are verified by typecheck + build; page behavior by a Playwright e2e (scaffolded like the repo's other dashboard e2e).

**Tech Stack:** Next.js 16 App Router (React 19, Server Components), Tailwind 4, Vitest (node-env), Playwright. Package filter: `pnpm --filter dashboard …`.

## Global Constraints

- **Types come from `@timetrack/contracts`** — never hand-write a response interface. The new schemas `TeamTrends`/`TeamActivity`/`TeamAppUsage` + `TeamTrendDay`/`TeamActivityRow`/`TeamAppUsageRow` already exist there (sub-project A).
- **Server Components by default**; `'use client'` ONLY for real interaction (the visibility provider, the `Widget` wrapper, the drawer). No credential ever reaches the browser.
- **All view logic in pure transforms** in `lib/overview-view.ts` (no React, no I/O) — that is the unit-test surface. Components stay presentational.
- **Vitest is node-env (no jsdom):** unit-test transforms only, never components. Component/page behavior is covered by typecheck + build and the Playwright e2e.
- **Dashboard e2e specs must be named `*.spec.ts`** (Playwright silently skips other names) and live in `apps/dashboard/e2e/`. The repo's existing dashboard e2e are `test.skip` scaffolds (they need a live app + seeded auth); follow that convention for the new spec.
- **No new dependency**, no charting library — SVG/CSS components only.
- **exactOptionalPropertyTypes is on**: never pass an object literal with a `string | undefined` value for an optional prop; conditionally spread the key in only when defined.
- **Commit hygiene:** Conventional Commits, scope `dashboard`, one logical change each. NO AI attribution / co-author / generated-by footer; no `--author`; no git-identity change.
- **Branch:** all work lands on `dashboard/overview-flagship` (already checked out; stacked on sub-project A).
- Run before claiming a task done: `pnpm --filter dashboard test -- <spec>` (unit), `pnpm --filter dashboard typecheck`, `pnpm --filter dashboard build`.

---

## File structure

- `apps/dashboard/src/lib/overview-view.ts` — **modify**: add the new pure transforms + their model types.
- `apps/dashboard/src/lib/overview-view.spec.ts` — **modify**: unit tests for every new transform.
- `apps/dashboard/src/lib/api-client.ts` — **modify**: add `trends`, `teamActivity`, `appUsage` methods.
- `apps/dashboard/src/lib/api-client.spec.ts` — **modify**: a parse test for one new method.
- `apps/dashboard/src/components/overview/AppUsageList.tsx` — **create**: presentational app/website list (Server Component).
- `apps/dashboard/src/components/overview/WidgetVisibilityProvider.tsx` — **create** (`'use client'`).
- `apps/dashboard/src/components/overview/Widget.tsx` — **create** (`'use client'`).
- `apps/dashboard/src/components/overview/WidgetsDrawer.tsx` — **create** (`'use client'`).
- `apps/dashboard/src/app/(app)/page.tsx` — **modify**: recompose into the flagship layout.
- `apps/dashboard/e2e/overview-flagship.spec.ts` — **create**: scaffolded e2e for sections + drawer persistence.

---

## Interfaces (defined in Task 1 / Task 2, consumed by Task 4)

```ts
// lib/overview-view.ts (Task 1)
export interface DayLetter {
  letter: string;
  weekend: boolean;
}
export interface HoursLineModel {
  values: number[];
  max: number;
  axis: string[];
  dayLetters: DayLetter[];
  labels: string[];
}
export interface ProductivityBarsModel {
  values: number[];
  dayLetters: DayLetter[];
}
export interface AppUsageItem {
  appName: string;
  seconds: number;
  category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';
  pct: number;
}

export function teamCategoryKpis(trends: TeamTrends): {
  productivePct: number;
  unproductivePct: number;
};
export function teamIdleKpi(activity: TeamActivity): { idlePct: number };
export function trendsToHoursLine(trends: TeamTrends): HoursLineModel;
export function trendsToProductivityBars(trends: TeamTrends): ProductivityBarsModel;
export function topByProductive(
  activity: TeamActivity,
  n?: number,
): { userId: string; name: string; pct: number }[];
export function topByUnproductive(
  activity: TeamActivity,
  n?: number,
): { userId: string; name: string; pct: number }[];
export function topByIdle(
  activity: TeamActivity,
  n?: number,
): { userId: string; name: string; idlePct: number; idleMinutes: number }[];
export function appUsageByCategory(
  appUsage: TeamAppUsage,
  n?: number,
): { topUsed: AppUsageItem[]; unproductive: AppUsageItem[]; unrated: AppUsageItem[] };

// lib/api-client.ts (Task 2) — on the exported `api` object
trends: (token: string, params: URLSearchParams) => Promise<TeamTrends>;
teamActivity: (token: string, params: URLSearchParams) => Promise<TeamActivity>;
appUsage: (token: string, params: URLSearchParams) => Promise<TeamAppUsage>;

// components/overview/WidgetVisibilityProvider.tsx (Task 3)
export function WidgetVisibilityProvider(props: { children: React.ReactNode }): JSX.Element;
export function useWidgetVisibility(): {
  isOn: (id: string) => boolean;
  toggle: (id: string) => void;
};
// components/overview/Widget.tsx (Task 3)
export function Widget(props: { id: string; children: React.ReactNode }): JSX.Element;
// components/overview/WidgetsDrawer.tsx (Task 3)
export interface WidgetGroup {
  label: string;
  items: { id: string; label: string }[];
}
export function WidgetsDrawer(props: { groups: WidgetGroup[] }): JSX.Element;
// components/overview/AppUsageList.tsx (Task 3)
export function AppUsageList(props: { items: AppUsageItem[] }): JSX.Element;
```

---

### Task 1: View-transforms + unit tests

**Files:**

- Modify: `apps/dashboard/src/lib/overview-view.ts`
- Test: `apps/dashboard/src/lib/overview-view.spec.ts`

**Interfaces:**

- Consumes: `TeamTrends`, `TeamActivity`, `TeamAppUsage` from `@timetrack/contracts`.
- Produces: the eight functions + four types in the Interfaces block.

- [ ] **Step 1: Write the failing tests**

Append to `overview-view.spec.ts`:

```ts
import {
  teamCategoryKpis,
  teamIdleKpi,
  trendsToHoursLine,
  trendsToProductivityBars,
  topByProductive,
  topByUnproductive,
  topByIdle,
  appUsageByCategory,
} from './overview-view';
import type { TeamTrends, TeamActivity, TeamAppUsage } from '@timetrack/contracts';

const trends: TeamTrends = {
  from: '2026-07-11T00:00:00.000Z',
  to: '2026-07-13T00:00:00.000Z',
  days: [
    {
      day: '2026-07-11',
      trackedSeconds: 0,
      productiveSeconds: 0,
      neutralSeconds: 0,
      unproductiveSeconds: 0,
    },
    {
      day: '2026-07-12',
      trackedSeconds: 3600,
      productiveSeconds: 2700,
      neutralSeconds: 900,
      unproductiveSeconds: 0,
    },
    {
      day: '2026-07-13',
      trackedSeconds: 7200,
      productiveSeconds: 1800,
      neutralSeconds: 0,
      unproductiveSeconds: 1800,
    },
  ],
};
const activity: TeamActivity = {
  from: trends.from,
  to: trends.to,
  rows: [
    {
      userId: '1',
      name: 'Ada',
      activeMinutes: 90,
      productivePct: 75,
      neutralPct: 25,
      unproductivePct: 0,
      idleMinutes: 10,
      idlePct: 10,
    },
    {
      userId: '2',
      name: 'Bo',
      activeMinutes: 60,
      productivePct: 20,
      neutralPct: 0,
      unproductivePct: 80,
      idleMinutes: 40,
      idlePct: 40,
    },
  ],
};
const appUsage: TeamAppUsage = {
  from: trends.from,
  to: trends.to,
  rows: [
    { appName: 'Xcode', seconds: 3600, category: 'PRODUCTIVE' },
    { appName: 'Slack', seconds: 1800, category: 'NEUTRAL' },
    { appName: 'YouTube', seconds: 600, category: 'UNPRODUCTIVE' },
  ],
};

describe('teamCategoryKpis', () => {
  it('sums category seconds across days and rounds pcts', () => {
    // prod=4500 neut=900 unprod=1800 total=7200 → prod 63, unprod 25
    expect(teamCategoryKpis(trends)).toEqual({ productivePct: 63, unproductivePct: 25 });
  });
  it('returns zeros when no categorized time', () => {
    expect(teamCategoryKpis({ ...trends, days: [] })).toEqual({
      productivePct: 0,
      unproductivePct: 0,
    });
  });
});

describe('teamIdleKpi', () => {
  it('idle / (idle + active) across rows', () => {
    // idle=50 active=150 → 50/200 = 25
    expect(teamIdleKpi(activity)).toEqual({ idlePct: 25 });
  });
  it('zero when no minutes', () => {
    expect(teamIdleKpi({ ...activity, rows: [] })).toEqual({ idlePct: 0 });
  });
});

describe('trendsToHoursLine', () => {
  it('maps tracked hours, a multiple-of-6 max, thirds axis, day letters and labels', () => {
    const m = trendsToHoursLine(trends);
    expect(m.values).toEqual([0, 1, 2]); // seconds/3600, 1dp
    expect(m.max).toBe(6); // ceil(2/6)*6, min 6
    expect(m.axis).toEqual(['6', '4', '2', '0']); // niceMax, *2/3, /3, 0
    expect(m.dayLetters).toEqual([
      { letter: 'S', weekend: true }, // 2026-07-11 is a Saturday (UTC)
      { letter: 'S', weekend: true }, // 2026-07-12 Sunday
      { letter: 'M', weekend: false }, // 2026-07-13 Monday
    ]);
    expect(m.labels).toEqual(['Jul 11', 'Jul 12', 'Jul 13']);
  });
});

describe('trendsToProductivityBars', () => {
  it('productive % of categorized per day', () => {
    const m = trendsToProductivityBars(trends);
    expect(m.values).toEqual([0, 75, 50]); // day1 0/0→0; day2 2700/3600; day3 1800/3600
    expect(m.dayLetters.length).toBe(3);
  });
});

describe('leaderboards', () => {
  it('topByProductive sorts desc', () => {
    expect(topByProductive(activity)).toEqual([
      { userId: '1', name: 'Ada', pct: 75 },
      { userId: '2', name: 'Bo', pct: 20 },
    ]);
  });
  it('topByUnproductive sorts desc', () => {
    expect(topByUnproductive(activity)[0]!).toEqual({ userId: '2', name: 'Bo', pct: 80 });
  });
  it('topByIdle sorts desc and carries minutes', () => {
    expect(topByIdle(activity)[0]!).toEqual({
      userId: '2',
      name: 'Bo',
      idlePct: 40,
      idleMinutes: 40,
    });
  });
});

describe('appUsageByCategory', () => {
  it('splits by category and normalizes pct within each list', () => {
    const r = appUsageByCategory(appUsage);
    expect(r.topUsed.map((i) => i.appName)).toEqual(['Xcode', 'Slack', 'YouTube']);
    expect(r.topUsed[0]!.pct).toBe(100); // 3600 is the max in topUsed
    expect(r.topUsed[1]!.pct).toBe(50); // 1800/3600
    expect(r.unproductive.map((i) => i.appName)).toEqual(['YouTube']);
    expect(r.unrated.map((i) => i.appName)).toEqual(['Slack']);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter dashboard test -- overview-view`
Expected: FAIL — the new functions are not exported.

- [ ] **Step 3: Implement the transforms**

Append to `overview-view.ts` (it already imports `formatDuration`; add `TeamTrends`, `TeamActivity`, `TeamAppUsage` to the `@timetrack/contracts` type import):

```ts
export interface DayLetter {
  letter: string;
  weekend: boolean;
}
export interface HoursLineModel {
  values: number[];
  max: number;
  axis: string[];
  dayLetters: DayLetter[];
  labels: string[];
}
export interface ProductivityBarsModel {
  values: number[];
  dayLetters: DayLetter[];
}
export interface AppUsageItem {
  appName: string;
  seconds: number;
  category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';
  pct: number;
}

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A 'YYYY-MM-DD' day string, read in UTC so results are deterministic (Vitest node-env).
function dayLetter(day: string): DayLetter {
  const d = new Date(`${day}T00:00:00.000Z`);
  const wd = d.getUTCDay();
  return { letter: WEEKDAY[wd]!, weekend: wd === 0 || wd === 6 };
}
function monthDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  return `${MONTH[d.getUTCMonth()]!} ${d.getUTCDate()}`;
}
function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part * 100) / whole);
}

export function teamCategoryKpis(trends: TeamTrends): {
  productivePct: number;
  unproductivePct: number;
} {
  let p = 0,
    n = 0,
    u = 0;
  for (const d of trends.days) {
    p += d.productiveSeconds;
    n += d.neutralSeconds;
    u += d.unproductiveSeconds;
  }
  const total = p + n + u;
  return { productivePct: pct(p, total), unproductivePct: pct(u, total) };
}

export function teamIdleKpi(activity: TeamActivity): { idlePct: number } {
  let idle = 0,
    active = 0;
  for (const r of activity.rows) {
    idle += r.idleMinutes;
    active += r.activeMinutes;
  }
  return { idlePct: pct(idle, idle + active) };
}

export function trendsToHoursLine(trends: TeamTrends): HoursLineModel {
  const values = trends.days.map((d) => Math.round((d.trackedSeconds / 3600) * 10) / 10);
  const maxH = Math.max(0, ...values);
  const max = Math.max(6, Math.ceil(maxH / 6) * 6);
  const axis = [max, (max * 2) / 3, max / 3, 0].map((v) => String(v));
  return {
    values,
    max,
    axis,
    dayLetters: trends.days.map((d) => dayLetter(d.day)),
    labels: trends.days.map((d) => monthDay(d.day)),
  };
}

export function trendsToProductivityBars(trends: TeamTrends): ProductivityBarsModel {
  return {
    values: trends.days.map((d) =>
      pct(d.productiveSeconds, d.productiveSeconds + d.neutralSeconds + d.unproductiveSeconds),
    ),
    dayLetters: trends.days.map((d) => dayLetter(d.day)),
  };
}

export function topByProductive(
  activity: TeamActivity,
  n = 6,
): { userId: string; name: string; pct: number }[] {
  return [...activity.rows]
    .sort((a, b) => b.productivePct - a.productivePct)
    .slice(0, n)
    .map((r) => ({ userId: r.userId, name: r.name, pct: r.productivePct }));
}

export function topByUnproductive(
  activity: TeamActivity,
  n = 6,
): { userId: string; name: string; pct: number }[] {
  return [...activity.rows]
    .sort((a, b) => b.unproductivePct - a.unproductivePct)
    .slice(0, n)
    .map((r) => ({ userId: r.userId, name: r.name, pct: r.unproductivePct }));
}

export function topByIdle(
  activity: TeamActivity,
  n = 5,
): { userId: string; name: string; idlePct: number; idleMinutes: number }[] {
  return [...activity.rows]
    .sort((a, b) => b.idlePct - a.idlePct)
    .slice(0, n)
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      idlePct: r.idlePct,
      idleMinutes: r.idleMinutes,
    }));
}

export function appUsageByCategory(
  appUsage: TeamAppUsage,
  n = 5,
): { topUsed: AppUsageItem[]; unproductive: AppUsageItem[]; unrated: AppUsageItem[] } {
  const toItems = (rows: TeamAppUsage['rows']): AppUsageItem[] => {
    const max = Math.max(1, ...rows.map((r) => r.seconds));
    return rows
      .slice(0, n)
      .map((r) => ({
        appName: r.appName,
        seconds: r.seconds,
        category: r.category,
        pct: (r.seconds / max) * 100,
      }));
  };
  return {
    topUsed: toItems(appUsage.rows),
    unproductive: toItems(appUsage.rows.filter((r) => r.category === 'UNPRODUCTIVE')),
    unrated: toItems(appUsage.rows.filter((r) => r.category === 'NEUTRAL')),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter dashboard test -- overview-view`
Expected: PASS. Then `pnpm --filter dashboard typecheck` — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/overview-view.ts apps/dashboard/src/lib/overview-view.spec.ts
git commit -m "feat(dashboard): overview transforms for trends, category KPIs, and app usage"
```

---

### Task 2: API-client methods

**Files:**

- Modify: `apps/dashboard/src/lib/api-client.ts`
- Test: `apps/dashboard/src/lib/api-client.spec.ts`

**Interfaces:**

- Consumes: the private `get<T>(path, schema, token)` helper (already in the file), and `TeamTrendsSchema`/`TeamActivitySchema`/`TeamAppUsageSchema` from `@timetrack/contracts`.
- Produces: `api.trends`, `api.teamActivity`, `api.appUsage`.

- [ ] **Step 1: Write the failing test**

Append to `api-client.spec.ts`:

```ts
import { api } from './api-client';

describe('api.trends', () => {
  it('parses TeamTrends on 200', async () => {
    const payload = {
      from: '2026-07-11T00:00:00.000Z',
      to: '2026-07-13T00:00:00.000Z',
      days: [
        {
          day: '2026-07-12',
          trackedSeconds: 3600,
          productiveSeconds: 1800,
          neutralSeconds: 0,
          unproductiveSeconds: 0,
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify(payload), { status: 200 })),
    );
    expect(
      await api.trends('tok', new URLSearchParams({ from: payload.from, to: payload.to })),
    ).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter dashboard test -- api-client`
Expected: FAIL — `api.trends` is not a function.

- [ ] **Step 3: Implement the methods**

Add `TeamTrendsSchema, TeamActivitySchema, TeamAppUsageSchema` and the types `TeamTrends, TeamActivity, TeamAppUsage` to the `@timetrack/contracts` import at the top of `api-client.ts`. Then add these three methods to the exported `api` object, next to `teamSummary`/`projectSummary`:

```ts
  trends: (token: string, params: URLSearchParams): Promise<TeamTrends> =>
    get(`/reports/trends?${params}`, TeamTrendsSchema, token),
  teamActivity: (token: string, params: URLSearchParams): Promise<TeamActivity> =>
    get(`/reports/team-activity?${params}`, TeamActivitySchema, token),
  appUsage: (token: string, params: URLSearchParams): Promise<TeamAppUsage> =>
    get(`/reports/app-usage?${params}`, TeamAppUsageSchema, token),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter dashboard test -- api-client`
Expected: PASS. Then `pnpm --filter dashboard typecheck` — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/api-client.ts apps/dashboard/src/lib/api-client.spec.ts
git commit -m "feat(dashboard): api-client methods for trends, team-activity, app-usage"
```

---

### Task 3: New components — AppUsageList + the widgets-drawer trio

**Files:**

- Create: `apps/dashboard/src/components/overview/AppUsageList.tsx`
- Create: `apps/dashboard/src/components/overview/WidgetVisibilityProvider.tsx`
- Create: `apps/dashboard/src/components/overview/Widget.tsx`
- Create: `apps/dashboard/src/components/overview/WidgetsDrawer.tsx`

**Interfaces:**

- Consumes: `AppUsageItem` (Task 1), `formatDuration` from `../../lib/format`, `Card`/`Avatar`/icons as needed.
- Produces: `AppUsageList`, `WidgetVisibilityProvider` + `useWidgetVisibility`, `Widget`, `WidgetsDrawer` + `WidgetGroup` (signatures in the Interfaces block).

No unit tests (Vitest is node-env — components aren't unit-tested here). Verified by typecheck + build; behavior by the Task 4 e2e.

- [ ] **Step 1: Create `AppUsageList.tsx`** (Server Component — no `'use client'`)

```tsx
import type { AppUsageItem } from '../../lib/overview-view';
import { formatDuration } from '../../lib/format';

/** Presentational website/app usage list: name · length-bar · tabular time. */
export function AppUsageList({ items }: { items: AppUsageItem[] }) {
  if (items.length === 0) {
    return <p className="text-text-secondary text-body">No data in this range.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {items.map((it) => (
        <li key={it.appName} className="flex items-center gap-3">
          <span className="text-text flex-1 truncate text-[13px]">{it.appName}</span>
          <span className="bg-separator relative h-[6px] w-[120px] overflow-hidden rounded-[3px]">
            <span
              className="absolute inset-y-0 left-0 rounded-[3px]"
              style={{ width: `${it.pct}%`, background: 'var(--tt-accent)' }}
            />
          </span>
          <span className="tt-numeric text-text-secondary w-14 text-right text-caption">
            {formatDuration(it.seconds)}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Create `WidgetVisibilityProvider.tsx`** (mirrors the `ThemeToggle` localStorage pattern)

```tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const KEY = 'tt-widgets';
type Ctx = { isOn: (id: string) => boolean; toggle: (id: string) => void };
const WidgetCtx = createContext<Ctx | null>(null);

/** Holds a {widgetId: false} map of HIDDEN widgets in localStorage. Absent id = visible (default on). */
export function WidgetVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setHidden(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* private mode / bad JSON — default to all visible */
    }
  }, []);

  const isOn = useCallback((id: string) => hidden[id] !== true, [hidden]);
  const toggle = useCallback((id: string) => {
    setHidden((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next[id]) delete next[id];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return <WidgetCtx.Provider value={{ isOn, toggle }}>{children}</WidgetCtx.Provider>;
}

export function useWidgetVisibility(): Ctx {
  const ctx = useContext(WidgetCtx);
  if (!ctx) throw new Error('useWidgetVisibility must be used within WidgetVisibilityProvider');
  return ctx;
}
```

- [ ] **Step 3: Create `Widget.tsx`**

```tsx
'use client';

import { useWidgetVisibility } from './WidgetVisibilityProvider';

/** Wraps one Overview card; hidden via CSS when toggled off in the drawer. Children stay server-rendered. */
export function Widget({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOn } = useWidgetVisibility();
  return (
    <div hidden={!isOn(id)} data-widget={id}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Create `WidgetsDrawer.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useWidgetVisibility } from './WidgetVisibilityProvider';

export interface WidgetGroup {
  label: string;
  items: { id: string; label: string }[];
}

/** "⚙ Widgets" button + a right-hand panel of grouped checkboxes bound to the visibility context. */
export function WidgetsDrawer({ groups }: { groups: WidgetGroup[] }) {
  const [open, setOpen] = useState(false);
  const { isOn, toggle } = useWidgetVisibility();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-separator text-text-secondary hover:text-text rounded-full border px-3 py-1.5 text-label"
      >
        ⚙ Widgets
      </button>
      {open ? (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-label="Widgets">
          <button
            type="button"
            aria-label="Close"
            className="flex-1 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <div className="bg-surface-raised border-separator flex w-72 flex-col gap-4 overflow-y-auto border-l p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-body font-semibold">Widgets</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-text-secondary text-label"
              >
                Done
              </button>
            </div>
            {groups.map((g) => (
              <fieldset key={g.label} className="flex flex-col gap-2">
                <legend className="text-label text-text-secondary mb-1 font-semibold uppercase">
                  {g.label}
                </legend>
                {g.items.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={isOn(it.id)} onChange={() => toggle(it.id)} />
                    {it.label}
                  </label>
                ))}
              </fieldset>
            ))}
            <p className="text-caption text-text-secondary">Remembered on this browser only.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter dashboard typecheck && pnpm --filter dashboard build`
Expected: PASS (no unit tests for components — node-env).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/overview
git commit -m "feat(dashboard): app-usage list and widgets-drawer visibility components"
```

---

### Task 4: Recompose the Overview page + e2e

**Files:**

- Modify: `apps/dashboard/src/app/(app)/page.tsx`
- Create: `apps/dashboard/e2e/overview-flagship.spec.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–3, plus existing `overviewKpis`/`topByHours`/`topByActivity`/`haventTracked`/`donutFromProjects`, `api.teamSummary`/`projectSummary`/`teamOverview`, `StatCard`/`Card`/`SectionHeader`/`Avatar`/`DonutChart`/`Gauge`/`BarMeter`/`LineChart`/`StackedDayBars`, `ReportRangePicker`, `formatDuration`, `getSession`, `ApiError`.
- Produces: the recomposed Overview page (no new exports).

- [ ] **Step 1: Rewrite `page.tsx`**

Replace the file with the version below. It keeps the existing `forbidden`/no-data states and range picker, adds the three new fetches, wraps every card in `<Widget>`, and mounts the provider + drawer. Widget IDs match the drawer groups.

```tsx
import type {
  ProjectSummary,
  TeamActivity,
  TeamAppUsage,
  TeamOverviewRow,
  TeamSummary,
  TeamTrends,
} from '@timetrack/contracts';
import { SetPageTitle } from '../../components/ui/PageTitleContext';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { DonutChart } from '../../components/charts/DonutChart';
import { Gauge } from '../../components/charts/Gauge';
import { BarMeter } from '../../components/charts/BarMeter';
import { LineChart } from '../../components/charts/LineChart';
import { StackedDayBars } from '../../components/charts/StackedDayBars';
import { ReportRangePicker } from '../../components/reports/ReportRangePicker';
import { AppUsageList } from '../../components/overview/AppUsageList';
import { WidgetVisibilityProvider } from '../../components/overview/WidgetVisibilityProvider';
import { Widget } from '../../components/overview/Widget';
import { WidgetsDrawer, type WidgetGroup } from '../../components/overview/WidgetsDrawer';
import { getSession } from '../../lib/session';
import { api, ApiError } from '../../lib/api-client';
import { defaultReportRange } from '../../lib/reports-view';
import { formatDuration } from '../../lib/format';
import {
  appUsageByCategory,
  donutFromProjects,
  haventTracked,
  overviewKpis,
  teamCategoryKpis,
  teamIdleKpi,
  topByActivity,
  topByHours,
  topByIdle,
  topByProductive,
  topByUnproductive,
  trendsToHoursLine,
  trendsToProductivityBars,
} from '../../lib/overview-view';

const GROUPS: WidgetGroup[] = [
  { label: 'Overview', items: [{ id: 'kpis', label: 'KPI tiles' }] },
  {
    label: 'Trends',
    items: [
      { id: 'trend-hours', label: 'Hours tracked' },
      { id: 'trend-productivity', label: 'Productivity %' },
    ],
  },
  {
    label: 'Latest data',
    items: [
      { id: 'projects', label: 'Top projects' },
      { id: 'havent', label: 'Haven’t tracked' },
    ],
  },
  {
    label: 'Top users',
    items: [
      { id: 'top-hours', label: 'Tracked most hours' },
      { id: 'top-activity', label: 'Highest activity %' },
      { id: 'top-productive', label: 'Highest productive %' },
      { id: 'top-unproductive', label: 'Highest unproductive %' },
      { id: 'top-idle', label: 'Highest idle %' },
    ],
  },
  {
    label: 'Websites & applications',
    items: [
      { id: 'apps-used', label: 'Top used' },
      { id: 'apps-unproductive', label: 'Top unproductive' },
      { id: 'apps-unrated', label: 'Top unrated' },
    ],
  },
];

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const fb = defaultReportRange(new Date());
  const from = sp.from ?? fb.from;
  const to = sp.to ?? fb.to;
  const params = new URLSearchParams({ from, to });

  let team: TeamSummary | null = null;
  let projects: ProjectSummary | null = null;
  let trends: TeamTrends | null = null;
  let activity: TeamActivity | null = null;
  let apps: TeamAppUsage | null = null;
  let forbidden = false;
  try {
    [team, projects, trends, activity, apps] = await Promise.all([
      api.teamSummary(session.accessToken, params),
      api.projectSummary(session.accessToken, params),
      api.trends(session.accessToken, params),
      api.teamActivity(session.accessToken, params),
      api.appUsage(session.accessToken, params),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden = true;
  }

  let overviewRows: TeamOverviewRow[] = [];
  try {
    overviewRows = (await api.teamOverview(session.accessToken)).rows;
  } catch {
    overviewRows = [];
  }

  const kpis = overviewKpis(team?.rows ?? [], overviewRows);
  const cat = teamCategoryKpis(trends ?? { from, to, days: [] });
  const idle = teamIdleKpi(activity ?? { from, to, rows: [] });
  const donut = donutFromProjects(projects?.rows ?? []);
  const hoursLine = trendsToHoursLine(trends ?? { from, to, days: [] });
  const prodBars = trendsToProductivityBars(trends ?? { from, to, days: [] });
  const topHours = topByHours(team?.rows ?? []);
  const topActivity = topByActivity(team?.rows ?? []);
  const topProd = topByProductive(activity ?? { from, to, rows: [] });
  const topUnprod = topByUnproductive(activity ?? { from, to, rows: [] });
  const topIdle = topByIdle(activity ?? { from, to, rows: [] });
  const appLists = appUsageByCategory(apps ?? { from, to, rows: [] });
  const notTracked = haventTracked(overviewRows);
  const hasData = (team?.rows.length ?? 0) > 0 || (projects?.rows.length ?? 0) > 0;

  return (
    <>
      <SetPageTitle title="Overview" />
      {forbidden ? (
        <p className="text-text-secondary text-body">
          You’re not permitted to view the team overview.
        </p>
      ) : !hasData ? (
        <p className="text-text-secondary text-body">No team activity in this range.</p>
      ) : (
        <WidgetVisibilityProvider>
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3">
              <WidgetsDrawer groups={GROUPS} />
              <ReportRangePicker from={from} to={to} basePath="/" />
            </div>

            <Widget id="kpis">
              <section className="flex flex-col gap-3">
                <SectionHeader label="Overview" />
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
                  <StatCard label="Time tracked" value={formatDuration(kpis.totalSeconds)} />
                  <StatCard label="Active users" value={String(kpis.activeUsers)} />
                  <StatCard label="Currently tracking" value={String(kpis.tracking)} />
                  <StatCard
                    label="Productive"
                    value={`${cat.productivePct}%`}
                    bar={{
                      pct: cat.productivePct,
                      color: 'var(--tt-good)',
                      caption: 'of categorized time',
                    }}
                  />
                  <StatCard
                    label="Unproductive"
                    value={`${cat.unproductivePct}%`}
                    bar={{
                      pct: cat.unproductivePct,
                      color: 'var(--tt-category-unproductive)',
                      caption: 'of categorized time',
                    }}
                  />
                  <StatCard
                    label="Idle"
                    value={`${idle.idlePct}%`}
                    bar={{
                      pct: idle.idlePct,
                      color: 'var(--tt-text-secondary)',
                      caption: 'of active + idle',
                    }}
                  />
                </div>
              </section>
            </Widget>

            <section className="flex flex-col gap-3">
              <SectionHeader label="Trends" />
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
                <Widget id="trend-hours">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Hours tracked
                    </h3>
                    <LineChart
                      values={hoursLine.values}
                      max={hoursLine.max}
                      axis={hoursLine.axis}
                      dayLetters={hoursLine.dayLetters}
                      labels={hoursLine.labels}
                      color="var(--tt-accent)"
                      format={(v) => `${v}h`}
                    />
                  </Card>
                </Widget>
                <Widget id="trend-productivity">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Productivity % per day
                    </h3>
                    <StackedDayBars values={prodBars.values} dayLetters={prodBars.dayLetters} />
                  </Card>
                </Widget>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader label="Latest data" />
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
                <Widget id="projects">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Top projects
                    </h3>
                    {donut.segments.length > 0 ? (
                      <DonutChart
                        items={donut.segments}
                        centerValue={formatDuration(donut.totalSeconds)}
                        centerLabel="tracked"
                      />
                    ) : (
                      <p className="text-text-secondary text-body">
                        No project data in this range.
                      </p>
                    )}
                  </Card>
                </Widget>
                <Widget id="havent">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Haven’t tracked
                    </h3>
                    {notTracked.length > 0 ? (
                      <ul className="m-0 flex list-none flex-col gap-3 p-0">
                        {notTracked.map((row) => (
                          <li key={row.userId} className="flex items-center gap-2.5">
                            <Avatar name={row.name} size={30} />
                            <div className="flex flex-col">
                              <span className="text-text text-[13px]">{row.name}</span>
                              <span className="text-text-secondary text-caption">
                                Never tracked today
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-text-secondary text-body">Everyone tracked time today.</p>
                    )}
                  </Card>
                </Widget>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader label="Top users" />
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
                <Widget id="top-hours">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Tracked most hours
                    </h3>
                    {topHours.length > 0 ? (
                      <div className="flex flex-col gap-3.5">
                        {topHours.map((row) => (
                          <BarMeter
                            key={row.userId}
                            label={
                              <span className="inline-flex items-center gap-2">
                                <Avatar name={row.name} size={22} />
                                {row.name}
                              </span>
                            }
                            value={formatDuration(row.trackedSeconds)}
                            fills={[{ pct: row.pct, color: 'var(--tt-accent)' }]}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
                <Widget id="top-activity">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Highest activity %
                    </h3>
                    {topActivity.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {topActivity.map((row) => (
                          <div key={row.userId} className="flex flex-col items-center gap-1.5">
                            <Gauge pct={row.activityPct} color="var(--tt-good)" />
                            <Avatar name={row.name} size={22} />
                            <span className="text-caption text-text-secondary">
                              {row.name.split(' ')[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
                <Widget id="top-productive">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Highest productive %
                    </h3>
                    {topProd.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {topProd.map((row) => (
                          <div key={row.userId} className="flex flex-col items-center gap-1.5">
                            <Gauge pct={row.pct} color="var(--tt-good)" />
                            <Avatar name={row.name} size={22} />
                            <span className="text-caption text-text-secondary">
                              {row.name.split(' ')[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
                <Widget id="top-unproductive">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Highest unproductive %
                    </h3>
                    {topUnprod.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {topUnprod.map((row) => (
                          <div key={row.userId} className="flex flex-col items-center gap-1.5">
                            <Gauge pct={row.pct} color="var(--tt-category-unproductive)" />
                            <Avatar name={row.name} size={22} />
                            <span className="text-caption text-text-secondary">
                              {row.name.split(' ')[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
                <Widget id="top-idle">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Highest idle %
                    </h3>
                    {topIdle.length > 0 ? (
                      <div className="flex flex-col gap-3.5">
                        {topIdle.map((row) => (
                          <BarMeter
                            key={row.userId}
                            label={
                              <span className="inline-flex items-center gap-2">
                                <Avatar name={row.name} size={22} />
                                {row.name}
                              </span>
                            }
                            value={`${row.idlePct}% (${row.idleMinutes}m)`}
                            fills={[{ pct: row.idlePct, color: 'var(--tt-text-secondary)' }]}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader label="Websites & applications" />
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
                <Widget id="apps-used">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Top used
                    </h3>
                    <AppUsageList items={appLists.topUsed} />
                  </Card>
                </Widget>
                <Widget id="apps-unproductive">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Top unproductive
                    </h3>
                    <AppUsageList items={appLists.unproductive} />
                  </Card>
                </Widget>
                <Widget id="apps-unrated">
                  <Card padding="md">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Top unrated
                    </h3>
                    <AppUsageList items={appLists.unrated} />
                  </Card>
                </Widget>
              </div>
            </section>
          </div>
        </WidgetVisibilityProvider>
      )}
    </>
  );
}
```

Notes for the implementer:

- Use the CSS variables already referenced elsewhere on the page (`--tt-good`, `--tt-accent`, `--tt-category-unproductive`, `--tt-text-secondary`). If one is missing in `globals.css`, substitute the nearest existing token rather than inventing a new one, and note it.
- `BarMeter`'s `fills` prop and `Gauge`'s `pct`/`color` props are used exactly as the pre-existing Overview did — do not change those components.

- [ ] **Step 2: Create the e2e scaffold** `apps/dashboard/e2e/overview-flagship.spec.ts`

Mirror the repo convention (skipped until a live app + seeded auth exist, per `overview.spec.ts`):

```ts
import { test, expect } from '@playwright/test';

/**
 * SCAFFOLD: skipped so `test:e2e` passes without a browser install or a running app.
 * Remove `.skip` once seeded data + auth are wired, then run against a live dashboard.
 */
test.describe.skip('overview flagship', () => {
  test('renders the new sections', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/productivity % per day/i)).toBeVisible();
    await expect(page.getByText(/highest idle %/i)).toBeVisible();
    await expect(page.getByText(/websites & applications/i)).toBeVisible();
  });

  test('widgets drawer toggles a card and persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /widgets/i }).click();
    await page.getByLabel(/highest idle %/i).uncheck();
    await expect(page.getByRole('heading', { name: /highest idle %/i })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: /highest idle %/i })).toBeHidden();
  });
});
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter dashboard typecheck && pnpm --filter dashboard build && pnpm --filter dashboard test`
Expected: all PASS (typecheck clean under `exactOptionalPropertyTypes`; build succeeds; the transform + api-client unit tests from Tasks 1–2 stay green). The e2e is a skipped scaffold — do not claim it ran.

- [ ] **Step 4: Confirm existing e2e still collect** (they are skipped scaffolds; this just proves no rename broke a selector import)

Run: `pnpm --filter dashboard test:e2e -- overview` (or the repo's e2e command)
Expected: existing `overview.spec.ts` / `overview-reskin.spec.ts` collect and skip cleanly.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(app\)/page.tsx apps/dashboard/e2e/overview-flagship.spec.ts
git commit -m "feat(dashboard): recompose Overview into the flagship layout with widgets drawer"
```

---

## Notes for the executor

- **No Docker needed** for this sub-project — verification is Vitest (node-env) + typecheck + build, all runnable here. The Playwright e2e is a skipped scaffold (needs a live app + seeded auth), consistent with every other dashboard e2e in the repo.
- The three new charts (`LineChart`, `StackedDayBars`, plus the app lists) have **no prior consumers** — Task 4 is their first wiring; if a component prop doesn't line up with the transform output, fix the call site, not the shared component.
- Keep each card wrapped in exactly one `<Widget id="…">`; the ids must match `GROUPS` so the drawer toggles the right card.
- Do not touch Reports / Approvals / Admin (sub-project C).

```

```
