import { PageHeader } from '../../../components/ui/PageHeader';
import { Timeline } from '../../../components/timeline/Timeline';
import { ActivitySummaryPanel } from '../../../components/activity/ActivitySummaryPanel';
import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';
import { activitySummaryWindow } from '../../../lib/activity-summary-view';
import { formatTimeRange } from '../../../lib/format';
import { MeTabs } from './MeTabs';
import { ScreenshotsPanel } from './ScreenshotsPanel';
import { toScreenshotView } from './screenshot-view';
import { redactScreenshotAction } from './actions';
import { ApprovalsPanel } from './ApprovalsPanel';
import { selfApprovals } from '../../../lib/approvals-view';
import type {
  ActivityDailySummary,
  IdleEvent,
  Screenshot,
  TimeEntry,
  TimesheetApproval,
} from '@timetrack/contracts';

/**
 * PRD §4.3 / §11 — the employee self-view. Same API as the manager view, scoped to self.
 * Timeline/Screenshots/Idle are today (UTC); Activity is the last-7-days rollup (rollups
 * never cover today), fetched over its own window.
 */
export default async function MyDataPage() {
  const session = await getSession();
  if (!session) return null;

  const today = new Date().toISOString().slice(0, 10);
  const todayParams = new URLSearchParams({
    userId: session.userId,
    from: `${today}T00:00:00.000Z`,
    to: `${today}T23:59:59.999Z`,
  });

  const { from, to } = activitySummaryWindow(new Date());
  const summaryParams = new URLSearchParams({ userId: session.userId, from, to });

  // Self-scoped; each read is independent — a failure in one degrades to an empty panel.
  const [entries, summaries, idle, shots, approvals] = await Promise.all([
    api.listTimeEntries(session.accessToken, todayParams).catch((): TimeEntry[] => []),
    api
      .listActivitySummaries(session.accessToken, summaryParams)
      .catch((): ActivityDailySummary[] => []),
    api.listIdleEvents(session.accessToken, todayParams).catch((): IdleEvent[] => []),
    api.listScreenshots(session.accessToken, todayParams).catch((): Screenshot[] => []),
    // The API self-scopes only an EMPLOYEE; a MANAGER/ADMIN gets team/all rows, so we
    // filter to self below (selfApprovals) — this is the employee self-view.
    api
      .listApprovals(session.accessToken, new URLSearchParams())
      .catch((): TimesheetApproval[] | null => null),
  ]);

  const myApprovals = selfApprovals(approvals, session.userId);

  return (
    <>
      <PageHeader
        title="My data"
        subtitle={`Everything recorded about you · today (${today}, UTC)`}
      />
      <section className="flex flex-col gap-2">
        <h2 className="text-text text-label font-semibold">Timesheet status</h2>
        <ApprovalsPanel rows={myApprovals} />
      </section>
      <MeTabs
        panels={{
          Timeline: <Timeline entries={entries} />,
          Activity: <ActivitySummaryPanel summaries={summaries} from={from} to={to} />,
          Screenshots: (
            <ScreenshotsPanel
              shots={shots.map(toScreenshotView)}
              onRedact={redactScreenshotAction}
            />
          ),
          Idle:
            idle.length === 0 ? (
              <p className="text-text-secondary text-body">No idle periods today.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {idle.map((e) => (
                  <li
                    key={e.id}
                    className="bg-surface-raised border-separator text-body rounded-md border px-3 py-2"
                  >
                    <span className="font-medium">{formatTimeRange(e.startTime, e.endTime)}</span>
                    <span className="text-text-secondary ml-2">{e.resolvedAction}</span>
                  </li>
                ))}
              </ul>
            ),
        }}
      />
    </>
  );
}
