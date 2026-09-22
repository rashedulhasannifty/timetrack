import type { ReactNode } from 'react';
import { dayOf } from '@timetrack/contracts';
import { Avatar } from '../ui/Avatar';
import { DayHeader } from '../day/DayHeader';
import { DayStats } from '../day/DayStats';
import { DayTabs, resolveDayPanel, type DayPanel } from '../day/DayTabs';
import { DayPanels } from '../day/DayPanels';
import { AddTimeEntryForm } from '../day/AddTimeEntryForm';
import { EntryRowActions } from '../day/EntryRowActions';
import { DayAppUsage } from '../day/DayAppUsage';
import { WeekStrip } from '../day/WeekStrip';
import { api } from '../../lib/api-client';
import {
  dayRangeFor,
  personDayView,
  resolveDayDate,
  weekRangeFor,
  weekStrip,
} from '../../lib/person-day-view';
import { categoryMix, idleRows } from '../../lib/idle-view';
import { ScreenshotsPanel } from '../../app/(app)/me/ScreenshotsPanel';
import { toScreenshotView } from '../../app/(app)/me/screenshot-view';
import type {
  ActivitySample,
  IdleEvent,
  Project,
  Screenshot,
  TeamAppUsage,
  TeamTrends,
  TimeEntry,
} from '@timetrack/contracts';

/**
 * One person's day, fetched once and rendered by BOTH `people/[userId]/page.tsx` (a direct
 * load) and the drawer that intercepts the same URL from Overview — so the two can never
 * disagree about what a person's day shows.
 *
 * Split into a loader and a view rather than one async component because each caller needs
 * the person's name for its own chrome (the page's header title, the drawer's title bar),
 * and that must come from the same single fetch rather than a second one per caller.
 * Server-only: the token is used here and never reaches the browser.
 */
export type PersonDay = Awaited<ReturnType<typeof loadPersonDay>>;

export async function loadPersonDay({
  token,
  userId,
  rawDate,
  rawPanel,
}: {
  token: string;
  userId: string;
  rawDate: string | undefined;
  rawPanel: string | undefined;
}) {
  const date = resolveDayDate(rawDate, new Date());
  const panel: DayPanel = resolveDayPanel(rawPanel);

  const dayRange = dayRangeFor(date);
  const search = new URLSearchParams({
    userId,
    from: dayRange.from,
    to: dayRange.to,
  });

  let entries: TimeEntry[] | null = null;
  try {
    // The API enforces manager-owns-team; a 403 on this read becomes the not-authorized state.
    entries = await api.listTimeEntries(token, search);
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
    api.listActivitySamples(token, search).catch((): ActivitySample[] => []),
    api.listScreenshots(token, search).catch((): Screenshot[] => []),
    // Names for the entries. Team-scoped to the caller, so this resolves for the common
    // manager-owns-team view; a cross-team admin view degrades to "Untitled entry" per entry.
    api.listProjects(token, { includeArchived: true }).catch((): Project[] => []),
    // `search` already carries userId + the day window, which is what app-usage wants; the
    // API re-checks manager-owns-team on that userId and 403s if it doesn't hold.
    api.appUsage(token, search).catch((): TeamAppUsage | null => null),
    api.trends(token, weekSearch).catch((): TeamTrends | null => null),
    // Same manager-owns-team gate as the rest (ResourceScope on ?userId=). Read-only here:
    // POST /idle-events attributes the row to the caller, so only the person themselves can
    // resolve one, from their own My time page.
    api.listIdleEvents(token, search).catch((): IdleEvent[] => []),
  ]);

  // Decorative header data only — never let a lookup failure crash the page.
  let person = { name: 'Team member' };
  try {
    const ov = await api.teamOverview(token);
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

  return {
    userId,
    date,
    panel,
    personName: person.name,
    /** What the page header / drawer title shows: the name, or a neutral label when the
     *  entries read was refused (not-permitted state). */
    title: entries === null ? 'Person' : person.name,
    model,
    samples,
    screenshots,
    projects,
    appUsage,
    trends,
    idle,
  };
}

/**
 * The day view body. `lead` is rendered first inside the day column — the full page passes its
 * "← Back" link there; the drawer passes nothing because it has its own close button.
 */
export function PersonDayContent({ day, lead }: { day: PersonDay; lead?: ReactNode }) {
  const {
    userId,
    date,
    panel,
    personName,
    model,
    samples,
    screenshots,
    projects,
    appUsage,
    trends,
    idle,
  } = day;

  return model === null ? (
    <p className="text-text-secondary text-body">You’re not permitted to view this person.</p>
  ) : (
    <div className="flex flex-col gap-5">
      {lead}

      <DayHeader
        date={date}
        subjectName={personName}
        isSelf={false}
        isToday={model.isToday}
        recordingNow={model.recordingNow}
        avatar={<Avatar name={personName} size={40} />}
      />

      <DayStats stats={model.stats} />

      <DayTabs panel={panel} date={date} basePath={`/people/${userId}`} />

      <DayPanels
        panel={panel}
        model={model}
        weekStrip={
          trends ? <WeekStrip days={weekStrip(date, trends.days, dayOf(new Date()))} /> : undefined
        }
        apps={<DayAppUsage usage={appUsage} />}
        screenshots={<ScreenshotsPanel shots={screenshots.map(toScreenshotView)} />}
        mix={categoryMix(samples)}
        idle={idleRows(idle)}
        // A manager correcting a team member's day. Carried explicitly as userId, and
        // authorized by the API through the same self / manager-of-team / admin rule an
        // edit uses — an employee reaching this page for someone else gets a 403, not a
        // hidden button. Every write here is audited against the manager, not the member.
        addEntry={<AddTimeEntryForm day={date} projects={projects} userId={userId} />}
        entryAction={(entry) => (
          <EntryRowActions entry={entry} day={date} projects={projects} userId={userId} />
        )}
      />
    </div>
  );
}
