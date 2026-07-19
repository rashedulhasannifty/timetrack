import { describe, it, expect } from 'vitest';
import { weekLabel, formatHours, statusBadge } from './approvals-view.js';

describe('approvals-view', () => {
  it('weekLabel renders the ISO week span from periodStart', () => {
    expect(weekLabel('2026-06-29T00:00:00.000Z')).toBe('Jun 29 – Jul 5, 2026');
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
});
