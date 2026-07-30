import { Forbidden } from '../../../../components/ui/Forbidden';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { AdminTabs } from '../../../../components/ui/AdminTabs';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';
import { actorLabel, formatDiff, toIso, buildAuditParams } from '../../../../lib/audit-view';
import { DiffToggle } from './DiffToggle';

// Next 16 — searchParams is async.
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    targetType?: string;
    targetId?: string;
    from?: string;
    to?: string;
    cursor?: string;
  }>;
}) {
  const session = await getSession();
  if (!session) return null; // layout already redirected
  if (session.role !== 'ADMIN') return <Forbidden />;

  const sp = await searchParams;
  // The URL carries the raw <input type="date"> values; normalize only at the API boundary.
  // (exactOptionalPropertyTypes: only spread a key in when its value is defined.)
  const fromIso = toIso(sp.from);
  // `to` maps to end-of-day so an inclusive lte covers that whole day's rows (not just its midnight).
  const toIsoVal = toIso(sp.to, 'end');
  const apiParams = buildAuditParams(
    {
      ...(sp.targetType ? { targetType: sp.targetType } : {}),
      ...(sp.targetId ? { targetId: sp.targetId } : {}),
      ...(fromIso ? { from: fromIso } : {}),
      ...(toIsoVal ? { to: toIsoVal } : {}),
    },
    sp.cursor,
  );

  let page: Awaited<ReturnType<typeof api.listAudit>> | null = null;
  let forbidden = false;
  try {
    page = await api.listAudit(session.accessToken, apiParams);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden = true;
    page = null;
  }

  // "Next" and re-filter links keep the raw (URL-format) filter values; only the cursor advances.
  const nextHref =
    page?.nextCursor != null ? `?${buildAuditParams(sp, page.nextCursor).toString()}` : null;

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />

      <div className="flex flex-col gap-4">
        <Card padding="md">
          <form method="get" className="flex flex-wrap items-end gap-3 text-label">
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">Target type</span>
              <input
                name="targetType"
                defaultValue={sp.targetType ?? ''}
                placeholder="e.g. user"
                className="bg-surface border-separator focus:border-accent text-label rounded-md border px-3 py-2 outline-none transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">Target id</span>
              <input
                name="targetId"
                defaultValue={sp.targetId ?? ''}
                className="bg-surface border-separator focus:border-accent text-label rounded-md border px-3 py-2 outline-none transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">From</span>
              <input
                type="date"
                name="from"
                defaultValue={sp.from ?? ''}
                className="bg-surface border-separator focus:border-accent text-label rounded-md border px-3 py-2 outline-none transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">To</span>
              <input
                type="date"
                name="to"
                defaultValue={sp.to ?? ''}
                className="bg-surface border-separator focus:border-accent text-label rounded-md border px-3 py-2 outline-none transition-colors"
              />
            </label>
            <Button type="submit" variant="primary" size="sm">
              Filter
            </Button>
          </form>
        </Card>

        {forbidden ? (
          <p className="text-text-secondary text-body">
            You’re not permitted to view the audit log.
          </p>
        ) : page === null ? (
          <p className="text-text-secondary text-body">
            Something went wrong loading the audit log.
          </p>
        ) : page.items.length === 0 ? (
          <p className="text-text-secondary text-body">No audit entries in this filter.</p>
        ) : (
          <>
            <Card padding="none" className="overflow-hidden">
              <Table>
                <THead>
                  <Tr>
                    <Th>Time</Th>
                    <Th>Actor</Th>
                    <Th>Action</Th>
                    <Th>Target</Th>
                    <Th>Diff</Th>
                  </Tr>
                </THead>
                <Tbody>
                  {page.items.map((item) => (
                    <Tr key={item.id}>
                      <Td className="tt-numeric whitespace-nowrap">{item.timestamp}</Td>
                      <Td>{actorLabel(item)}</Td>
                      <Td className="text-caption font-mono">{item.action}</Td>
                      <Td className="text-text-secondary">
                        {item.targetType}
                        <span className="text-text-secondary"> · {item.targetId}</span>
                      </Td>
                      <Td>
                        <DiffToggle json={formatDiff(item.diff)} />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
            {nextHref ? (
              <div>
                <Button href={nextHref} variant="secondary" size="sm">
                  Next →
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
