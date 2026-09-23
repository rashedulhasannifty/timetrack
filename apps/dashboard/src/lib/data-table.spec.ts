import { describe, it, expect } from 'vitest';
import {
  nextSort,
  sortRows,
  paginate,
  pageCount,
  clampPage,
  stickyOffsets,
  toggleKey,
  togglePage,
} from './data-table';

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

describe('clampPage', () => {
  /**
   * DataTable's own `page` state can only move by one via Prev/Next, but `pages` can shrink
   * out from under it the instant a sort or filter drops rows — this is what stops the pager
   * label and Prev/Next disabled states from reading "3 of 2" in that moment.
   */
  it('pulls a page number back onto a shrunken page count', () => {
    expect(clampPage(3, 2)).toBe(2);
  });

  it('leaves an in-range page number unchanged', () => {
    expect(clampPage(2, 5)).toBe(2);
  });

  it('clamps below one', () => {
    expect(clampPage(0, 5)).toBe(1);
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
