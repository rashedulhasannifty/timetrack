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
