import { weekLabel, formatHours, statusBadge } from '../../../lib/approvals-view';
import type { TimesheetApproval } from '@timetrack/contracts';
import { Card } from '../../../components/ui/Card';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';

const TONE: Record<'neutral' | 'positive' | 'warning', BadgeTone> = {
  neutral: 'neutral',
  positive: 'good',
  warning: 'warning',
};

/**
 * PRD §6.5 — employee self-view of their own timesheet approval status. Server-rendered
 * (fed rows by the page) so it always lands in the DOM alongside the day view.
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

  const [latest, ...rest] = rows;
  if (!latest) {
    return <p className="text-text-secondary text-body">No timesheets yet.</p>;
  }
  const latestBadge = statusBadge(latest.status);

  return (
    <div className="flex flex-col gap-4">
      <Card padding="md" className="flex flex-wrap items-center gap-4">
        <div className="min-w-[220px] flex-1">
          <div className="text-caption text-text-secondary">
            This week’s timesheet · {weekLabel(latest.periodStart)}
          </div>
          <div className="tt-numeric text-[32px] leading-[1.1] font-semibold tracking-[-0.02em]">
            {formatHours(latest.trackedSeconds)}
          </div>
        </div>
        <Badge tone={TONE[latestBadge.tone]}>{latestBadge.label}</Badge>
      </Card>

      {rest.length > 0 && (
        <div className="flex flex-col gap-2">
          {rest.map((row) => {
            const badge = statusBadge(row.status);
            return (
              <div
                key={row.id}
                className="border-separator flex flex-wrap items-center gap-4 border-b py-2 text-body last:border-b-0"
              >
                <span className="min-w-[160px] flex-1">{weekLabel(row.periodStart)}</span>
                <span className="tt-numeric text-text-secondary">
                  {formatHours(row.trackedSeconds)}
                </span>
                <Badge tone={TONE[badge.tone]}>{badge.label}</Badge>
                <span className="tt-numeric text-text-secondary">
                  {row.totalSeconds != null ? formatHours(row.totalSeconds) : '—'}
                </span>
                <span className="text-text-secondary">{row.note ?? '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
