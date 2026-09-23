# Dashboard Redesign — Interaction Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four interaction capabilities the dashboard lacks — a sortable/freezable data table, loading + empty + error states, detail drawers with toasts, and a density toggle — without moving any page off Server Components.

**Architecture:** All table logic lives as pure functions in `src/lib/data-table.ts`; the component is a thin presentational client leaf. Because a Server Component cannot pass a function across the RSC boundary, each `DataTable` adopter gets a `'use client'` wrapper that owns its column definitions while its page stays server-rendered and passes serializable rows. Drawers come in two kinds: presentational (data already loaded, no routing) and detail (its own server fetch, via Next parallel + intercepting routes so deep links still resolve to the full page).

**Tech Stack:** Next.js 16 App Router (React 19, RSC), Tailwind CSS v4, TypeScript, Vitest (**node environment, no DOM**), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-dashboard-clickup-sync-redesign-design.md`

**Predecessor:** `docs/superpowers/plans/2026-09-21-dashboard-redesign-visual-foundation.md` (spec Phases 1–3) must be merged first. This plan consumes its `.row-3d`, `.input-3d`, `--pad-y` and `--row-h`.

## Global Constraints

- **No new dependency.** Extend `src/components/ui/icons.tsx` for any new glyph. CLAUDE.md §2 requires asking first.
- **No page becomes a Client Component.** No `'use client'` is added to any file under `src/app/` **except** the intercepting-route pages in Phase 7, which stay server-rendered anyway. Pages pass serializable props only.
- **No function prop crosses the RSC boundary.** A server page may not pass `render`, `onRowClick`, `onSortChange` or any callback to a client component.
- **The session token never reaches the browser.** All fetching stays in Server Components and Server Actions.
- **Tests run with no DOM.** Vitest is node-environment; use pure functions or `renderToStaticMarkup` (see `src/components/ui/PasswordField.spec.tsx`). Interaction cannot be simulated — that is why the logic lives in `lib/`.
- **No API, contracts, schema, worker, or migration change.**
- **Commits:** Conventional Commits, `type(dashboard): summary` ≤72 chars. **No AI attribution, no co-author trailer, no generated-by footer** (CLAUDE.md §0).
- **Gate before each phase's final commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

---

## Deviations from the spec (decided during planning)

1. **`admin/audit` does not adopt `DataTable`.** Spec §3 listed it as an adopter. But audit is the **only** paginated page in the dashboard (`page.tsx:63` advances a `nextCursor` through the URL) and `api.listAudit` accepts no sort parameter — so a client-side sort could only reorder the current page, which is precisely the case clickup-sync's own `DataTable` disables. Audit keeps the compound `Table` and instead gains `EmptyState` and the `.row-3d` hover (Task 10).

2. **`TeamSummaryTable` is deleted, not migrated.** Spec §1 noted it as the one raw `<table>` escaping the primitives. It is **dead code** — `grep -rn 'TeamSummaryTable' src` finds only its own definition, no importer. Migrating it would be work on code nothing renders. Task 6 deletes it.

3. **Two adopters, not three.** Following 1 and 2: `PeopleTable` and `ReportsByPersonTable`.

4. **No Suspense sub-boundary inside a page.** Spec §6.2 asked for `Suspense` + `TableSkeleton`
   around slow sub-trees. A Suspense boundary needs an independently-fetching child to suspend
   on, and `app/(app)/overview/page.tsx:107` resolves everything in one `Promise.allSettled`
   before it renders anything — there is no sub-tree to isolate without restructuring that
   fetch, which is beyond a redesign's remit. Route-level `loading.tsx` (Task 11) covers the
   loading story instead, and `TableSkeleton` is consumed by `PageSkeleton` rather than being
   dead code. `TrackingFooter` remains the one place the sub-boundary pattern genuinely applies,
   and it already uses it (`(app)/layout.tsx:40`).

### ⚠️ Flagged for your call: four of `DataTable`'s six features have no consumer

The spec (§6.1) specifies sorting, frozen columns, pagination, column show/hide, row selection and expandable rows. The two adopters need **sorting** and **row-click navigation**. Neither needs selection, expandable rows or column visibility, and only `PeopleTable` plausibly wants a frozen first column.

Tasks 2–3 build what is used. **Tasks 7–9 build the other three features and are marked DEFERRABLE** — they are self-contained, nothing else depends on them, and dropping them costs nothing later. They are included because the spec asked for them; delete those three tasks if you would rather not carry unused API surface.

---

## File Structure

**Created — logic**

- `src/lib/data-table.ts` + `.spec.ts` — sort/paginate/sticky/selection, all pure

**Created — primitives**

- `src/components/ui/DataTable.tsx` + `.spec.tsx`
- `src/components/ui/EmptyState.tsx` + `.spec.tsx`
- `src/components/ui/Skeleton.tsx` + `.spec.tsx` (exports `Skeleton`, `TableSkeleton`, `PageSkeleton`)
- `src/components/ui/Drawer.tsx` + `.spec.tsx`
- `src/components/ui/RouteDrawer.tsx` — client wrapper so an intercepted Server Component page can open a Drawer
- `src/components/ui/Toast.tsx` (provider + `useToast`)
- `src/components/ui/DensityToggle.tsx`

**Created — routing**

- `src/app/(app)/*/loading.tsx`, `src/app/(app)/*/error.tsx`
- `src/app/(app)/@drawer/default.tsx`, `src/app/(app)/@drawer/(.)people/[userId]/page.tsx`, `src/app/(app)/@drawer/(.)projects/[projectId]/page.tsx`

**Modified**

- `src/components/overview/PeopleTable.tsx` — server → client, onto `DataTable`
- `src/components/reports/ReportsByPersonTable.tsx` — onto `DataTable`
- `src/app/(app)/admin/audit/page.tsx` — `EmptyState` + `.row-3d`
- `src/app/(app)/layout.tsx` — `@drawer` slot, `ToastProvider`
- `src/app/layout.tsx` — one line in the pre-paint script
- `src/components/ui/TopBar.tsx` — mount `DensityToggle`

**Deleted**

- `src/components/reports/TeamSummaryTable.tsx` (dead code)

---

# Phase 4 — DataTable (`feat(dashboard): add a sortable, freezable data table`)

### Task 1: Pure table logic

**Files:**

- Create: `src/lib/data-table.ts`, `src/lib/data-table.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, and every later task in this phase depends on these exact signatures:
  - `type SortDir = 'asc' | 'desc'`
  - `type Sort = { key: string; dir: SortDir }`
  - `nextSort(current: Sort | null, key: string): Sort`
  - `sortRows<T>(rows: readonly T[], accessor: (row: T) => string | number | null, dir: SortDir): T[]`
  - `paginate<T>(rows: readonly T[], page: number, pageSize: number): T[]`
  - `pageCount(total: number, pageSize: number): number`
  - `stickyOffsets(widths: readonly number[]): number[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/data-table.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextSort, sortRows, paginate, pageCount, stickyOffsets } from './data-table';

describe('nextSort', () => {
  /** A fresh column starts descending: for every sortable column here (tracked time,
   *  activity, idle) "most first" is the question being asked. */
  it('starts a new column descending', () => {
    expect(nextSort(null, 'tracked')).toEqual({ key: 'tracked', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'tracked')).toEqual({
      key: 'tracked',
      dir: 'desc',
    });
  });

  it('flips direction when the same column is clicked again', () => {
    expect(nextSort({ key: 'tracked', dir: 'desc' }, 'tracked')).toEqual({
      key: 'tracked',
      dir: 'asc',
    });
    expect(nextSort({ key: 'tracked', dir: 'asc' }, 'tracked')).toEqual({
      key: 'tracked',
      dir: 'desc',
    });
  });
});

describe('sortRows', () => {
  const rows = [
    { n: 'Bea', v: 2 },
    { n: 'Ada', v: 3 },
    { n: 'Cy', v: 1 },
  ];

  it('sorts numerically in both directions', () => {
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([1, 2, 3]);
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([3, 2, 1]);
  });

  it('sorts strings by locale, not code point', () => {
    expect(sortRows(rows, (r) => r.n, 'asc').map((r) => r.n)).toEqual(['Ada', 'Bea', 'Cy']);
  });

  it('does not mutate the input', () => {
    const before = rows.map((r) => r.v);
    sortRows(rows, (r) => r.v, 'desc');
    expect(rows.map((r) => r.v)).toEqual(before);
  });

  /**
   * PeopleTable renders an em dash for a null productive/idle percentage — a degraded
   * team-activity response must never read as 0%. Sorting has to respect that: nulls are
   * "no data", so they sort LAST in both directions rather than being coerced to 0 and
   * masquerading as the smallest value.
   */
  it('sorts nulls last regardless of direction', () => {
    const withNulls = [{ v: 5 }, { v: null }, { v: 1 }];
    expect(sortRows(withNulls, (r) => r.v, 'asc').map((r) => r.v)).toEqual([1, 5, null]);
    expect(sortRows(withNulls, (r) => r.v, 'desc').map((r) => r.v)).toEqual([5, 1, null]);
  });

  it('is stable for equal keys', () => {
    const tied = [
      { n: 'first', v: 1 },
      { n: 'second', v: 1 },
    ];
    expect(sortRows(tied, (r) => r.v, 'asc').map((r) => r.n)).toEqual(['first', 'second']);
  });
});

describe('paginate', () => {
  const rows = [1, 2, 3, 4, 5];

  it('slices the requested 1-based page', () => {
    expect(paginate(rows, 1, 2)).toEqual([1, 2]);
    expect(paginate(rows, 3, 2)).toEqual([5]);
  });

  /** A filter change can leave the page index past the end; returning [] would render an
   *  empty table that looks like "no data". Clamp to the last page instead. */
  it('clamps a page index past the end to the last page', () => {
    expect(paginate(rows, 99, 2)).toEqual([5]);
  });

  it('clamps a page index below one', () => {
    expect(paginate(rows, 0, 2)).toEqual([1, 2]);
  });

  it('returns everything when the page is larger than the data', () => {
    expect(paginate(rows, 1, 100)).toEqual(rows);
  });
});

describe('pageCount', () => {
  it('rounds up', () => {
    expect(pageCount(5, 2)).toBe(3);
    expect(pageCount(4, 2)).toBe(2);
  });

  /** An empty table still has one (empty) page — zero would break "Page 1 of 0". */
  it('is at least one', () => {
    expect(pageCount(0, 10)).toBe(1);
  });
});

describe('stickyOffsets', () => {
  /** Each frozen column's `left` is the sum of the widths before it, so the first is
   *  always 0. Any drift here makes frozen columns overlap during horizontal scroll. */
  it('accumulates the widths before each column', () => {
    expect(stickyOffsets([120, 80, 60])).toEqual([0, 120, 200]);
  });

  it('handles a single frozen column', () => {
    expect(stickyOffsets([120])).toEqual([0]);
  });

  it('handles none', () => {
    expect(stickyOffsets([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- data-table`
