import { describe, expect, it } from 'vitest';
import {
  retentionCutoff,
  partitionBounds,
  isDroppable,
  chunk,
  PARTITION_NAME_RE,
} from './retention.util.js';

describe('retention util', () => {
  it('subtracts N days from now (UTC)', () => {
    const now = new Date('2026-07-20T03:20:00.000Z');
    expect(retentionCutoff(now, 30).toISOString()).toBe('2026-06-20T03:20:00.000Z');
  });

  it('derives half-open month bounds from a partition name (incl. underscored table)', () => {
    expect(partitionBounds('screenshots_2026_07')).toEqual({
      from: new Date(Date.UTC(2026, 6, 1)),
      to: new Date(Date.UTC(2026, 7, 1)),
    });
    expect(partitionBounds('activity_samples_2025_12')).toEqual({
      from: new Date(Date.UTC(2025, 11, 1)),
      to: new Date(Date.UTC(2026, 0, 1)),
    });
  });

  it('is droppable only when the whole range is at/under cutoffMax', () => {
    const b = partitionBounds('screenshots_2026_06'); // to = 2026-07-01
    expect(isDroppable(b, new Date('2026-07-01T00:00:00.000Z'))).toBe(true);
    expect(isDroppable(b, new Date('2026-06-30T23:59:59.000Z'))).toBe(false);
  });

  it('chunks an array into <=size groups', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 1000)).toEqual([]);
  });

  it('matches only conforming partition names', () => {
    expect(PARTITION_NAME_RE.test('screenshots_2026_07')).toBe(true);
    expect(PARTITION_NAME_RE.test('activity_samples_2026_07')).toBe(true);
    expect(PARTITION_NAME_RE.test('screenshots')).toBe(false);
    expect(PARTITION_NAME_RE.test('screenshots_default')).toBe(false);
    expect(PARTITION_NAME_RE.test('users; DROP TABLE x')).toBe(false);
  });
});
