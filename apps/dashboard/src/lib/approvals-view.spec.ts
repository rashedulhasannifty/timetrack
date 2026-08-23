import { describe, it, expect } from 'vitest';
import { weekLabel, formatHours, statusBadge, selfApprovals } from './approvals-view.js';
import type { TimesheetApproval } from '@timetrack/contracts';

describe('approvals-view', () => {
  it('weekLabel renders the ISO week span from periodStart', () => {
    // periodStart is the instant a Monday BEGINS in APP_TIMEZONE — Sunday 18:00Z for Dhaka.
    // Reading UTC parts would name the Sunday and label the whole week a day early.
    expect(weekLabel('2026-06-28T18:00:00.000Z')).toBe('Jun 29 – Jul 5, 2026');
  });

  it('weekLabel does not slip a day for a period that spans a month end', () => {
    // Dhaka Monday 2026-08-31 begins at 2026-08-30T18:00Z; the week runs into September.
    expect(weekLabel('2026-08-30T18:00:00.000Z')).toBe('Aug 31 – Sep 6, 2026');
  });

  it('formatHours renders seconds as H.h', () => {
    expect(formatHours(5400)).toBe('1.5h');
    expect(formatHours(0)).toBe('0.0h');
  });

  it('statusBadge returns the label and tone for APPROVED', () => {
    expect(statusBadge('APPROVED')).toEqual({ label: 'Approved', tone: 'positive' });
  });

  it('statusBadge returns the label and tone for FLAGGED', () => {
    expect(statusBadge('FLAGGED')).toEqual({ label: 'Flagged', tone: 'warning' });
  });

  it('statusBadge returns the label and tone for PENDING', () => {
    expect(statusBadge('PENDING')).toEqual({ label: 'Pending', tone: 'neutral' });
  });

  it('selfApprovals keeps only the given user’s rows (guards the /me self-view for MANAGER/ADMIN)', () => {
    const row = (id: string, userId: string): TimesheetApproval => ({
      id,
      userId,
      userName: 'x',
      periodStart: '2026-06-29T00:00:00.000Z',
      periodEnd: '2026-07-06T00:00:00.000Z',
      status: 'PENDING',
      trackedSeconds: 0,
      totalSeconds: null,
      reviewerId: null,
      note: null,
      decidedAt: null,
    });
    const rows = [row('a', 'me'), row('b', 'other'), row('c', 'me')];
    expect(selfApprovals(rows, 'me')!.map((r) => r.id)).toEqual(['a', 'c']);
    expect(selfApprovals([], 'me')).toEqual([]);
    expect(selfApprovals(null, 'me')).toBeNull(); // a failed fetch is passed through unchanged
  });
});
