import { describe, it, expect } from 'vitest';
import { defaultReportRange, reportRangeBound, toProjectBars, hasReportData } from './reports-view';

describe('defaultReportRange', () => {
  it('spans the last 7 Dhaka days inclusive of today', () => {
    const { from, to } = defaultReportRange(new Date('2026-07-19T15:30:00.000Z'));
    // Dhaka midnight on 2026-07-19 is 2026-07-18T18:00:00.000Z (UTC+6, no DST).
    expect(from).toBe('2026-07-12T18:00:00.000Z');
    expect(to).toBe('2026-07-19T17:59:59.999Z');
  });
});

describe('reportRangeBound', () => {
  it('widens a picked "from" date to Dhaka midnight', () => {
    expect(reportRangeBound('2026-08-20', 'from')).toBe('2026-08-19T18:00:00.000Z');
  });

  it('widens a picked "to" date to 1ms before the next Dhaka midnight', () => {
    expect(reportRangeBound('2026-08-20', 'to')).toBe('2026-08-20T17:59:59.999Z');
  });

  it('returns null for a value that is not a real calendar day, instead of throwing', () => {
    expect(reportRangeBound('', 'from')).toBeNull();
    expect(reportRangeBound('garbage', 'to')).toBeNull();
    expect(reportRangeBound('2026-02-30', 'from')).toBeNull();
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