Expected: FAIL — `Failed to resolve import "./data-table"`.

- [ ] **Step 3: Implement**

Create `src/lib/data-table.ts`:

```ts
/**
 * Pure table mechanics for `components/ui/DataTable`.
 *
 * This lives in lib/ rather than the component for two reasons: the dashboard's vitest runs
 * in a node environment with no DOM, so a header click cannot be simulated — but the logic
 * behind it can be tested exhaustively here; and it matches the eight existing `lib/*-view.ts`
 * view-model modules.
 */

export type SortDir = 'asc' | 'desc';
export type Sort = { key: string; dir: SortDir };

/**
 * The sort a header click should produce. A new column starts descending — for every sortable
 * column in this app ("tracked", "activity", "idle") the question being asked is "most first".
 * Clicking the active column flips it.
 */
export function nextSort(current: Sort | null, key: string): Sort {
  if (current && current.key === key) {
    return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  }
  return { key, dir: 'desc' };
}

/**
 * Stable sort by a caller-supplied accessor. Strings compare with `localeCompare`; numbers
 * compare numerically.
 *
 * `null` means "no data" and always sorts LAST, in both directions. Coercing it to 0 would
 * make a degraded `team-activity` response sort as though those people were 0% productive,
 * which is exactly the lie PeopleTable's em dash exists to avoid.
 */
export function sortRows<T>(
  rows: readonly T[],
  accessor: (row: T) => string | number | null,
  dir: SortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls last, not sign-flipped
    if (bv === null) return -1;
    const cmp =
      typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : Number(av) - Number(bv);
    return cmp * sign;
  });
}

