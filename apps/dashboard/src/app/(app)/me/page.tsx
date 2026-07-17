import { PageHeader } from '../../../components/ui/PageHeader';
import { Timeline } from '../../../components/timeline/Timeline';
import { ActivityChart } from '../../../components/charts/ActivityChart';
import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';
import { toActivityPoints } from '../../../lib/me-view';
import { formatTimeRange } from '../../../lib/format';
import { MeTabs } from './MeTabs';
import { ScreenshotsPanel } from './ScreenshotsPanel';
import { toScreenshotView } from './screenshot-view';
import { redactScreenshotAction } from './actions';
import type { ActivitySample, IdleEvent, Screenshot, TimeEntry } from '@timetrack/contracts';

/**
 * PRD §4.3 / §11 — the employee self-view. Same API as the manager view, scoped to self
 * (session.userId). Monitoring you cannot inspect is the hard gate; this is that surface.
 * Today, UTC (the 1.6 timezone follow-up is unchanged).
 */
export default async function MyDataPage() {
  const session = await getSession();
  if (!session) return null;

  const today = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    userId: session.userId,
    from: `${today}T00:00:00.000Z`,
    to: `${today}T23:59:59.999Z`,
  });

  // Self-scoped; the API returns 200 for own data. Each read is independent — a failure
  // in one tab's source degrades to an empty panel, never a whole-page crash.
  const [entries, samples, idle, shots] = await Promise.all([
    api.listTimeEntries(session.accessToken, params).catch((): TimeEntry[] => []),
    api.listActivitySamples(session.accessToken, params).catch((): ActivitySample[] => []),
    api.listIdleEvents(session.accessToken, params).catch((): IdleEvent[] => []),
    api.listScreenshots(session.accessToken, params).catch((): Screenshot[] => []),
  ]);

  return (
    <>
      <PageHeader
        title="My data"
        subtitle={`Everything recorded about you · today (${today}, UTC)`}
      />
      <MeTabs
        panels={{
          Timeline: <Timeline entries={entries} />,
          Activity:
            samples.length === 0 ? (
              <p className="text-sm text-neutral-500">No activity recorded today.</p>
            ) : (
              <ActivityChart data={toActivityPoints(samples)} />
            ),
          Screenshots: (
            <ScreenshotsPanel
              shots={shots.map(toScreenshotView)}
              onRedact={redactScreenshotAction}
            />
          ),
          Idle:
            idle.length === 0 ? (
              <p className="text-sm text-neutral-500">No idle periods today.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {idle.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{formatTimeRange(e.startTime, e.endTime)}</span>
                    <span className="ml-2 text-neutral-500">{e.resolvedAction}</span>
                  </li>
                ))}
              </ul>
            ),
        }}
      />
    </>
  );
}
