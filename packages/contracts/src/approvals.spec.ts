import { describe, it, expect } from 'vitest';
import { TimesheetApprovalSchema, DecisionSchema, ApprovalListQuerySchema } from './approvals.js';

const row = {
  id: '019797a0-0000-7000-8000-000000000001',
  userId: '019797a0-0000-7000-8000-000000000002',
  userName: 'Ada',
  periodStart: '2026-06-29T00:00:00.000Z',
  periodEnd: '2026-07-06T00:00:00.000Z',
  status: 'PENDING',
  trackedSeconds: 5400,
  totalSeconds: null,
  reviewerId: null,
  note: null,
  decidedAt: null,
};

describe('TimesheetApprovalSchema', () => {
  it('accepts a valid PENDING row with null snapshot', () => {
    expect(TimesheetApprovalSchema.parse(row)).toEqual(row);
  });
  it('accepts a decided row with a snapshot', () => {
    const decided = {
      ...row,
      status: 'APPROVED',
      totalSeconds: 5400,
      reviewerId: row.userId,
      note: 'ok',
      decidedAt: '2026-07-06T09:00:00.000Z',
    };
    expect(TimesheetApprovalSchema.parse(decided)).toEqual(decided);
  });
  it('rejects a negative trackedSeconds', () => {
    expect(() => TimesheetApprovalSchema.parse({ ...row, trackedSeconds: -1 })).toThrow();
  });
});

describe('DecisionSchema', () => {
  it('accepts APPROVED / FLAGGED with an optional note', () => {
    expect(DecisionSchema.parse({ status: 'APPROVED' })).toEqual({ status: 'APPROVED' });
    expect(DecisionSchema.parse({ status: 'FLAGGED', note: 'fix week' })).toEqual({
      status: 'FLAGGED',
      note: 'fix week',
    });
  });
  it('rejects PENDING as a decision', () => {
    expect(() => DecisionSchema.parse({ status: 'PENDING' })).toThrow();
  });
  it('rejects a note longer than 2000 chars', () => {
    expect(() => DecisionSchema.parse({ status: 'APPROVED', note: 'x'.repeat(2001) })).toThrow();
  });
});

describe('ApprovalListQuerySchema', () => {
  it('accepts an empty query and a status+teamId filter', () => {
    expect(ApprovalListQuerySchema.parse({})).toEqual({});
    const q = { status: 'PENDING', teamId: '019797a0-0000-7000-8000-000000000009' };
    expect(ApprovalListQuerySchema.parse(q)).toEqual(q);
  });
});
