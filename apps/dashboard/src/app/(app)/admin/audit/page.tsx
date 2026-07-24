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
      <PageHeader title="Audit log" subtitle="Every edit, deletion, and erasure (PRD §6.6)." />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Target type</span>
          <input
            name="targetType"
            defaultValue={sp.targetType ?? ''}
            placeholder="e.g. user"
            className="bg-surface-raised border-separator text-text focus:border-accent rounded-md border px-2 py-1 outline-none transition-colors"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Target id</span>
          <input
            name="targetId"
            defaultValue={sp.targetId ?? ''}
            className="bg-surface-raised border-separator text-text focus:border-accent rounded-md border px-2 py-1 outline-none transition-colors"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">From</span>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ''}
            className="bg-surface-raised border-separator text-text focus:border-accent rounded-md border px-2 py-1 outline-none transition-colors"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">To</span>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ''}
            className="bg-surface-raised border-separator text-text focus:border-accent rounded-md border px-2 py-1 outline-none transition-colors"
          />
        </label>
        <button
          type="submit"
          className="bg-accent hover:bg-accent-hover rounded-md px-3 py-1.5 text-white transition-colors"
        >
          Filter
        </button>
      </form>

      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view the audit log.</p>
      ) : page === null ? (
        <p className="text-text-secondary text-body">Something went wrong loading the audit log.</p>
      ) : page.items.length === 0 ? (
        <p className="text-text-secondary text-body">No audit entries in this filter.</p>
      ) : (
        <>
          <div className="bg-surface-raised border-separator overflow-x-auto rounded-lg border shadow-e1">
            <table className="w-full text-body">
              <thead>
                <tr className="border-separator text-text-secondary border-b text-left">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Diff</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((item) => (
                  <tr key={item.id} className="border-separator border-b align-top">
                    <td className="tt-numeric px-3 py-2 whitespace-nowrap">{item.timestamp}</td>
                    <td className="px-3 py-2">{actorLabel(item)}</td>
                    <td className="px-3 py-2 font-mono text-caption">{item.action}</td>
                    <td className="text-text-secondary px-3 py-2">
                      {item.targetType}
                      <span className="text-text-secondary"> · {item.targetId}</span>
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
                className="border-separator text-text hover:bg-surface rounded-md border px-3 py-1.5 text-label transition-colors"
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
