import { PageHeader } from '../../../components/ui/PageHeader';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { weekLabel, formatHours, statusBadge } from '../../../lib/approvals-view';
import { DecideForm } from './DecideForm';
import type { TimesheetApproval, ApprovalStatus } from '@timetrack/contracts';

// Restricted palette (no success/warning token): fill-weight carries the semantic — solid-ish
// accent = approved, orange = flagged, subtle = pending. Kept in sync with me/ApprovalsPanel.
const BADGE_TONE: Record<'neutral' | 'positive' | 'warning', string> = {
  neutral: 'bg-surface text-text-secondary',
  positive: 'bg-accent/10 text-accent',
  warning: 'bg-category-unproductive/10 text-category-unproductive',
};

// Next 16 — searchParams is async.
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; teamId?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const status = (sp.status ?? 'PENDING') as ApprovalStatus;

  const params = new URLSearchParams({ status });
  if (sp.teamId) params.set('teamId', sp.teamId);

  let rows: TimesheetApproval[] | null = null;
  let forbidden = false;
  try {
    // API enforces EMPLOYEE self-only / MANAGER own-team / ADMIN any; a 403 becomes the
    // not-authorized state.
    rows = await api.listApprovals(session.accessToken, params);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden = true;
    rows = null;
  }

  return (
    <>
      <PageHeader title="Approvals" subtitle="Approve or flag timesheets for payroll (PRD §6.5)." />
      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view approvals.</p>
      ) : rows === null ? (
        <p className="text-text-secondary text-body">
          Something went wrong loading approvals. Please try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-text-secondary text-body">No timesheets in this filter.</p>
      ) : (
        <table className="w-full text-body">
          <thead>
            <tr className="border-separator text-text-secondary border-b text-left">
              <th className="py-2 font-medium">User</th>
              <th className="py-2 font-medium">Week</th>
              <th className="py-2 font-medium">Hours</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Decide</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const badge = statusBadge(row.status);
              return (
                <tr key={row.id} className="border-separator border-b">
                  <td className="py-2">{row.userName}</td>
                  <td className="py-2">{weekLabel(row.periodStart)}</td>
                  <td className="tt-numeric py-2">
                    {formatHours(row.totalSeconds ?? row.trackedSeconds)}
                  </td>
                  <td className="py-2">
                    <span
                      className={`text-caption rounded-full px-2 py-0.5 font-medium ${BADGE_TONE[badge.tone]}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="py-2">
                    <DecideForm approvalId={row.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
