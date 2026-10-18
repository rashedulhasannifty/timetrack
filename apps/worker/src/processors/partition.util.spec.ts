import { describe, it, expect } from 'vitest';
import {
  monthPartition,
  monthStartsAhead,
  nextMonthStart,
  PROVISION_MONTHS_AHEAD,
} from './partition.util.js';

describe('partition util', () => {
  it('computes the suffix and half-open range for a month', () => {
    const p = monthPartition(new Date(Date.UTC(2026, 6, 1)));
    expect(p).toEqual({ suffix: '2026_07', from: '2026-07-01', to: '2026-08-01' });
  });

  it('rolls December over to the next January', () => {
    const start = nextMonthStart(new Date(Date.UTC(2026, 11, 15)));
    expect(monthPartition(start)).toEqual({
      suffix: '2027_01',
      from: '2027-01-01',
      to: '2027-02-01',
    });
  });

  it('provisions at least three months ahead', () => {
    expect(PROVISION_MONTHS_AHEAD).toBeGreaterThanOrEqual(3);
  });

  it('lists the current month plus N months ahead, across a year boundary', () => {
    const months = monthStartsAhead(new Date(Date.UTC(2026, 10, 18, 3, 20)), 3);
    expect(months.map((m) => monthPartition(m).suffix)).toEqual([
      '2026_11',
      '2026_12',
      '2027_01',
      '2027_02',
    ]);
  });
});
