import { describe, it, expect } from 'vitest';
import {
  defaultReportRange,
  reportRangeBound,
  toProjectBars,
  hasReportData,
  sortTeamRows,
} from './reports-view';
import type { TeamSummaryRow } from '@timetrack/contracts';

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

describe('sortTeamRows', () => {
  const rows: TeamSummaryRow[] = [
    { userId: '1', name: 'Charlie', trackedSeconds: 300, activityPct: 50 },
    { userId: '2', name: 'Alice', trackedSeconds: 100, activityPct: 90 },
    { userId: '3', name: 'Bob', trackedSeconds: 200, activityPct: 10 },
  ];

  it('sorts by name asc', () => {
    expect(sortTeamRows(rows, 'name', 'asc').map((r) => r.name)).toEqual([
      'Alice',
      'Bob',
      'Charlie',
    ]);
  });

  it('sorts by name desc', () => {
    expect(sortTeamRows(rows, 'name', 'desc').map((r) => r.name)).toEqual([
      'Charlie',
      'Bob',
      'Alice',
    ]);
  });

  it('sorts by trackedSeconds asc', () => {
    expect(sortTeamRows(rows, 'trackedSeconds', 'asc').map((r) => r.trackedSeconds)).toEqual([
      100, 200, 300,
    ]);
  });

  it('sorts by trackedSeconds desc', () => {
    expect(sortTeamRows(rows, 'trackedSeconds', 'desc').map((r) => r.trackedSeconds)).toEqual([
      300, 200, 100,
    ]);
  });

  it('sorts by activityPct asc', () => {
    expect(sortTeamRows(rows, 'activityPct', 'asc').map((r) => r.activityPct)).toEqual([
      10, 50, 90,
    ]);
  });

  it('sorts by activityPct desc', () => {
    expect(sortTeamRows(rows, 'activityPct', 'desc').map((r) => r.activityPct)).toEqual([
      90, 50, 10,
    ]);
  });

  it('preserves original relative order for ties (stability)', () => {
    const tied: TeamSummaryRow[] = [
      { userId: '1', name: 'Same', trackedSeconds: 100, activityPct: 50 },
      { userId: '2', name: 'Same', trackedSeconds: 100, activityPct: 50 },
      { userId: '3', name: 'Same', trackedSeconds: 100, activityPct: 50 },
    ];
    expect(sortTeamRows(tied, 'trackedSeconds', 'asc').map((r) => r.userId)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('does not mutate the input array', () => {
    const snapshot = [...rows];
    sortTeamRows(rows, 'name', 'asc');
    expect(rows).toEqual(snapshot);
  });
});
