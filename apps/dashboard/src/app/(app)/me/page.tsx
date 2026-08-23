import { dayOf } from '@timetrack/contracts';
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../lib/redirect';
import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';
import {
  dayRangeFor,
  personDayView,
  resolveDayDate,
  weekRangeFor,
  weekStrip,
} from '../../../lib/person-day-view';
import { WeekStrip } from '../../../components/day/WeekStrip';
import { categoryMix, idleRows } from '../../../lib/idle-view';
import { DayHeader } from '../../../components/day/DayHeader';
import { DayStats } from '../../../components/day/DayStats';
import { DayTabs, resolveDayPanel } from '../../../components/day/DayTabs';
import { DayPanels } from '../../../components/day/DayPanels';
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
 * falls back to today (Dhaka).
 */
export default async function MyDataPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; panel?: string }>;
}) {
  const session = await getSession();
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo('/me'));

  const { date: rawDate, panel: rawPanel } = await searchParams;
  const date = resolveDayDate(rawDate, new Date());
  const panel = resolveDayPanel(rawPanel);

  const dayRange = dayRangeFor(date);
  const todayParams = new URLSearchParams({
    userId: session.userId,
    from: dayRange.from,
    to: dayRange.to,
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

  const today = dayOf(new Date());

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

        <DayTabs panel={panel} date={date} basePath="/me" />

        <DayPanels
          panel={panel}
          model={model}
          weekStrip={trends ? <WeekStrip days={weekStrip(date, trends.days, today)} /> : undefined}
          apps={<DayAppUsage usage={appUsage} />}
          screenshots={
            <ScreenshotsPanel
              shots={screenshots.map(toScreenshotView)}
              onRedact={redactScreenshotAction}
            />
          }
          mix={categoryMix(samples)}
          idle={idleRows(idle)}
          idleAction={(row) => <ResolveIdleForm row={row} />}
        />
      </div>
    </>
  );
}
