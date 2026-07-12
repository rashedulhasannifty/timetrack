import { PageHeader } from '../../../../components/ui/PageHeader';
import { Timeline } from '../../../../components/timeline/Timeline';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import type { TimeEntry } from '@timetrack/contracts';

// Next 16 — route params are async.
export default async function PersonPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const session = await getSession();
  if (!session) return null;

  const today = new Date().toISOString().slice(0, 10);
  const search = new URLSearchParams({
    userId,
    from: `${today}T00:00:00.000Z`,
    to: `${today}T23:59:59.999Z`,
  });

  let entries: TimeEntry[] | null = null;
  try {
    entries = await api.listTimeEntries(session.accessToken, search);
  } catch {
    // The API enforces manager-owns-team; a 403 becomes a not-authorized state, not a crash.
    entries = null;
  }

  return (
    <>
      <PageHeader title="Person" subtitle={`Timeline · today (${today}, UTC)`} />
      {entries === null ? (
        <p className="text-sm text-neutral-500">You’re not permitted to view this person.</p>
      ) : (
        <Timeline entries={entries} />
      )}
    </>
  );
}
