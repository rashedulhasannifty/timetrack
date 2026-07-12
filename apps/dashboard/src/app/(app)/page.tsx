import Link from 'next/link';
import { PageHeader } from '../../components/ui/PageHeader';
import { getSession } from '../../lib/session';
import { api } from '../../lib/api-client';
import { formatDuration } from '../../lib/format';

/**
 * Slice 1.6 — the manager's overview: one card per team member with a live tracking dot and
 * today's hours. Server Component (PRD §7.6); the API scopes the rows to the caller.
 */
export default async function TeamOverviewPage() {
  const session = await getSession();
  if (!session) return null; // the layout already gated; this satisfies type-narrowing.
  const overview = await api.teamOverview(session.accessToken);

  return (
    <>
      <PageHeader title="Team overview" subtitle={`Today · ${overview.date} (UTC)`} />
      {overview.rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No team members to show.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {overview.rows.map((row) => (
            <li key={row.userId}>
              <Link
                href={`/people/${row.userId}`}
                className="block rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-300"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{row.name}</span>
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      row.tracking ? 'bg-green-500' : 'bg-neutral-300'
                    }`}
                    aria-label={row.tracking ? 'tracking' : 'idle'}
                  />
                </div>
                <div className="mt-2 text-sm text-neutral-500">
                  {formatDuration(row.trackedSecondsToday)} today
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
