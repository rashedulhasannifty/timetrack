import { dayOf, shiftDay } from '@timetrack/contracts';
import type { ApprovalStatus, TimesheetApproval } from '@timetrack/contracts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Jun 29 – Jul 5, 2026" for a Monday periodStart (period is the 7 days [start, start+7)).
 *
 * Read through APP_TIMEZONE, not UTC parts. `periodStart` is now the instant a Monday begins
 * in the org zone (Sunday 18:00 UTC for Dhaka), so `getUTCDate()` would name the SUNDAY and
 * label every week a day early.
 */
export function weekLabel(periodStartIso: string): string {
  const startDay = dayOf(new Date(periodStartIso));
  const endDay = shiftDay(startDay, 6);
  const [, sm, sd] = startDay.split('-') as [string, string, string];
  const [ey, em, ed] = endDay.split('-') as [string, string, string];
  const s = `${MONTHS[Number(sm) - 1]} ${Number(sd)}`;
  const e = `${MONTHS[Number(em) - 1]} ${Number(ed)}, ${ey}`;
  return `${s} – ${e}`;
}

export function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`;
}

/**
 * Narrow an approvals list to a single user's own rows for the /me self-view.
 * The API only self-scopes an EMPLOYEE; a MANAGER/ADMIN calling GET /approvals with no
 * filter gets their whole team / every timesheet, so the /me panel MUST filter to self
 * client-side (the approvals contract has no userId query filter). Returns null unchanged
 * (a failed fetch), so callers keep their error state.
 */
export function selfApprovals(
  rows: TimesheetApproval[] | null,
  userId: string,
): TimesheetApproval[] | null {
  return rows === null ? null : rows.filter((r) => r.userId === userId);
}

/**
 * Was this decided by a person, or by the auto-approval sweep?
 *
 * A decided row with no reviewer is the worker's: `reviewerId` is the human who decided, and
 * the auto-approve job deliberately leaves it null (the audit trail carries the system actor
 * instead). Surfacing it matters — "approved" reads as "a manager looked at this", and for
 * these rows nobody did.
 */
export function wasAutoDecided(row: Pick<TimesheetApproval, 'status' | 'reviewerId'>): boolean {
  return row.status !== 'PENDING' && row.reviewerId === null;
}

export function statusBadge(status: ApprovalStatus): {
  label: string;
  tone: 'neutral' | 'positive' | 'warning';
} {
  switch (status) {
    case 'APPROVED':
      return { label: 'Approved', tone: 'positive' };
    case 'FLAGGED':
      return { label: 'Flagged', tone: 'warning' };
    case 'PENDING':
      return { label: 'Pending', tone: 'neutral' };
  }
}
