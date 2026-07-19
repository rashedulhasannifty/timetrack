import { PageHeader } from '../../../components/ui/PageHeader';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { weekLabel, formatHours, statusBadge } from '../../../lib/approvals-view';
import { DecideForm } from './DecideForm';
import type { TimesheetApproval, ApprovalStatus } from '@timetrack/contracts';

const BADGE_TONE: Record<'neutral' | 'positive' | 'warning', string> = {
  neutral: 'bg-neutral-100 text-neutral-700',
  positive: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
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
        <p className="text-sm text-neutral-500">You’re not permitted to view approvals.</p>
      ) : rows === null ? (
        <p className="text-sm text-neutral-500">
          Something went wrong loading approvals. Please try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No timesheets in this filter.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
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
                <tr key={row.id} className="border-b border-neutral-100">
                  <td className="py-2">{row.userName}</td>
                  <td className="py-2">{weekLabel(row.periodStart)}</td>
                  <td className="py-2 tabular-nums">
                    {formatHours(row.totalSeconds ?? row.trackedSeconds)}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[badge.tone]}`}
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