/** Slice one 1-based page. A page index outside the data clamps rather than returning [], so a
 *  stale index after a filter change never renders as "no data". */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const last = pageCount(rows.length, pageSize);
  const clamped = Math.min(Math.max(page, 1), last);
  const start = (clamped - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** Number of pages, never below 1 — an empty table still has one empty page. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * `left` offset for each frozen column, derived from the declared widths of the frozen columns
 * before it. Frozen columns MUST therefore declare a numeric width and render at it (pin long
 * content with maxWidth + ellipsis) or the offsets drift and the columns overlap while scrolling.
 */
export function stickyOffsets(widths: readonly number[]): number[] {
  let acc = 0;
  return widths.map((w) => {
    const left = acc;
    acc += w;
    return left;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- data-table`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/data-table.ts apps/dashboard/src/lib/data-table.spec.ts
git commit -m "feat(dashboard): add pure sort and paging helpers for tables"
```

---

### Task 2: EmptyState

**Files:**

- Create: `src/components/ui/EmptyState.tsx`, `src/components/ui/EmptyState.spec.tsx`

**Interfaces:**

- Produces: `EmptyState({ title, body?, icon?, action? })`. Task 3 renders it as `DataTable`'s default empty view; Task 10 uses it on the audit page.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/EmptyState.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    expect(renderToStaticMarkup(<EmptyState title="Nothing here" />)).toContain('Nothing here');
  });

  it('renders the body when given', () => {
    const html = renderToStaticMarkup(<EmptyState title="t" body="explain why" />);
    expect(html).toContain('explain why');
  });

  it('omits the body element entirely when not given', () => {
    expect(renderToStaticMarkup(<EmptyState title="t" />)).not.toContain('<p');
  });

  it('renders an action when given', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="t" action={<button type="button">Do it</button>} />,
    );
    expect(html).toContain('Do it');
  });

  /** Decorative: the title carries the meaning, so the glyph must not be announced twice. */
  it('hides a decorative icon from assistive tech', () => {
    const html = renderToStaticMarkup(<EmptyState title="t" icon={<svg />} />);
    expect(html).toContain('aria-hidden="true"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- EmptyState`
Expected: FAIL — cannot resolve `./EmptyState`.

- [ ] **Step 3: Implement**

Create `src/components/ui/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * The calm "nothing to show" panel. Presentational and function-prop-free, so it can be
 * rendered from a Server Component as well as from inside `DataTable`.
 */
export function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  /** One sentence on why it is empty and what would fill it. */
  body?: string;
  /** Decorative glyph — hidden from assistive tech; the title carries the meaning. */
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-[26px] py-12 text-center">
      {icon ? (
        <span aria-hidden="true" className="text-neutral mb-1 inline-flex">
          {icon}
        </span>
      ) : null}
      <span className="text-h3 font-bold">{title}</span>
      {body ? <p className="text-text-secondary text-label max-w-[46ch]">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- EmptyState`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/ui/EmptyState.tsx apps/dashboard/src/components/ui/EmptyState.spec.tsx
git commit -m "feat(dashboard): add a shared empty-state panel"
```

---

### Task 3: DataTable — sorting, frozen columns, row click

**Files:**

- Create: `src/components/ui/DataTable.tsx`, `src/components/ui/DataTable.spec.tsx`

**Interfaces:**

- Consumes: `nextSort`, `sortRows`, `stickyOffsets` (Task 1); `EmptyState` (Task 2); `Table`/`THead`/`Tbody`/`Tr`/`Th`/`Td` and `.row-3d` (predecessor plan).
- Produces:
  - `type Column<T> = { key: string; header: string; render: (row: T) => ReactNode; sortBy?: (row: T) => string | number | null; align?: 'left' | 'right'; width?: number; sticky?: boolean }`
  - `DataTable<T>({ columns, rows, rowKey, initialSort?, empty?, onRowClick? })`
- Tasks 4 and 5 consume both. **Every consumer must be a `'use client'` file** — `render`, `sortBy` and `onRowClick` are functions and cannot cross the RSC boundary.

**Design note:** sortability is encoded as the presence of a `sortBy` accessor rather than a `sortable: boolean` + parent-supplied comparator. That lets the table sort itself and makes "sortable but no accessor" unrepresentable — a simplification over clickup-sync, whose table takes `sortable?: boolean` and can be configured into that broken state.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/DataTable.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataTable, type Column } from './DataTable';

type Row = { id: string; name: string; n: number };

const rows: Row[] = [
  { id: 'a', name: 'Bea', n: 2 },
  { id: 'b', name: 'Ada', n: 3 },
];

const columns: Column<Row>[] = [
  { key: 'name', header: 'Person', render: (r) => r.name, sortBy: (r) => r.name },
  { key: 'n', header: 'Count', render: (r) => r.n, sortBy: (r) => r.n, align: 'right' },
  { key: 'note', header: 'Note', render: () => '—' },
];

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <DataTable columns={columns} rows={rows} rowKey={(r: Row) => r.id} {...props} />,
  );

describe('DataTable', () => {
  it('renders every column header', () => {
    const html = render();
    expect(html).toContain('Person');
    expect(html).toContain('Count');
    expect(html).toContain('Note');
  });

  it('renders a cell per row via the column renderer', () => {
    const html = render();
    expect(html).toContain('Bea');
    expect(html).toContain('Ada');
  });

  /** A column with no sortBy accessor must not advertise sortability — aria-sort on an
   *  unsortable header tells assistive tech about an interaction that does not exist. */
  it('marks only accessor-bearing columns as sortable', () => {
    const html = render();
    expect(html.match(/aria-sort/g)).toHaveLength(2);
  });

  it('applies the initial sort before first paint', () => {
    const html = render({ initialSort: { key: 'name', dir: 'asc' } });
    expect(html.indexOf('Ada')).toBeLessThan(html.indexOf('Bea'));
    expect(html).toContain('aria-sort="ascending"');
  });

  it('renders rows unsorted when no initial sort is given', () => {
    const html = render();
    expect(html.indexOf('Bea')).toBeLessThan(html.indexOf('Ada'));
  });

  it('shows the empty state instead of an empty table body', () => {
    const html = render({ rows: [], empty: { title: 'No people' } });
    expect(html).toContain('No people');
    expect(html).not.toContain('<tbody');
  });

  it('falls back to a default empty state', () => {
    expect(render({ rows: [] })).toContain('No data');
  });

  /**
   * Frozen columns need a numeric width to derive their left offset from. A sticky column
   * without one would silently get left:0 and stack on top of its neighbour.
   */
  it('gives frozen columns a left offset from their declared widths', () => {
    const frozen: Column<Row>[] = [
      { key: 'name', header: 'Person', render: (r) => r.name, sticky: true, width: 120 },
      { key: 'n', header: 'Count', render: (r) => r.n, sticky: true, width: 80 },
      { key: 'note', header: 'Note', render: () => '—' },
    ];
    const html = renderToStaticMarkup(
      <DataTable columns={frozen} rows={rows} rowKey={(r) => r.id} />,
    );
    expect(html).toContain('left:0');
    expect(html).toContain('left:120px');
  });

  it('right-aligns the columns that ask for it', () => {
    expect(render()).toContain('text-right');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- DataTable`
Expected: FAIL — cannot resolve `./DataTable`.

- [ ] **Step 3: Implement**

Create `src/components/ui/DataTable.tsx`:

```tsx
'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Table, THead, Tbody, Tr, Th, Td } from './Table';
import { EmptyState } from './EmptyState';
import { nextSort, sortRows, stickyOffsets, type Sort } from '../../lib/data-table';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /**
   * Presence makes the column sortable, and supplies the value to sort on. Encoding it this
   * way rather than as `sortable: boolean` makes "sortable with nothing to sort by"
   * unrepresentable. Return null for "no data" — those rows sort last either way.
   */
  sortBy?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  /** Required when `sticky` is set: the frozen left offsets are derived from these. */
  width?: number;
  sticky?: boolean;
};

/**
 * The data-dense table: sortable headers, optional frozen leading columns, optional row click.
 *
 * MUST be used from a `'use client'` file. `render`, `sortBy` and `onRowClick` are functions,
 * and a Server Component cannot pass a function to a Client Component — so each adopter is a
 * thin client wrapper that owns its column definitions while its page stays server-rendered
 * and passes only serializable rows.
 *
 * Sorting is client-side over the whole dataset. That is correct here because every adopter
 * receives its complete row set; it would be wrong for a server-paginated table, which is why
 * the cursor-paginated audit log keeps the compound `Table` instead.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  initialSort,
  empty,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: Sort;
  empty?: { title: string; body?: string; icon?: ReactNode };
  onRowClick?: (row: T) => void;
}) {
  const [sort, setSort] = useState<Sort | null>(initialSort ?? null);

  // Frozen columns are the leading run of `sticky` columns; a sticky column after a
  // non-sticky one cannot be frozen (there is nothing to pin it against).
  const frozenCount = useMemo(() => {
    let n = 0;
    for (const c of columns) {
      if (!c.sticky) break;
      n++;
    }
    return n;
  }, [columns]);

  const offsets = useMemo(
    () => stickyOffsets(columns.slice(0, frozenCount).map((c) => c.width ?? 0)),
    [columns, frozenCount],
  );

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortBy) return rows;
    return sortRows(rows, col.sortBy, sort.dir);
  }, [rows, columns, sort]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title={empty?.title ?? 'No data'}
        {...(empty?.body ? { body: empty.body } : {})}
        {...(empty?.icon ? { icon: empty.icon } : {})}
      />
    );
  }

  const stickyStyle = (i: number) =>
    i < frozenCount
      ? {
          position: 'sticky' as const,
          left: offsets[i],
          zIndex: 1,
          background: 'var(--tt-surface-raised)',
        }
      : undefined;

  return (
    <Table>
      <THead>
        <tr>
          {columns.map((col, i) => (
            <Th
              key={col.key}
              align={col.align ?? 'left'}
              {...(col.sortBy ? { sortable: true } : {})}
              sortDirection={sort?.key === col.key ? sort.dir : null}
              {...(col.sortBy
                ? { onSortClick: () => setSort((cur) => nextSort(cur, col.key)) }
                : {})}
              className={stickyStyle(i) ? 'sticky' : ''}
              style={stickyStyle(i)}
            >
              {col.header}
            </Th>
          ))}
        </tr>
      </THead>
      <Tbody>
        {sorted.map((row) => (
          <Tr
            key={rowKey(row)}
            className="row-3d"
            {...(onRowClick ? { interactive: true, onClick: () => onRowClick(row) } : {})}
          >
            {columns.map((col, i) => (
              <Td
                key={col.key}
                align={col.align ?? 'left'}
                style={stickyStyle(i)}
                {...(col.width !== undefined ? { className: 'truncate' } : {})}
              >
                {col.render(row)}
              </Td>
            ))}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
```

- [ ] **Step 4: Add `style` passthrough to the Table primitives**

`Th` and `Td` do not currently accept `style`. `Td` spreads `...rest` from `TdHTMLAttributes` so it already does; **`Th` does not** — it takes an explicit prop list. Add `style?: CSSProperties` to `Th`'s props and spread it onto the `<th>`, in both the sortable and non-sortable branches. Import `CSSProperties` as a type.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- DataTable`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/ui/DataTable.tsx apps/dashboard/src/components/ui/DataTable.spec.tsx apps/dashboard/src/components/ui/Table.tsx
git commit -m "feat(dashboard): add a sortable, freezable data table"
```

---

### Task 4: Migrate PeopleTable

**Files:**

- Modify: `src/components/overview/PeopleTable.tsx` (server → client, onto `DataTable`)
- Create: `src/components/overview/PeopleTable.spec.tsx`

**Interfaces:**

- Consumes: `DataTable`, `Column` (Task 3); `PersonRow` from `src/lib/overview-view`.
- Produces: `PeopleTable({ rows }: { rows: PersonRow[] })` — **prop signature unchanged**, so `app/(app)/overview/page.tsx:296` needs no edit and stays a Server Component.

- [ ] **Step 1: Write the failing test**

Create `src/components/overview/PeopleTable.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PeopleTable } from './PeopleTable';
import type { PersonRow } from '../../lib/overview-view';

const row = (over: Partial<PersonRow>): PersonRow =>
  ({
    userId: 'u1',
    name: 'Ada',
    live: false,
    trackedSeconds: 3600,
    activityPct: 50,
    productivePct: 60,
    unproductivePct: 20,
    idlePct: 10,
    idleMinutes: 6,
    ...over,
  }) as PersonRow;

describe('PeopleTable', () => {
  it('renders a row per person', () => {
    const html = renderToStaticMarkup(
      <PeopleTable
        rows={[row({ userId: 'u1', name: 'Ada' }), row({ userId: 'u2', name: 'Bea' })]}
      />,
    );
    expect(html).toContain('Ada');
    expect(html).toContain('Bea');
  });

  it('sorts by tracked time descending by default', () => {
    const html = renderToStaticMarkup(
      <PeopleTable
        rows={[
          row({ userId: 'u1', name: 'Low', trackedSeconds: 60 }),
          row({ userId: 'u2', name: 'High', trackedSeconds: 7200 }),
        ]}
      />,
    );
    expect(html.indexOf('High')).toBeLessThan(html.indexOf('Low'));
  });

  /** A degraded team-activity response must never read as "0% productive". */
  it('renders an em dash for missing focus mix and idle', () => {
    const html = renderToStaticMarkup(
      <PeopleTable rows={[row({ productivePct: null, unproductivePct: null, idlePct: null })]} />,
    );
    expect(html).toContain('—');
    expect(html).not.toContain('0%');
  });

  it('shows the empty state when nobody tracked time', () => {
    const html = renderToStaticMarkup(<PeopleTable rows={[]} />);
    expect(html).toContain('No people tracked time in this range');
  });

  it('keeps the live indicator for someone tracking now', () => {
    const html = renderToStaticMarkup(<PeopleTable rows={[row({ live: true })]} />);
    expect(html).toContain('tracking now');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- PeopleTable`
Expected: FAIL on `sorts by tracked time descending by default` — the current component preserves input order.

- [ ] **Step 3: Implement**

Rewrite `src/components/overview/PeopleTable.tsx`. Add `'use client';` as the first line, then define the columns and hand them to `DataTable`. Keep every cell's existing markup verbatim — the `Avatar` + live pulse, the `Meter`, the `SplitMeter` with its em-dash guard, and `formatDuration`. Then:

```tsx
const columns: Column<PersonRow>[] = [
  {
    key: 'name',
    header: 'Person',
    sortBy: (r) => r.name,
    render: (r) => (/* existing Link + Avatar + live pulse markup, unchanged */),
  },
  {
    key: 'tracked',
    header: 'Tracked',
    align: 'right',
    sortBy: (r) => r.trackedSeconds,
    render: (r) => <span className="font-bold">{formatDuration(r.trackedSeconds)}</span>,
  },
  {
    key: 'activity',
    header: 'Activity',
    sortBy: (r) => r.activityPct,
    render: (r) => (/* existing Meter + percent markup, unchanged */),
  },
  {
    key: 'mix',
    header: 'Focus mix',
    // Sorts on the productive share; nulls sort last, which is why the accessor returns
    // null rather than 0 for a degraded response.
    sortBy: (r) => r.productivePct,
    render: (r) => (/* existing SplitMeter markup with its null guard, unchanged */),
  },
  {
    key: 'idle',
    header: 'Idle',
    align: 'right',
    sortBy: (r) => r.idlePct,
    render: (r) => (/* existing idle markup with its null guard, unchanged */),
  },
];

export function PeopleTable({ rows }: { rows: PersonRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.userId}
      initialSort={{ key: 'tracked', dir: 'desc' }}
      empty={{
        title: 'No people tracked time in this range',
        body: 'Pick a wider date range, or check that clients are installed and tracking.',
      }}
    />
  );
}
```

Do **not** add `onRowClick`: the Person cell already contains a `next/link`, which keeps the row keyboard-navigable and middle-clickable. A row-level click handler on top of it would double-handle the navigation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- PeopleTable`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the page did not become a client component**

Run: `head -3 'apps/dashboard/src/app/(app)/overview/page.tsx'`
Expected: no `'use client'`. The page still fetches on the server and passes plain rows.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/overview/PeopleTable.tsx apps/dashboard/src/components/overview/PeopleTable.spec.tsx
git commit -m "feat(dashboard): make the overview people table sortable"
```

---

### Task 5: Migrate ReportsByPersonTable

**Files:**

- Modify: `src/components/reports/ReportsByPersonTable.tsx`
- Create: `src/components/reports/ReportsByPersonTable.spec.tsx`

**Interfaces:**

- Consumes: `DataTable`, `Column` (Task 3); `TeamSummaryRow` from `@timetrack/contracts`.
- Produces: `ReportsByPersonTable({ rows }: { rows: TeamSummaryRow[] })` — unchanged, so `app/(app)/reports/page.tsx:89` needs no edit.

- [ ] **Step 1: Write the failing test**

Create `src/components/reports/ReportsByPersonTable.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TeamSummaryRow } from '@timetrack/contracts';
import { ReportsByPersonTable } from './ReportsByPersonTable';

const row = (over: Partial<TeamSummaryRow>): TeamSummaryRow =>
  ({ userId: 'u1', name: 'Ada', trackedSeconds: 3600, activityPct: 50, ...over }) as TeamSummaryRow;

describe('ReportsByPersonTable', () => {
  it('sorts by tracked time descending by default', () => {
    const html = renderToStaticMarkup(
      <ReportsByPersonTable
        rows={[
          row({ userId: 'u1', name: 'Low', trackedSeconds: 60 }),
          row({ userId: 'u2', name: 'High', trackedSeconds: 7200 }),
        ]}
      />,
    );
    expect(html.indexOf('High')).toBeLessThan(html.indexOf('Low'));
  });

  it('advertises its three sortable columns', () => {
    const html = renderToStaticMarkup(<ReportsByPersonTable rows={[row({})]} />);
    expect(html.match(/aria-sort/g)).toHaveLength(3);
  });

  it('shows an empty state with no rows', () => {
    expect(renderToStaticMarkup(<ReportsByPersonTable rows={[]} />)).toContain(
      'No tracked time in this range',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- ReportsByPersonTable`
Expected: FAIL — cannot resolve the spec's import target until the component is rewritten, or the `aria-sort` count is wrong (the current table marks three headers but via its own hand-rolled state).

- [ ] **Step 3: Implement**

Rewrite the component onto `DataTable`, keeping `'use client'`, the `Card` wrapper, the `Avatar` cell and the `BarMeter`/`Meter` activity cell exactly as they are. Columns: `name` (sortBy name), `tracked` (align right, sortBy trackedSeconds), `activity` (sortBy activityPct). `initialSort={{ key: 'tracked', dir: 'desc' }}`. Keep the existing `useRouter()` row navigation by passing `onRowClick={(r) => router.push(`/people/${r.userId}`)}`.

Delete the local `SortKey` / `Sort` types, the `useState`, `handleSort` and `dirFor` helpers — `DataTable` owns all of that now.

- [ ] **Step 4: Retire the now-unused sort helper**

`sortTeamRows` in `src/lib/reports-view.ts:44` was only used by this component. Check: `grep -rn 'sortTeamRows' apps/dashboard/src`. If the only hits are its definition and its own spec, delete the function and its tests from `reports-view.ts` / `reports-view.spec.ts` — `sortRows` supersedes it. If anything else still uses it, leave it alone.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- ReportsByPersonTable reports-view`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/reports/ apps/dashboard/src/lib/reports-view.ts apps/dashboard/src/lib/reports-view.spec.ts
git commit -m "feat(dashboard): move the reports table onto the shared data table"
```

---

### Task 6: Delete the dead TeamSummaryTable

**Files:**

- Delete: `src/components/reports/TeamSummaryTable.tsx`

**Interfaces:** none — nothing imports it.

- [ ] **Step 1: Confirm it is genuinely unreferenced**

Run: `grep -rn 'TeamSummaryTable' apps/dashboard/src apps/dashboard/*.json`
Expected: exactly one hit — its own `export function` on line 5. If anything else appears, **stop** and do not delete; migrate it onto `DataTable` instead, following Task 5.

- [ ] **Step 2: Delete it**

```bash
git rm apps/dashboard/src/components/reports/TeamSummaryTable.tsx
```

- [ ] **Step 3: Verify nothing broke**

Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard test && pnpm --filter @timetrack/dashboard build`
Expected: all green. This also confirms it was the last raw `<table>`: `grep -rn '<table' apps/dashboard/src | grep -v 'ui/Table.tsx'` should return nothing.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(dashboard): drop the unused team summary table"
```

---

### Tasks 7–9: DEFERRABLE — the unused DataTable features

These three build the remaining spec §6.1 features. **No current consumer needs them** (see the flag at the top of this plan). Each is self-contained; skip any or all with no impact on Tasks 1–6 or Phases 5–7. If you skip them, say so in the Phase 4 PR description so the spec/plan gap is on the record.

### Task 7 (DEFERRABLE): Pagination

**Files:**

- Modify: `src/components/ui/DataTable.tsx`, `src/components/ui/DataTable.spec.tsx`

**Interfaces:**

- Consumes: `paginate`, `pageCount` (Task 1 — already built and tested).
- Produces: `DataTable` gains `pageSize?: number`. Absent = no pagination, current behaviour.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ui/DataTable.spec.tsx`:

```tsx
describe('DataTable pagination', () => {
  const many: Row[] = Array.from({ length: 5 }, (_, i) => ({
    id: `r${i}`,
    name: `P${i}`,
    n: i,
  }));

  it('renders only the first page when a page size is set', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={many} rowKey={(r) => r.id} pageSize={2} />,
    );
    expect(html).toContain('P0');
    expect(html).toContain('P1');
    expect(html).not.toContain('P2');
  });

  it('reports the page count', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={many} rowKey={(r) => r.id} pageSize={2} />,
    );
    expect(html).toContain('1 of 3');
  });

  it('renders no pager when every row fits on one page', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={many} rowKey={(r) => r.id} pageSize={50} />,
    );
    expect(html).not.toContain(' of ');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- DataTable`
Expected: FAIL — `pageSize` is not a prop; all five rows render.

- [ ] **Step 3: Implement**

Add `pageSize?: number` to the props. Add `const [page, setPage] = useState(1)`, derive `const visible = pageSize ? paginate(sorted, page, pageSize) : sorted`, render `visible` in the body, and reset `page` to 1 whenever `sort` changes (a sort that leaves you on page 3 of a reordered list is disorienting). Below the table, when `pageCount(sorted.length, pageSize) > 1`, render Prev/Next buttons using `buttonClasses('secondary', 'sm')` and the label `{page} of {pageCount(sorted.length, pageSize)}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- DataTable`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/ui/DataTable.tsx apps/dashboard/src/components/ui/DataTable.spec.tsx
git commit -m "feat(dashboard): add optional paging to the data table"
```

### Task 8 (DEFERRABLE): Row selection

**Files:**

- Modify: `src/components/ui/DataTable.tsx`, `src/components/ui/DataTable.spec.tsx`
- Modify: `src/lib/data-table.ts`, `src/lib/data-table.spec.ts`

**Interfaces:**

- Produces: `toggleKey(keys: readonly string[], key: string): string[]`, `togglePage(keys: readonly string[], pageKeys: readonly string[], select: boolean): string[]` in `lib/data-table.ts`; `DataTable` gains `selectedKeys?: string[]` + `onSelectionChange?: (keys: string[]) => void` (supply both or neither).

- [ ] **Step 1: Write the failing logic test**

Append to `src/lib/data-table.spec.ts`:

```ts
import { toggleKey, togglePage } from './data-table';

describe('toggleKey', () => {
  it('adds a missing key', () => {
    expect(toggleKey(['a'], 'b')).toEqual(['a', 'b']);
  });
  it('removes a present key', () => {
    expect(toggleKey(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('does not mutate the input', () => {
    const keys = ['a'];
    toggleKey(keys, 'b');
    expect(keys).toEqual(['a']);
  });
});

describe('togglePage', () => {
  /** Selection outlives the visible page — selecting page 2 must not clear page 1. */
  it('adds the page without dropping off-page selections', () => {
    expect(togglePage(['x'], ['a', 'b'], true).sort()).toEqual(['a', 'b', 'x']);
  });
  it('removes only the page', () => {
    expect(togglePage(['x', 'a', 'b'], ['a', 'b'], false)).toEqual(['x']);
  });
  it('does not duplicate already-selected rows', () => {
    expect(togglePage(['a'], ['a', 'b'], true).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- data-table`
Expected: FAIL — `toggleKey` is not exported.

- [ ] **Step 3: Implement the helpers**

Add to `src/lib/data-table.ts`:

```ts
/** Add or remove one key. Selection is held by the caller, because it outlives the table's
 *  visible page — a page's totals and exports have to survive paging. */
export function toggleKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}

/** Select or clear a whole page without touching selections from other pages. */
export function togglePage(
  keys: readonly string[],
  pageKeys: readonly string[],
  select: boolean,
): string[] {
  if (!select) return keys.filter((k) => !pageKeys.includes(k));
  return [...keys, ...pageKeys.filter((k) => !keys.includes(k))];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- data-table`
Expected: PASS.

- [ ] **Step 5: Add the checkbox column**

In `DataTable`, when both `selectedKeys` and `onSelectionChange` are supplied, inject a leading checkbox column (frozen with the other frozen columns). Header carries a tri-state box covering the visible page via `togglePage`; each row's box calls `toggleKey`. A checkbox click must call `stopPropagation()` so selecting never triggers `onRowClick` — selecting and opening are separate gestures. Add a spec asserting the column appears only when both props are given, and that the row count of `input[type=checkbox]` matches the rows.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @timetrack/dashboard test -- DataTable data-table`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/lib/data-table.ts apps/dashboard/src/lib/data-table.spec.ts apps/dashboard/src/components/ui/DataTable.tsx apps/dashboard/src/components/ui/DataTable.spec.tsx
git commit -m "feat(dashboard): add optional row selection to the data table"
```

### Task 9 (DEFERRABLE): Column visibility and expandable rows

**Files:**

- Modify: `src/components/ui/DataTable.tsx`, `src/components/ui/DataTable.spec.tsx`

**Interfaces:**

- Produces: `DataTable` gains `hideable?: boolean` (renders a columns menu) and `renderExpanded?: (row: T) => ReactNode`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ui/DataTable.spec.tsx`:

```tsx
describe('DataTable column visibility', () => {
  it('renders no columns menu by default', () => {
    expect(render()).not.toContain('Columns');
  });

  it('renders a columns menu when hideable', () => {
    expect(render({ hideable: true })).toContain('Columns');
  });
});

describe('DataTable expandable rows', () => {
  it('renders no expander by default', () => {
    expect(render()).not.toContain('aria-expanded');
  });

  it('renders an expander per row when given a panel renderer', () => {
    const html = render({ renderExpanded: (r: Row) => <div>detail {r.name}</div> });
    expect(html.match(/aria-expanded/g)).toHaveLength(2);
  });

  /**
   * A row that both expands and navigates has no unambiguous click, so expansion wins and
   * onRowClick is ignored. Row-level actions belong inside the expanded panel.
   */
  it('ignores onRowClick when rows expand', () => {
    const html = render({
      renderExpanded: () => <div>d</div>,
      onRowClick: () => {},
    });
    expect(html).not.toContain('cursor-pointer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- DataTable`
Expected: FAIL — neither prop exists.

- [ ] **Step 3: Implement**

Add `hideable?: boolean` with local `hidden: string[]` state and a disclosure listing each column's header with a checkbox; filter `columns` by it before rendering. Add `renderExpanded?: (row: T) => ReactNode` with local `expanded: string[]` state, a chevron button carrying `aria-expanded` in the first cell, and the panel in its own full-width `<tr>` beneath its parent. When `renderExpanded` is set, do not apply `onRowClick` or `interactive`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- DataTable`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/ui/DataTable.tsx apps/dashboard/src/components/ui/DataTable.spec.tsx
git commit -m "feat(dashboard): add column hiding and row expansion to the table"
```

---

# Phase 5 — Loading, empty and error states (`feat(dashboard): add skeleton, empty and error states`)

### Task 10: Skeletons

**Files:**

- Create: `src/components/ui/Skeleton.tsx`, `src/components/ui/Skeleton.spec.tsx`

**Interfaces:**

- Produces: `Skeleton({ width?, height?, className? })`, `TableSkeleton({ rows?, columns? })`, `PageSkeleton()`. Task 11 renders these from `loading.tsx` files.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Skeleton.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Skeleton, TableSkeleton, PageSkeleton } from './Skeleton';

describe('Skeleton', () => {
  it('honours an explicit size', () => {
    const html = renderToStaticMarkup(<Skeleton width={80} height={12} />);
    expect(html).toContain('width:80px');
    expect(html).toContain('height:12px');
  });

  /** Placeholders are chrome, not content: a screen reader announcing a dozen blank boxes
   *  is worse than silence. */
  it('is hidden from assistive tech', () => {
    expect(renderToStaticMarkup(<Skeleton />)).toContain('aria-hidden="true"');
  });
});

describe('TableSkeleton', () => {
  it('renders the requested shape', () => {
    const html = renderToStaticMarkup(<TableSkeleton rows={3} columns={2} />);
    expect(html.match(/<tr/g)).toHaveLength(3);
    expect(html.match(/<td/g)).toHaveLength(6);
  });

  it('defaults to a usable shape', () => {
    expect(renderToStaticMarkup(<TableSkeleton />)).toContain('<tr');
  });
});

describe('PageSkeleton', () => {
  it('sketches a heading and a card', () => {
    expect(renderToStaticMarkup(<PageSkeleton />)).toContain('aria-hidden="true"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- Skeleton`
Expected: FAIL — cannot resolve `./Skeleton`.

- [ ] **Step 3: Implement**

Create `src/components/ui/Skeleton.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { Card } from './Card';

/**
 * Placeholder blocks shown while a route resolves.
 *
 * The shimmer reuses the existing `tt-pulse` class rather than adding a second keyframe — the
 * global prefers-reduced-motion block in globals.css already freezes it, so a motion-sensitive
 * viewer gets a static grey block instead of a throbbing one.
 *
 * All three are aria-hidden: a screen reader announcing a dozen blank boxes is worse than
 * silence, and the route's own heading is what says the page is coming.
 */
export function Skeleton({
  width,
  height = 12,
  className = '',
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  const style: CSSProperties = { height, ...(width !== undefined ? { width } : {}) };
  return (
    <span
      aria-hidden="true"
      className={`bg-muted-bg tt-pulse block rounded-sm ${width === undefined ? 'w-full' : ''} ${className}`.trim()}
      style={style}
    />
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <table aria-hidden="true" className="w-full border-collapse">
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r} className="border-separator border-t">
            {Array.from({ length: columns }, (_, c) => (
              <td key={c} className="px-[26px] py-[var(--pad-y)]">
                {/* The first column is the wide one in every table here (a person or a
                    project name), so the sketch matches the shape that will replace it. */}
                <Skeleton width={c === 0 ? 160 : 72} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The route-level fallback: a heading-sized bar over a card holding a table sketch. This is
 *  what makes TableSkeleton a consumed export rather than dead code. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-[22px]">
      <Skeleton width={220} height={26} />
      <Card padding="none" className="overflow-hidden">
        <TableSkeleton />
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- Skeleton`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/ui/Skeleton.tsx apps/dashboard/src/components/ui/Skeleton.spec.tsx
git commit -m "feat(dashboard): add skeleton placeholders"
```

---

### Task 11: Route-level loading states

**Files:**

- Create: `src/app/(app)/overview/loading.tsx`, `.../reports/loading.tsx`, `.../projects/loading.tsx`, `.../approvals/loading.tsx`, `.../me/loading.tsx`, `.../admin/audit/loading.tsx`, `.../admin/users/loading.tsx`, `.../admin/teams/loading.tsx`, `.../admin/settings/loading.tsx`, `.../people/[userId]/loading.tsx`, `.../projects/[projectId]/loading.tsx`

**Interfaces:**

- Consumes: `PageSkeleton` (Task 10).
- Produces: nothing importable. These are Next route conventions — **Server Components, no `'use client'`**.

- [ ] **Step 1: Create one loading file per segment**

Each is identical:

```tsx
import { PageSkeleton } from '../../../components/ui/PageSkeleton-path-adjusted';

export default function Loading() {
  return <PageSkeleton />;
}
```

Adjust the relative import depth per segment (`src/app/(app)/overview/` is three levels below `src/`; `src/app/(app)/admin/audit/` is four). Import from `components/ui/Skeleton`.

- [ ] **Step 2: Verify the depth of every import compiles**

Run: `pnpm --filter @timetrack/dashboard typecheck`
Expected: PASS. A wrong `../` count is the only likely error here.

- [ ] **Step 3: See one actually render**

Run `pnpm --filter @timetrack/dashboard dev`, open `/overview`, and hard-reload. The skeleton should flash before content. If it never appears the page is resolving too fast to see — confirm instead by throttling the network in devtools to "Slow 3G".

- [ ] **Step 4: Commit**

```bash
git add 'apps/dashboard/src/app/(app)'
git commit -m "feat(dashboard): show a skeleton while a page loads"
```

---

### Task 12: Route-level error states

**Files:**

- Create: `src/app/(app)/error.tsx` and, for the segments that fetch independently, `.../overview/error.tsx`, `.../reports/error.tsx`, `.../projects/error.tsx`, `.../approvals/error.tsx`, `.../me/error.tsx`, `.../admin/error.tsx`

**Interfaces:**

- Produces: nothing importable. Next requires `error.tsx` to be a **Client Component** — this is the one `'use client'` allowed under `src/app/` in this plan, because the convention mandates it.

- [ ] **Step 1: Understand what reaches these**

`src/lib/api-client.ts:101` throws `ApiError extends Error` carrying `status` and the problem+json `title` as its `message`. Pages catch 401 (redirect) and some catch 403 (`Forbidden`); **everything else propagates** and currently lands on Next's default error page. That is what these files replace.

- [ ] **Step 2: Create the shared error boundary**

Create `src/app/(app)/error.tsx`:

```tsx
'use client';

/**
 * Segment error boundary. Next requires this to be a Client Component.
 *
 * `error.message` is the problem+json `title` our api-client puts there (lib/api-client.ts) —
 * a short, already-safe sentence like "Cannot deactivate the last active admin". It is NOT a
 * stack trace or Prisma text: the API's RFC 9457 filter strips those before they leave the
 * server. We still render only the message, never `error.stack` or `error.digest`.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="text-h2 font-bold">Something went wrong</span>
      <p className="text-text-secondary text-label max-w-[46ch]">
        {error.message || 'The page could not be loaded.'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="bg-accent hover:bg-accent-hover btn-3d text-label mt-2 rounded-md px-[17px] py-2 font-semibold text-white [--b-edge:var(--tt-accent-edge)] [--b-glow:var(--tt-glow)] [--b-glow-strong:var(--tt-glow-strong)]"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add the per-segment copies**

Copy the same file into each segment listed above so one failing panel does not blank the whole shell. They are identical — the boundary's position is the point, not its content.

- [ ] **Step 4: Verify one triggers**

Temporarily add `throw new Error('boom')` at the top of `src/app/(app)/reports/page.tsx`, run dev, load `/reports`, and confirm the boundary renders "boom" with a working "Try again" — while the sidebar and top bar stay intact. **Remove the throw.**

- [ ] **Step 5: Confirm no stack trace is exposed**

With the throw still in place, confirm the rendered page contains no file paths or stack frames. Then remove the throw and re-run `pnpm --filter @timetrack/dashboard build`.

- [ ] **Step 6: Commit**

```bash
git add 'apps/dashboard/src/app/(app)'
git commit -m "feat(dashboard): surface load failures in a segment boundary"
```

---

### Task 13: Audit page — empty state and row hover

**Files:**

- Modify: `src/app/(app)/admin/audit/page.tsx:120-135`

**Interfaces:**

- Consumes: `EmptyState` (Task 2), `.row-3d` (predecessor plan).
- Produces: nothing. The page stays a Server Component and keeps the compound `Table` — see deviation 1.

- [ ] **Step 1: Replace the three bare paragraphs**

The page renders three `<p className="text-text-secondary text-body">` branches: forbidden, load-failed, and no-entries. Replace the **no-entries** branch with:

```tsx
<Card padding="none">
  <EmptyState
    title="No audit entries in this filter"
    body="Widen the date range or clear the target filters to see more."
  />
</Card>
```

Leave the **forbidden** branch as it is (it is an authorization message, not an empty state) and leave the **load-failed** branch alone: the page deliberately swallows its error into `page = null` rather than throwing, so Task 12's boundary never sees it. Converting that to a throw would change the page's behaviour and is out of scope.

- [ ] **Step 2: Add the row hover**

Add `className="row-3d"` to the `<Tr>` inside the audit rows map.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @timetrack/dashboard typecheck && pnpm --filter @timetrack/dashboard test`
Then load `/admin/audit` in dev with a filter that matches nothing, and confirm the empty panel renders inside a card. Hover a row and confirm it lifts.

- [ ] **Step 4: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

- [ ] **Step 5: Commit**

```bash
git add 'apps/dashboard/src/app/(app)/admin/audit/page.tsx'
git commit -m "feat(dashboard): give the audit log an empty state and row hover"
```

---

# Phase 6 — Drawers, toasts, density (`feat(dashboard): add detail drawers, toasts and a density toggle`)

### Task 14: Drawer

**Files:**

- Create: `src/components/ui/Drawer.tsx`, `src/components/ui/Drawer.spec.tsx`

**Interfaces:**

- Produces: `Drawer({ open, onClose, title, children, footer? })` — a **presentational** off-canvas panel. Task 17 reuses it for the intercepting routes.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Drawer.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Drawer } from './Drawer';

const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <Drawer open onClose={() => {}} title="Details" {...over}>
      body
    </Drawer>,
  );

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    expect(
      renderToStaticMarkup(
        <Drawer open={false} onClose={() => {}} title="t">
          body
        </Drawer>,
      ),
    ).toBe('');
  });

  it('renders its title and body when open', () => {
    const html = render();
    expect(html).toContain('Details');
    expect(html).toContain('body');
  });

  /** It is a modal surface: without these the panel is announced as ordinary page content
   *  and a screen-reader user has no idea a layer opened over the page. */
  it('is announced as a labelled dialog', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-label(ledby)?=/);
  });

  it('renders a footer when given', () => {
    expect(render({ footer: <span>foot</span> })).toContain('foot');
  });

  it('renders a close control', () => {
    expect(render()).toMatch(/aria-label="Close/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- Drawer`
Expected: FAIL — cannot resolve `./Drawer`.

- [ ] **Step 3: Implement**

First add the close glyph to `src/components/ui/icons.tsx`, matching the file's existing
arrow-function style (it has 14 icons and no close mark):

```tsx
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    {...p}
  >
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
```

Then create `src/components/ui/Drawer.tsx`:

```tsx
'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { IconClose } from './icons';

/**
 * Off-canvas detail panel.
 *
 * Presentational: `open` and `onClose` belong to the caller, so one component serves both a
 * page-local drawer over already-loaded data and an intercepted route, where "open" means
 * "this URL is showing". Note that `onClose` is a function — a Server Component therefore
 * cannot render this directly; see RouteDrawer (Phase 7).
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();

  // Escape closes. Bound on the window so it fires wherever focus happens to sit.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock the page behind the panel. This restores the PREVIOUS value rather than clearing the
  // property, so opening a drawer over something else that locked scrolling does not unlock
  // the page early when this one closes.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} aria-hidden="true" className="fixed inset-0 z-[80] bg-black/30" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-surface-raised shadow-e2 fixed inset-y-0 right-0 z-[90] flex w-full max-w-[520px] flex-col rounded-l-lg"
      >
        <div className="border-separator flex items-center gap-3 border-b px-[26px] py-[18px]">
          <span id={titleId} className="text-h3 font-bold">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="text-text-secondary hover:text-text ml-auto grid h-8 w-8 flex-none place-items-center rounded-md"
          >
            <IconClose width={16} height={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-[26px] py-5">{children}</div>
        {footer ? <div className="border-separator border-t px-[26px] py-4">{footer}</div> : null}
      </aside>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- Drawer`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/ui/Drawer.tsx apps/dashboard/src/components/ui/Drawer.spec.tsx
git commit -m "feat(dashboard): add an off-canvas detail drawer"
```

---

### Task 15: Toasts

**Files:**

- Create: `src/components/ui/Toast.tsx`, `src/components/ui/Toast.spec.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**

- Produces: `ToastProvider({ children })`, `useToast(): (message: string, tone?: 'good' | 'destructive') => void`, and an internal `ToastList`.
- **Server Actions cannot call `useToast`.** The convention, which `ConfirmDialog` already follows: the action returns a result, and the client form component raises the toast. Document this in the file header.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/Toast.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastProvider } from './Toast';

describe('ToastProvider', () => {
  it('renders its children', () => {
    expect(
      renderToStaticMarkup(
        <ToastProvider>
          <span>app</span>
        </ToastProvider>,
      ),
    ).toContain('app');
  });

  /** Nothing has fired yet, so the region must be empty — but it must still EXIST, because
   *  a live region added to the DOM at the same moment as its first message is not reliably
   *  announced. */
  it('renders an empty live region up front', () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <span>app</span>
      </ToastProvider>,
    );
    expect(html).toContain('aria-live="polite"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- Toast`
Expected: FAIL — cannot resolve `./Toast`.

- [ ] **Step 3: Implement**

Create `src/components/ui/Toast.tsx`:

```tsx
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'good' | 'destructive';
type Toast = { id: string; message: string; tone: ToastTone };

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

const LIFETIME_MS = 4000;

/**
 * Action feedback.
 *
 * A Server Action cannot call useToast — hooks do not exist on the server. The convention is
 * the one ConfirmDialog already follows: the action returns a result, and the client form
 * component that awaited it raises the toast.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Tracked so unmounting mid-flight cannot setState on a dead component.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const push = useCallback((message: string, tone: ToastTone = 'good') => {
    const id = crypto.randomUUID();
    setToasts((cur) => [...cur, { id, message, tone }]);
    timers.current.push(
      setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), LIFETIME_MS),
    );
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* The region is in the DOM even when empty: a live region inserted at the same moment
          as its first message is not reliably announced. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`bg-surface-raised border-separator shadow-e2 text-label rounded-md border px-4 py-2.5 font-semibold ${
              t.tone === 'destructive' ? 'text-destructive' : 'text-good'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside <ToastProvider>');
  return push;
}
```

- [ ] **Step 4: Mount it**

In `src/app/(app)/layout.tsx`, wrap the `<AppShell>` subtree in `<ToastProvider>`. `AppShell` is already `'use client'`, and `ToastProvider` is a client component receiving `children` from a Server Component — which is allowed, because `children` is an already-rendered React node, not a function.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- Toast && pnpm --filter @timetrack/dashboard build`
Expected: PASS and a clean build. The build is the real check that no RSC boundary was violated.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/ui/Toast.tsx apps/dashboard/src/components/ui/Toast.spec.tsx 'apps/dashboard/src/app/(app)/layout.tsx'
git commit -m "feat(dashboard): add toast notifications"
```

---

### Task 16: Density toggle

**Files:**

- Create: `src/components/ui/DensityToggle.tsx`
- Create: `src/lib/density.ts`, `src/lib/density.spec.ts`
- Modify: `src/app/layout.tsx:29` (the pre-paint script)
- Modify: `src/components/ui/TopBar.tsx`

**Interfaces:**

- Consumes: `--row-h` / `--pad-y` and the `[data-density]` blocks (predecessor plan Task 3).
- Produces: `type Density = 'compact' | 'comfortable'`, `normalizeDensity(value: string | null): Density`, `nextDensity(current: Density): Density` in `lib/density.ts`; `DensityToggle()` component.

- [ ] **Step 1: Write the failing test**

Create `src/lib/density.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeDensity, nextDensity } from './density';

describe('normalizeDensity', () => {
  it('passes through the two valid values', () => {
    expect(normalizeDensity('compact')).toBe('compact');
    expect(normalizeDensity('comfortable')).toBe('comfortable');
  });

  /**
   * localStorage is absent in private windows and holds whatever a previous version wrote,
   * so an unreadable value must fall back rather than setting data-density to garbage —
   * which would match neither CSS block and collapse every table to zero padding.
   */
  it('falls back to comfortable for anything else', () => {
    expect(normalizeDensity(null)).toBe('comfortable');
    expect(normalizeDensity('')).toBe('comfortable');
    expect(normalizeDensity('cosy')).toBe('comfortable');
  });
});

describe('nextDensity', () => {
  it('flips between the two', () => {
    expect(nextDensity('comfortable')).toBe('compact');
    expect(nextDensity('compact')).toBe('comfortable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @timetrack/dashboard test -- density`
Expected: FAIL — cannot resolve `./density`.

- [ ] **Step 3: Implement the logic**

Create `src/lib/density.ts`:

```ts
/** Row-height preference. Persisted in localStorage['tt-density'] and applied as the
 *  [data-density] attribute on <html>, which globals.css keys --row-h / --pad-y off. */
export type Density = 'compact' | 'comfortable';

const VALID: readonly Density[] = ['compact', 'comfortable'];

/**
 * Coerce a stored value to a usable density. localStorage is absent in private windows and
 * may hold whatever an older version wrote, so anything unrecognised falls back — writing a
 * bogus value into data-density would match neither CSS block and collapse table padding.
 */
export function normalizeDensity(value: string | null): Density {
  return VALID.includes(value as Density) ? (value as Density) : 'comfortable';
}

export function nextDensity(current: Density): Density {
  return current === 'compact' ? 'comfortable' : 'compact';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @timetrack/dashboard test -- density`
Expected: PASS, 4 tests.

- [ ] **Step 5: Seed the attribute before first paint**

In `src/app/layout.tsx`, extend the existing `THEME_INIT` script — do **not** add a second script. It currently reads `localStorage['tt-theme']` and adds `.dark`. Add, inside the same `try`:

```js
var d = localStorage.getItem('tt-density');
document.documentElement.setAttribute('data-density', d === 'compact' ? 'compact' : 'comfortable');
```

Update the comment above `THEME_INIT` to say it seeds both theme and density.

- [ ] **Step 6: Add the toggle**

First add the glyph to `src/components/ui/icons.tsx` (no rows icon exists yet):

```tsx
export const IconRows = (p: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    {...p}
  >
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </svg>
);
```

Then create `src/components/ui/DensityToggle.tsx`, mirroring `ThemeToggle.tsx:1`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { IconRows } from './icons';
import { normalizeDensity, nextDensity, type Density } from '../../lib/density';

/**
 * Compact/comfortable row heights. The root-layout inline script already set data-density
 * before paint; this syncs to that on mount, then flips the attribute and persists the choice
 * — the same shape as ThemeToggle, deliberately.
 */
export function DensityToggle() {
  const [density, setDensity] = useState<Density>('comfortable');

  useEffect(() => {
    setDensity(normalizeDensity(document.documentElement.getAttribute('data-density')));
  }, []);

  function toggle() {
    const next = nextDensity(density);
    setDensity(next);
    document.documentElement.setAttribute('data-density', next);
    try {
      localStorage.setItem('tt-density', next);
    } catch {
      /* private mode — the attribute still applies for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={density === 'compact' ? 'Switch to comfortable rows' : 'Switch to compact rows'}
      className="border-separator bg-surface-raised text-text-secondary hover:text-text shadow-e1 mb-1 grid h-9 w-9 flex-none place-items-center rounded-full border transition-colors"
    >
      <IconRows width={16} height={16} />
    </button>
  );
}
```

Mount it in `src/components/ui/TopBar.tsx` beside `ThemeToggle`.

- [ ] **Step 7: Verify it actually retunes the tables**

Run dev, load `/admin/users`, toggle density, and confirm row heights change and the choice survives a reload. Confirm `<html>` carries `data-density` on first paint with no flash.

- [ ] **Step 8: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/lib/density.ts apps/dashboard/src/lib/density.spec.ts apps/dashboard/src/components/ui/DensityToggle.tsx apps/dashboard/src/components/ui/TopBar.tsx apps/dashboard/src/components/ui/icons.tsx apps/dashboard/src/app/layout.tsx
git commit -m "feat(dashboard): add a row density toggle"
```

---

# Phase 7 — Detail drawers via intercepting routes (`feat(dashboard): open person and project detail in a drawer`)

⚠️ **The riskiest phase.** Nothing in this codebase uses parallel or intercepting routes today. Ship it alone, after Phase 6 is merged.

### Task 17: The `@drawer` slot and the person drawer

**Files:**

- Create: `src/components/ui/RouteDrawer.tsx`, `src/app/(app)/@drawer/default.tsx`, `src/app/(app)/@drawer/(.)people/[userId]/page.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**

- Consumes: `Drawer` (Task 14).
- Produces: a `drawer` slot prop on the `(app)` layout.

- [ ] **Step 1: Add the slot to the layout**

`src/app/(app)/layout.tsx` currently takes `{ children }`. Add a sibling slot:

```tsx
export default async function AppLayout({
  children,
  drawer,
}: {
  children: ReactNode;
  drawer: ReactNode;
}) {
```

and render `{drawer}` after `{children}` inside `<AppShell>`. Everything else in the layout — the session gate, the 401 redirect, `TrackingFooter` — stays exactly as it is.

- [ ] **Step 2: Add the empty default**

Create `src/app/(app)/@drawer/default.tsx`:

```tsx
/**
 * The drawer slot's resting state. Next requires a default.tsx for every parallel slot: on a
 * hard navigation it has no matching route for the slot and renders this instead of erroring.
 */
export default function Default() {
  return null;
}
```

- [ ] **Step 3: Add the intercepted person route**

**`Drawer` cannot be rendered by this page directly.** `Drawer` takes `onClose`, which is a
function, and this page is a Server Component — passing it across the RSC boundary is exactly
the violation this plan's Global Constraints forbid. So first create the client wrapper that
owns the close behaviour, `src/components/ui/RouteDrawer.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Drawer } from './Drawer';

/**
 * The Drawer for an intercepted route. "Open" means this URL is showing, and closing means
 * going back — so `open` is hard-coded true and `onClose` is router.back().
 *
 * This exists because a Server Component cannot pass Drawer's `onClose` across the RSC
 * boundary. It takes only `title` and `children`; children are already-rendered nodes, which
 * DO cross, so the intercepted page stays server-rendered and its fetch keeps the token on
 * the server.
 */
export function RouteDrawer({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Drawer open onClose={() => router.back()} title={title}>
      {children}
    </Drawer>
  );
}
```

Then create `src/app/(app)/@drawer/(.)people/[userId]/page.tsx`. **Before writing it, read
`src/app/(app)/people/[userId]/page.tsx` in full** — this page must fetch and render exactly
what the full page does, so that the drawer and the full page never disagree. Copy its session
gate, its `api` call and its panel composition verbatim; the only differences are the wrapper
and that it has no page title:

```tsx
import { redirect } from 'next/navigation';
import { getSession } from '../../../../../lib/session';
import { refreshBackTo } from '../../../../../lib/redirect';
import { RouteDrawer } from '../../../../../components/ui/RouteDrawer';

/**
 * The person day view, intercepted so a click from Overview opens it over the page instead of
 * navigating away. A hard load of the same URL is NOT intercepted and renders the full page at
 * app/(app)/people/[userId]/page.tsx — that is what keeps the link shareable.
 *
 * Server Component: the fetch is identical to the full page's, so no token reaches the browser.
 */
export default async function InterceptedPersonPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await getSession();
  // Same reasoning as every other page: the (app) layout's redirect does not re-run on a
  // client-side navigation, so this gates on its own.
  if (!session) redirect(refreshBackTo('/overview'));

  const { userId } = await params;

  // Mirror the full page's fetch and view-model call here, exactly as it does them.
  // Then render the same panels inside the wrapper:
  return (
    <RouteDrawer title={/* the person's name from the fetched view */ ''}>
      {/* the same panels the full page renders */}
    </RouteDrawer>
  );
}
```

The two comment placeholders are the only parts that depend on the full page's current shape —
fill them from what you read in Step 3's first instruction. Do not invent an API method name.

- [ ] **Step 4: Verify the soft-navigation path**

Run dev, go to `/overview`, click a person. Expected: the URL becomes `/people/<id>` **and** the content opens in a drawer over the overview. Press Escape or the close button: the URL returns to `/overview`.

- [ ] **Step 5: Verify the hard-navigation path — the regression that matters**

Copy the `/people/<id>` URL and paste it into a fresh tab. Expected: the **full page** renders, not the drawer. This is the behaviour intercepting routes silently break, and Task 19 pins it in an E2E test.

- [ ] **Step 6: Commit**

```bash
git add 'apps/dashboard/src/app/(app)'
git commit -m "feat(dashboard): open person detail in a drawer from overview"
```

### Task 18: The project drawer

**Files:**

- Create: `src/app/(app)/@drawer/(.)projects/[projectId]/page.tsx`

- [ ] **Step 1: Mirror the person drawer**

Create the intercepted project route following Task 17 Step 3 exactly, fetching the project detail view instead. Repeat the code rather than extracting a shared abstraction from two call sites.

- [ ] **Step 2: Verify both paths**

From `/projects`, click a project → drawer, URL changed. Fresh tab on the same URL → full page.

- [ ] **Step 3: Commit**

```bash
git add 'apps/dashboard/src/app/(app)'
git commit -m "feat(dashboard): open project detail in a drawer from the index"
```

### Task 19: Pin the deep-link behaviour in E2E

**Files:**

- Create or modify the Playwright spec covering `/people/[userId]`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

Add a Playwright test on seeded data that navigates **directly** to `/people/<seeded id>` (`page.goto`, not a click) and asserts the full page rendered — a page-level heading is present and no `[role="dialog"]` exists. Then add a second test that starts at `/overview`, clicks the person's row, and asserts a `[role="dialog"]` **is** present and the URL changed.

- [ ] **Step 2: Run it to verify the pair passes**

Run: `pnpm --filter @timetrack/dashboard test:e2e`
Expected: both PASS. If the direct-navigation test finds a dialog, the intercepting route is catching hard navigations — check that `(.)` (same level) is the right convention for the route's depth rather than `(..)`.

- [ ] **Step 3: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/e2e apps/dashboard/tests 2>/dev/null || git add apps/dashboard
git commit -m "test(dashboard): pin person deep links to the full page"
```

---

## Done when

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` is green.
- `grep -rn '<table' apps/dashboard/src | grep -v 'ui/Table.tsx'` returns nothing.
- `grep -rln "'use client'" apps/dashboard/src/app` lists **only** the `error.tsx` files (a Next requirement) — no page.
- Pasting a `/people/<id>` URL into a fresh tab renders the full page, not a drawer.
- No new dependency in `apps/dashboard/package.json`.
- No file outside `apps/dashboard/` has changed.
