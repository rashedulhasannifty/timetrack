import { PageHeader } from '../../../../components/ui/PageHeader';
import { Timeline } from '../../../../components/timeline/Timeline';
import { ActivitySummaryPanel } from '../../../../components/activity/ActivitySummaryPanel';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { activitySummaryWindow } from '../../../../lib/activity-summary-view';
import type { ActivityDailySummary, TimeEntry } from '@timetrack/contracts';

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
  const { from, to } = activitySummaryWindow(new Date());
  const summaryParams = new URLSearchParams({ userId, from, to });

  let entries: TimeEntry[] | null = null;
  let summaries: ActivityDailySummary[] = [];
  try {
    // The API enforces manager-owns-team; a 403 on either read becomes the not-authorized state.
    [entries, summaries] = await Promise.all([
      api.listTimeEntries(session.accessToken, search),
      api.listActivitySummaries(session.accessToken, summaryParams),
    ]);
  } catch {
    entries = null;
  }

  return (
    <>
      <PageHeader title="Person" subtitle={`Timeline · today (${today}, UTC)`} />
      {entries === null ? (
        <p className="text-sm text-neutral-500">You're not permitted to view this person.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <Timeline entries={entries} />
          <section>
            <h2 className="mb-3 text-lg font-medium">Activity · last 7 days (UTC)</h2>
            <ActivitySummaryPanel summaries={summaries} from={from} to={to} />
          </section>
        </div>
      )}
    </>
  );
}
