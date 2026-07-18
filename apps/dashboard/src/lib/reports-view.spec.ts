import { describe, it, expect } from 'vitest';
import { defaultReportRange, toProjectBars, hasReportData } from './reports-view';

describe('defaultReportRange', () => {
  it('spans the last 7 UTC days inclusive of today', () => {
    const { from, to } = defaultReportRange(new Date('2026-07-19T15:30:00.000Z'));
    expect(from).toBe('2026-07-13T00:00:00.000Z');
    expect(to).toBe('2026-07-19T23:59:59.999Z');
  });
});

describe('toProjectBars', () => {
  it('converts tracked seconds to rounded hours', () => {
    expect(toProjectBars([{ projectId: null, name: 'No project', trackedSeconds: 5400 }])).toEqual([
      { name: 'No project', hours: 1.5 },
    ]);
  });
});

describe('hasReportData', () => {
  it('is false only when both sets are empty', () => {
    expect(hasReportData([], [])).toBe(false);
    expect(hasReportData([{ userId: 'u', name: 'A', trackedSeconds: 1, activityPct: 0 }], [])).toBe(
      true,
    );
  });
});
