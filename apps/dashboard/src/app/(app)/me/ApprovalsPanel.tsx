import { weekLabel, formatHours, statusBadge } from '../../../lib/approvals-view';
import type { TimesheetApproval } from '@timetrack/contracts';

// Kept in sync with approvals/page.tsx — restricted palette, fill-weight carries the semantic.
const BADGE_TONE: Record<'neutral' | 'positive' | 'warning', string> = {
  neutral: 'bg-surface text-text-secondary',
  positive: 'bg-accent/10 text-accent',
  warning: 'bg-category-unproductive/10 text-category-unproductive',
};

/**
 * PRD §6.5 — employee self-view of their own timesheet approval status. Server-rendered
 * (fed rows by the page, not a MeTabs panel) so it always lands in the DOM, unlike the
 * client tab-switcher which only mounts the active tab.
 */
export function ApprovalsPanel({ rows }: { rows: TimesheetApproval[] | null }) {
  if (rows === null) {
    return (
      <p className="text-text-secondary text-body">
        Something went wrong loading your timesheet status. Please try again.
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="text-text-secondary text-body">No timesheets yet.</p>;
  }

  return (
    <table className="w-full text-body">
      <thead>
        <tr className="border-separator text-text-secondary border-b text-left">
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
            <tr key={row.id} className="border-separator border-b">
              <td className="py-2">{weekLabel(row.periodStart)}</td>
              <td className="tt-numeric py-2">{formatHours(row.trackedSeconds)}</td>
              <td className="py-2">
                <span
                  className={`text-caption rounded-full px-2 py-0.5 font-medium ${BADGE_TONE[badge.tone]}`}
                >
                  {badge.label}
                </span>
              </td>
              <td className="tt-numeric py-2">
                {row.totalSeconds != null ? formatHours(row.totalSeconds) : '—'}
              </td>
              <td className="text-text-secondary py-2">{row.note ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
