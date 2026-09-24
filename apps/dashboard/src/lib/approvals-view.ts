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

/**
 * The one-line warning for a week containing an unusually long single entry, or null when there
 * is nothing to say.
 *
 * The rule is a null check, not a comparison: the server decides what counts as long
 * (`LONG_ENTRY_SECONDS`) and sends the length only when it qualifies. Re-deriving the threshold
 * here would be a second copy of a number that must not drift.
 *
 * Why it is worth a manager's attention at all: a timer someone forgot to stop disappears into a
 * weekly total — 47 hours looks like a busy week until you see that 11 of them are one entry.
 * Approving pins `totalSeconds`, so this is the last moment to catch it.
 */
export function longEntryNotice(
  row: Pick<TimesheetApproval, 'longEntrySeconds'>,
): { hours: string; label: string; title: string } | null {
  if (row.longEntrySeconds === null) return null;
  const hours = formatHours(row.longEntrySeconds);
  return {
    hours,
    label: `${hours} entry`,
    title:
      `One entry in this week runs ${hours}. That is usually a timer nobody stopped rather than ` +
      `a day someone worked — check it before approving, because approving pins the total.`,
  };
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
