import { PageHeader } from '../../../../components/ui/PageHeader';
import { Forbidden } from '../../../../components/ui/Forbidden';
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
  const toIsoVal = toIso(sp.to);
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
      <PageHeader title="Audit log" subtitle="Every edit, deletion, and erasure (PRD §6.6)." />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-neutral-500">Target type</span>
          <input
            name="targetType"
            defaultValue={sp.targetType ?? ''}
            placeholder="e.g. user"
            className="rounded-md border border-neutral-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-500">Target id</span>
          <input
            name="targetId"
            defaultValue={sp.targetId ?? ''}
            className="rounded-md border border-neutral-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-500">From</span>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ''}
            className="rounded-md border border-neutral-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-500">To</span>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ''}
            className="rounded-md border border-neutral-300 px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-700"
        >
          Filter
        </button>
      </form>

      {forbidden ? (
        <p className="text-sm text-neutral-500">You’re not permitted to view the audit log.</p>
      ) : page === null ? (
        <p className="text-sm text-neutral-500">Something went wrong loading the audit log.</p>
      ) : page.items.length === 0 ? (
        <p className="text-sm text-neutral-500">No audit entries in this filter.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Diff</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((item) => (
                  <tr key={item.id} className="border-b border-neutral-100 align-top">
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{item.timestamp}</td>
                    <td className="px-3 py-2">{actorLabel(item)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.action}</td>
                    <td className="px-3 py-2 text-neutral-600">
                      {item.targetType}
                      <span className="text-neutral-400"> · {item.targetId}</span>
                    </td>
                    <td className="px-3 py-2">
                      <DiffToggle json={formatDiff(item.diff)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextHref ? (
            <div className="mt-4">
              <a
                href={nextHref}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
              >
                Next →
              </a>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
