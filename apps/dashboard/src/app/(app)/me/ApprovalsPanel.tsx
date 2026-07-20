import { weekLabel, formatHours, statusBadge } from '../../../lib/approvals-view';
import type { TimesheetApproval } from '@timetrack/contracts';

const BADGE_TONE: Record<'neutral' | 'positive' | 'warning', string> = {
  neutral: 'bg-neutral-100 text-neutral-700',
  positive: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
};

/**
 * PRD §6.5 — employee self-view of their own timesheet approval status. Server-rendered
 * (fed rows by the page, not a MeTabs panel) so it always lands in the DOM, unlike the
 * client tab-switcher which only mounts the active tab.
 */
export function ApprovalsPanel({ rows }: { rows: TimesheetApproval[] | null }) {
  if (rows === null) {
    return (
      <p className="text-sm text-neutral-500">
        Something went wrong loading your timesheet status. Please try again.
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No timesheets yet.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-2 font-medium">Week</th>
          <th className="py-2 font-medium">Tracked</th>
          <th className="py-2 font-medium">Status</th>
          <th className="py-2 font-medium">Approved hours</th>
          <th className="py-2 font-medium">Note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const badge = statusBadge(row.status);
          return (
            <tr key={row.id} className="border-b border-neutral-100">
              <td className="py-2">{weekLabel(row.periodStart)}</td>
              <td className="py-2 tabular-nums">{formatHours(row.trackedSeconds)}</td>
              <td className="py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[badge.tone]}`}
                >
                  {badge.label}
                </span>
              </td>
              <td className="py-2 tabular-nums">
                {row.totalSeconds != null ? formatHours(row.totalSeconds) : '—'}
              </td>
              <td className="py-2 text-neutral-600">{row.note ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
