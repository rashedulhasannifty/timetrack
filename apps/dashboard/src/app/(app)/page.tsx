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
        <p className="text-text-secondary text-body">No team members to show.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {overview.rows.map((row) => (
            <li key={row.userId}>
              <Link
                href={`/people/${row.userId}`}
                className="bg-surface-raised border-separator hover:border-accent block rounded-lg border p-4 shadow-e1 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-text font-medium">{row.name}</span>
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      row.tracking ? 'bg-recording' : 'bg-separator'
                    }`}
                    aria-label={row.tracking ? 'tracking' : 'idle'}
                  />
                </div>
                <div className="tt-numeric text-text-secondary text-label mt-2">
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
