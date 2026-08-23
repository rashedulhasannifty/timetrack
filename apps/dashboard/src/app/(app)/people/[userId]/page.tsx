import Link from 'next/link';
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../../lib/redirect';
import { dayOf } from '@timetrack/contracts';
import { Avatar } from '../../../../components/ui/Avatar';
import { buttonClasses } from '../../../../components/ui/Button';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { DayHeader } from '../../../../components/day/DayHeader';
import { DayStats } from '../../../../components/day/DayStats';
import { DayTabs, resolveDayPanel } from '../../../../components/day/DayTabs';
import { DayPanels } from '../../../../components/day/DayPanels';
import { DayAppUsage } from '../../../../components/day/DayAppUsage';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import {
  dayRangeFor,
  personDayView,
  resolveDayDate,
  weekRangeFor,
  weekStrip,
} from '../../../../lib/person-day-view';
import { WeekStrip } from '../../../../components/day/WeekStrip';
import { categoryMix, idleRows } from '../../../../lib/idle-view';
import { ScreenshotsPanel } from '../../me/ScreenshotsPanel';
import { toScreenshotView } from '../../me/screenshot-view';
import type {
  ActivitySample,
  IdleEvent,
  Project,
  Screenshot,
  TeamAppUsage,
  TeamTrends,
  TimeEntry,
} from '@timetrack/contracts';

// Next 16 — route params are async.
export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ date?: string; panel?: string }>;
}) {
  const { userId } = await params;
  const session = await getSession();
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo(`/people/${userId}`));

  const { date: rawDate, panel: rawPanel } = await searchParams;
  const date = resolveDayDate(rawDate, new Date());
  const panel = resolveDayPanel(rawPanel);

  const dayRange = dayRangeFor(date);
  const search = new URLSearchParams({
    userId,
    from: dayRange.from,
    to: dayRange.to,
  });

  let entries: TimeEntry[] | null = null;
  try {
    // The API enforces manager-owns-team; a 403 on this read becomes the not-authorized state.
    entries = await api.listTimeEntries(session.accessToken, search);
  } catch {
    entries = null;
  }

  // Same manager-owns-team authz applies to these reads, but a failure here shouldn't wall off
  // the whole page — it degrades the relevant panel to empty instead.
  // The week the viewed day sits in — one extra per-user trends call, scoped by the same
  // manager-owns-team check as everything else here.
  const week = weekRangeFor(date);
  const weekSearch = new URLSearchParams({ userId, from: week.from, to: week.to });

  const [samples, screenshots, projects, appUsage, trends, idle] = await Promise.all([
    api.listActivitySamples(session.accessToken, search).catch((): ActivitySample[] => []),
    api.listScreenshots(session.accessToken, search).catch((): Screenshot[] => []),
    // Names for the entries. Team-scoped to the caller, so this resolves for the common
    // manager-owns-team view; a cross-team admin view degrades to "Untitled entry" per entry.
    api.listProjects(session.accessToken, { includeArchived: true }).catch((): Project[] => []),
    // `search` already carries userId + the day window, which is what app-usage wants; the
    // API re-checks manager-owns-team on that userId and 403s if it doesn't hold.
    api.appUsage(session.accessToken, search).catch((): TeamAppUsage | null => null),
    api.trends(session.accessToken, weekSearch).catch((): TeamTrends | null => null),
    // Same manager-owns-team gate as the rest (ResourceScope on ?userId=). Read-only here:
    // POST /idle-events attributes the row to the caller, so only the person themselves can
    // resolve one, from their own My time page.
    api.listIdleEvents(session.accessToken, search).catch((): IdleEvent[] => []),
  ]);

  // Decorative header data only — never let a lookup failure crash the page.
  let person = { name: 'Team member' };
  try {
    const ov = await api.teamOverview(session.accessToken);
    const row = ov.rows.find((r) => r.userId === userId);
    if (row) person = { name: row.name };
  } catch {
    /* decorative — never crash the header */
  }

  const model =
    entries === null
      ? null
      : personDayView({
          date,
          now: new Date(),
          isSelf: false,
          subjectName: person.name,
          entries,
          samples,
          screenshots,
          projects,
        });

  return (
    <>
      <SetPageTitle title={entries === null ? 'Person' : person.name} />
      {model === null ? (
        <p className="text-text-secondary text-body">You’re not permitted to view this person.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <Link href="/overview" className={buttonClasses('secondary', 'sm')}>
              ← Back
            </Link>
          </div>

          <DayHeader
            date={date}
            subjectName={person.name}
            isSelf={false}
            isToday={model.isToday}
            recordingNow={model.recordingNow}
            avatar={<Avatar name={person.name} size={40} />}
          />

          <DayStats stats={model.stats} />

          <DayTabs panel={panel} date={date} basePath={`/people/${userId}`} />

          <DayPanels
            panel={panel}
            model={model}
            weekStrip={
              trends ? (
                <WeekStrip days={weekStrip(date, trends.days, dayOf(new Date()))} />
              ) : undefined
            }
            apps={<DayAppUsage usage={appUsage} />}
            screenshots={<ScreenshotsPanel shots={screenshots.map(toScreenshotView)} />}
            mix={categoryMix(samples)}
            idle={idleRows(idle)}
          />
        </div>
      )}
    </>
  );
}
