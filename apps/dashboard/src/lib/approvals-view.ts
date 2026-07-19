import type { ApprovalStatus, TimesheetApproval } from '@timetrack/contracts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jun 29 – Jul 5, 2026" for a Monday periodStart (period is the 7 days [start, start+7)). */
export function weekLabel(periodStartIso: string): string {
  const start = new Date(periodStartIso);
  const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000);
  const s = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const e = `${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
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
