import { describe, it, expect } from 'vitest';
import { monthPartition, nextMonthStart } from './partition.util.js';

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
});
