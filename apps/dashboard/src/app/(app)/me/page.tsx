import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';
import {
  personDayView,
  resolveDayDate,
  weekRangeFor,
  weekStrip,
} from '../../../lib/person-day-view';
import { WeekStrip } from '../../../components/day/WeekStrip';
import { IdlePanel } from '../../../components/day/IdlePanel';
import { CategoryMixBar } from '../../../components/day/CategoryMixBar';
import { Card, CardTitle } from '../../../components/ui/Card';
import { categoryMix, idleRows } from '../../../lib/idle-view';
import { DayHeader } from '../../../components/day/DayHeader';
import { DayStats } from '../../../components/day/DayStats';
import { TimeRibbon } from '../../../components/day/TimeRibbon';
import { ActivityBars } from '../../../components/day/ActivityBars';
import { TimeEntriesList } from '../../../components/day/TimeEntriesList';
import { MeTabs, resolveMePanel } from './MeTabs';
import { ResolveIdleForm } from './ResolveIdleForm';
import { ScreenshotsPanel } from './ScreenshotsPanel';
import { toScreenshotView } from './screenshot-view';
import { redactScreenshotAction } from './actions';
import { ApprovalsPanel } from './ApprovalsPanel';
import { DayAppUsage } from '../../../components/day/DayAppUsage';
import { selfApprovals } from '../../../lib/approvals-view';
import type {
  ActivitySample,
  IdleEvent,
  Project,
  Screenshot,
  TeamAppUsage,
  TeamTrends,
  TimeEntry,
  TimesheetApproval,
} from '@timetrack/contracts';

/**
 * PRD §4.3 / §11 — the employee self-view. Same API as the manager view, scoped to self.
 * Date-aware: `?date=YYYY-MM-DD` selects the day rendered by PersonDayView; invalid/missing
 * falls back to today (UTC).
 */
export default async function MyDataPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; panel?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const { date: rawDate, panel: rawPanel } = await searchParams;
  const date = resolveDayDate(rawDate, new Date());
  const panel = resolveMePanel(rawPanel);

  const todayParams = new URLSearchParams({
    userId: session.userId,
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
  });

  const week = weekRangeFor(date);
  const weekParams = new URLSearchParams({
    userId: session.userId,
    from: week.from,
    to: week.to,
  });

  // Self-scoped; each read is independent — a failure in one degrades to an empty panel.
  const [entries, samples, screenshots, approvals, projects, appUsage, idle, trends] =
    await Promise.all([
      api.listTimeEntries(session.accessToken, todayParams).catch((): TimeEntry[] => []),
      api.listActivitySamples(session.accessToken, todayParams).catch((): ActivitySample[] => []),
      api.listScreenshots(session.accessToken, todayParams).catch((): Screenshot[] => []),
      // The API self-scopes only an EMPLOYEE; a MANAGER/ADMIN gets team/all rows, so we
      // filter to self below (selfApprovals) — this is the employee self-view.
      api
        .listApprovals(session.accessToken, new URLSearchParams())
        .catch((): TimesheetApproval[] | null => null),
      // Names for the entries: an entry carries a projectId/taskId, not names. includeArchived so a
      // historical entry on a since-archived project still resolves instead of falling to "Untitled".
      api.listProjects(session.accessToken, { includeArchived: true }).catch((): Project[] => []),
      // Explicitly self-scoped. The API pins an EMPLOYEE to themselves regardless, but a
      // MANAGER/ADMIN reading their OWN page would otherwise fall through to a team-wide
      // rollup rendered under a heading that says it is theirs.
      api.appUsage(session.accessToken, todayParams).catch((): TeamAppUsage | null => null),
      // Idle periods for the day. Resolution happens on the Mac app and syncs up — this is a
      // read-only report of how each one was answered.
      api.listIdleEvents(session.accessToken, todayParams).catch((): IdleEvent[] => []),
      api.trends(session.accessToken, weekParams).catch((): TeamTrends | null => null),
    ]);

  const myApprovals = selfApprovals(approvals, session.userId);

  const model = personDayView({
    date,
    now: new Date(),
    isSelf: true,
    subjectName: 'You',
    entries,
    samples,
    screenshots,
    projects,
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <SetPageTitle title="My time" kicker="Everything here is yours only" />
      <div className="flex flex-col gap-6">
        <ApprovalsPanel rows={myApprovals} />

        <DayHeader
          date={date}
          subjectName={model.subjectName}
          isSelf
          isToday={model.isToday}
          recordingNow={model.recordingNow}
        />

        <DayStats stats={model.stats} />

        <MeTabs panel={panel} date={date} />

        {panel === 'timeline' ? (
          <Card padding="md" className="flex flex-col gap-[22px]">
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>The day</CardTitle>
                {trends ? <WeekStrip days={weekStrip(date, trends.days, today)} /> : null}
              </div>
              <TimeRibbon ribbon={model.ribbon} />
            </section>
            <section className="flex flex-col gap-3">
              <CardTitle>Time entries</CardTitle>
              <TimeEntriesList entries={model.entries} />
            </section>
          </Card>
        ) : null}

        {panel === 'activity' ? (
          <div className="grid items-start gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
            <Card padding="md" className="flex flex-col gap-5">
              <section className="flex flex-col gap-3">
                <CardTitle>Active minutes</CardTitle>
                <ActivityBars buckets={model.activityBuckets} />
              </section>
              <section className="border-separator border-t pt-4">
                <CategoryMixBar mix={categoryMix(samples)} />
              </section>
            </Card>
            <Card padding="md">
              <CardTitle className="mb-3.5">Your apps &amp; sites</CardTitle>
              <DayAppUsage usage={appUsage} />
            </Card>
          </div>
        ) : null}

        {panel === 'screenshots' ? (
          <Card padding="md">
            <CardTitle
              className="mb-3.5"
              note="blurred at capture · you can redact any of your own"
            >
              Screenshots
            </CardTitle>
            <ScreenshotsPanel
              shots={screenshots.map(toScreenshotView)}
              onRedact={redactScreenshotAction}
            />
          </Card>
        ) : null}

        {panel === 'idle' ? (
          <Card padding="md">
            <CardTitle className="mb-2" note="over your team's idle threshold">
              Idle periods
            </CardTitle>
            <IdlePanel rows={idleRows(idle)} action={(row) => <ResolveIdleForm row={row} />} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
