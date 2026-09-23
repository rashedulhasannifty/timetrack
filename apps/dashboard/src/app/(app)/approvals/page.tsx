import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../lib/redirect';
import { TabPills, type TabItem } from '../../../components/ui/TabPills';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { ApprovalsTable } from './ApprovalsTable';
import type { TimesheetApproval, ApprovalStatus } from '@timetrack/contracts';

// The API treats an absent `status` as "every status", but a bare `/approvals` is not the way
// to ask for that: this page has always defaulted an absent status to PENDING, and existing
// links rely on that. So All carries the explicit `status=all` sentinel, which is translated
// to "send no status" below. Pointing All at a bare `/approvals` makes it unreachable — it
// lands back on Pending.
const STATUS_TABS: TabItem[] = [
  { href: '/approvals?status=PENDING', label: 'Pending' },
  { href: '/approvals?status=APPROVED', label: 'Approved' },
  { href: '/approvals?status=FLAGGED', label: 'Flagged' },
  { href: '/approvals?status=all', label: 'All' },
];

// Next 16 — searchParams is async.
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; teamId?: string }>;
}) {
  const session = await getSession();
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo('/approvals'));

  const sp = await searchParams;
  // `?status=all` is how the All tab asks for the unfiltered list. A missing status keeps the
  // page's long-standing PENDING default, so old links and bookmarks are unchanged.
  const raw = sp.status ?? 'PENDING';
  const status: ApprovalStatus | null =
    raw.toLowerCase() === 'all' ? null : (raw as ApprovalStatus);

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (sp.teamId) params.set('teamId', sp.teamId);

  const activeHref = status ? `/approvals?status=${status}` : '/approvals?status=all';

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
      ) : (
        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabPills tabs={STATUS_TABS} activeHref={activeHref} ariaLabel="Timesheet status" />
            <span className="text-text-secondary text-caption">
              Flagged weeks are held back from payroll export.
            </span>
          </div>

          {rows === null ? (
            <p className="text-text-secondary text-body">
              Something went wrong loading approvals. Please try again.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-text-secondary text-body">No timesheets in this filter.</p>
          ) : (
            <ApprovalsTable rows={rows} />
          )}
        </div>
      )}
    </>
  );
}
