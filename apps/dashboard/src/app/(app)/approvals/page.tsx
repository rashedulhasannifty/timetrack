import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { Card } from '../../../components/ui/Card';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../components/ui/Table';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { weekLabel, formatHours, statusBadge } from '../../../lib/approvals-view';
import { DecideForm } from './DecideForm';
import type { TimesheetApproval, ApprovalStatus } from '@timetrack/contracts';

// Maps statusBadge's tone vocabulary onto the shared Badge component's tone vocabulary.
const TONE: Record<'neutral' | 'positive' | 'warning', BadgeTone> = {
  neutral: 'neutral',
  positive: 'good',
  warning: 'warning',
} as const;

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
      <SetPageTitle title="Approvals" />
      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view approvals.</p>
      ) : rows === null ? (
        <p className="text-text-secondary text-body">
          Something went wrong loading approvals. Please try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-text-secondary text-body">No timesheets in this filter.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-label text-text-secondary">
            Weekly timesheets awaiting a manager decision. Flagged weeks are held back from payroll
            export.
          </p>
          <Card padding="none" className="overflow-hidden">
            <Table>
              <THead>
                <Tr>
                  <Th>User</Th>
                  <Th>Week</Th>
                  <Th align="right">Hours</Th>
                  <Th>Status</Th>
                  <Th align="right">Action</Th>
                </Tr>
              </THead>
              <Tbody>
                {rows.map((row) => {
                  const badge = statusBadge(row.status);
                  return (
                    <Tr key={row.id}>
                      <Td>
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={row.userName} size={26} />
                          {row.userName}
                        </span>
                      </Td>
                      <Td className="text-text-secondary tt-numeric">
                        {weekLabel(row.periodStart)}
                      </Td>
                      <Td align="right">{formatHours(row.totalSeconds ?? row.trackedSeconds)}</Td>
                      <Td>
                        <Badge tone={TONE[badge.tone]}>{badge.label}</Badge>
                      </Td>
                      <Td align="right">
                        <DecideForm approvalId={row.id} />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
