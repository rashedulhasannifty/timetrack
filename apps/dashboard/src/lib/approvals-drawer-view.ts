import { clockOf, dayOf } from '@timetrack/contracts';
import type { TimesheetApproval } from '@timetrack/contracts';
import {
  formatHours,
  longEntryNotice,
  statusBadge,
  wasAutoDecided,
  weekLabel,
} from './approvals-view';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface ApprovalDetail {
  id: string;
  userId: string;
  userName: string;
  /** "Jun 29 – Jul 5, 2026" — reuses weekLabel, so it can never disagree with the table. */
  weekLabel: string;
  /** 'YYYY-MM-DD' Dhaka day the week begins — also backs weekHref. */
  weekStartDay: string;
  status: TimesheetApproval['status'];
  badge: ReturnType<typeof statusBadge>;
  autoDecided: boolean;
  /** Live `trackedSeconds`, formatted. */
  trackedHours: string;
  /** The snapshot pinned at decision, formatted; null while PENDING. */
  decidedHours: string | null;
  /**
   * `trackedSeconds - totalSeconds` when both exist and differ — time tracked or edited after
   * the decision. Null while PENDING (no snapshot to compare against) and null when the two
   * agree, so the drawer only calls out drift that is actually there.
   */
  driftSeconds: number | null;
  /** See `longEntryNotice` — null when nothing in the week is unusually long. */
  longEntry: ReturnType<typeof longEntryNotice>;
  decidedAtLabel: string | null;
  note: string | null;
  /** The person's day view on the week's first day; the week strip there covers the rest. */
  weekHref: string;
}

/**
 * Pure view-transform for the approvals week drawer — everything `ApprovalsTable` needs to
 * render one row's detail, derived from the `TimesheetApproval` the list already has (no extra
 * fetch). `now` is unused today (reserved for a future relative-time treatment of
 * `decidedAtLabel`); kept in the signature so callers can pass a fixed clock in tests.
 */
export function toApprovalDetail(row: TimesheetApproval, _now: Date = new Date()): ApprovalDetail {
  const weekStartDay = dayOf(new Date(row.periodStart));
  const driftSeconds =
    row.totalSeconds !== null && row.totalSeconds !== row.trackedSeconds
      ? row.trackedSeconds - row.totalSeconds
      : null;

  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    weekLabel: weekLabel(row.periodStart),
    weekStartDay,
    status: row.status,
    badge: statusBadge(row.status),
    autoDecided: wasAutoDecided(row),
    trackedHours: formatHours(row.trackedSeconds),
    decidedHours: row.totalSeconds !== null ? formatHours(row.totalSeconds) : null,
    driftSeconds,
    longEntry: longEntryNotice(row),
    decidedAtLabel: row.decidedAt !== null ? formatDecidedAt(row.decidedAt) : null,
    note: row.note,
    weekHref: `/people/${row.userId}?date=${weekStartDay}`,
  };
}

/** "Jul 6, 2026 · 16:15", read through APP_TIMEZONE (see weekLabel's note on why). */
function formatDecidedAt(iso: string): string {
  const instant = new Date(iso);
  const day = dayOf(instant);
  const [y, m, d] = day.split('-') as [string, string, string];
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y} · ${clockOf(instant)}`;
}
