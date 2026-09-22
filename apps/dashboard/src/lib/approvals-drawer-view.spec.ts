import { describe, it, expect } from 'vitest';
import { toApprovalDetail } from './approvals-drawer-view.js';
import type { TimesheetApproval } from '@timetrack/contracts';

const row = (over: Partial<TimesheetApproval> = {}): TimesheetApproval => ({
  id: 'a1',
  userId: 'u1',
  userName: 'Ada Lovelace',
  // Dhaka Monday 2026-06-29 begins at 2026-06-28T18:00Z.
  periodStart: '2026-06-28T18:00:00.000Z',
  periodEnd: '2026-07-05T18:00:00.000Z',
  status: 'PENDING',
  trackedSeconds: 3600,
  totalSeconds: null,
  reviewerId: null,
  note: null,
  decidedAt: null,
  ...over,
});

describe('toApprovalDetail', () => {
  it('a pending row has no decided snapshot, drift, or decided-at label', () => {
    const detail = toApprovalDetail(row());
    expect(detail.status).toBe('PENDING');
    expect(detail.badge).toEqual({ label: 'Pending', tone: 'neutral' });
    expect(detail.trackedHours).toBe('1.0h');
    expect(detail.decidedHours).toBeNull();
    expect(detail.driftSeconds).toBeNull();
    expect(detail.decidedAtLabel).toBeNull();
    expect(detail.autoDecided).toBe(false);
  });

  it('a decided row with no drift reports the snapshot and null drift', () => {
    const detail = toApprovalDetail(
      row({
        status: 'APPROVED',
        reviewerId: 'mgr1',
        trackedSeconds: 3600,
        totalSeconds: 3600,
        decidedAt: '2026-07-06T10:15:00.000Z',
      }),
    );
    expect(detail.trackedHours).toBe('1.0h');
    expect(detail.decidedHours).toBe('1.0h');
    expect(detail.driftSeconds).toBeNull();
    // 2026-07-06T10:15Z is 16:15 in Dhaka (+06:00), same calendar day.
    expect(detail.decidedAtLabel).toBe('Jul 6, 2026 · 16:15');
  });

  it('a decided row with drift reports the difference between live and snapshot seconds', () => {
    const grew = toApprovalDetail(
      row({
        status: 'APPROVED',
        reviewerId: 'mgr1',
        trackedSeconds: 7200,
        totalSeconds: 3600,
        decidedAt: '2026-07-06T10:15:00.000Z',
      }),
    );
    expect(grew.driftSeconds).toBe(3600); // more was tracked after the decision

    const shrank = toApprovalDetail(
      row({
        status: 'APPROVED',
        reviewerId: 'mgr1',
        trackedSeconds: 1800,
        totalSeconds: 3600,
        decidedAt: '2026-07-06T10:15:00.000Z',
      }),
    );
    expect(shrank.driftSeconds).toBe(-1800); // an entry was edited away after the decision
  });

  it('marks a row decided with no reviewer as automatic', () => {
    const detail = toApprovalDetail(
      row({
        status: 'APPROVED',
        reviewerId: null,
        totalSeconds: 3600,
        decidedAt: '2026-07-06T10:15:00.000Z',
      }),
    );
    expect(detail.autoDecided).toBe(true);
  });

  it('does not mark a human decision as automatic', () => {
    const detail = toApprovalDetail(
      row({
        status: 'FLAGGED',
        reviewerId: 'mgr1',
        totalSeconds: 3600,
        decidedAt: '2026-07-06T10:15:00.000Z',
      }),
    );
    expect(detail.autoDecided).toBe(false);
  });

  it('reports a null note as null, not a placeholder string', () => {
    expect(toApprovalDetail(row({ note: null })).note).toBeNull();
  });

  it('carries a reviewer note through unchanged', () => {
    expect(toApprovalDetail(row({ note: 'Missing Friday hours' })).note).toBe(
      'Missing Friday hours',
    );
  });

  it('weekHref points at the person day view on the week’s first Dhaka day', () => {
    const detail = toApprovalDetail(row({ userId: 'u42' }));
    expect(detail.weekStartDay).toBe('2026-06-29');
    expect(detail.weekHref).toBe('/people/u42?date=2026-06-29');
  });

  it('weekHref does not slip a day for a period that spans a month end', () => {
    // Dhaka Monday 2026-08-31 begins at 2026-08-30T18:00Z.
    const detail = toApprovalDetail(row({ userId: 'u7', periodStart: '2026-08-30T18:00:00.000Z' }));
    expect(detail.weekStartDay).toBe('2026-08-31');
    expect(detail.weekHref).toBe('/people/u7?date=2026-08-31');
  });

  it('weekLabel matches the shared approvals-view helper', () => {
    expect(toApprovalDetail(row()).weekLabel).toBe('Jun 29 – Jul 5, 2026');
  });
});
