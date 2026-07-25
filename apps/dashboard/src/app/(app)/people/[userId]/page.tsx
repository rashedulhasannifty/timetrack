import Link from 'next/link';
import { Card } from '../../../../components/ui/Card';
import { SectionHeader } from '../../../../components/ui/SectionHeader';
import { Avatar } from '../../../../components/ui/Avatar';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
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

  // Decorative header data only — never let a lookup failure crash the page.
  let person = { name: 'Team member', tracking: false };
  try {
    const ov = await api.teamOverview(session.accessToken);
    const row = ov.rows.find((r) => r.userId === userId);
    if (row) person = { name: row.name, tracking: row.tracking };
  } catch {
    /* decorative — never crash the header */
  }

  return (
    <>
      <SetPageTitle title={entries === null ? 'Person' : person.name} />
      {entries === null ? (
        <p className="text-text-secondary text-body">You’re not permitted to view this person.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3.5">
            <Link
              href="/"
              className="border-separator text-text-secondary rounded-md border px-2.5 py-1.5 text-label"
            >
              ← Back
            </Link>
            <Avatar name={person.name} size={40} />
            <div>
              <div className="text-[22px] font-semibold tracking-[-0.02em]">{person.name}</div>
              {person.tracking ? (
                <div className="text-caption text-text-secondary flex items-center gap-1.5">
                  <span className="bg-recording h-[7px] w-[7px] rounded-full" />
                  Currently tracking
                </div>
              ) : null}
            </div>
          </div>

          <section className="flex flex-col gap-3">
            <SectionHeader label="Timeline · today" />
            <Card padding="md">
              <Timeline entries={entries} />
            </Card>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader label="Activity · last 7 days (UTC)" />
            <ActivitySummaryPanel summaries={summaries} from={from} to={to} />
          </section>
        </div>
      )}
    </>
  );
}
