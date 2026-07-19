import type { ApprovalStatus } from '@timetrack/contracts';

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
