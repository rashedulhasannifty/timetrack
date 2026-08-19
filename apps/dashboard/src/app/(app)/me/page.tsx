import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';
import { personDayView, resolveDayDate } from '../../../lib/person-day-view';
import { idlePeriodRows } from '../../../lib/idle-view';
import { selfApprovals } from '../../../lib/approvals-view';
import { Card } from '../../../components/ui/Card';
import { SectionHeader } from '../../../components/ui/SectionHeader';
import { Tabs } from '../../../components/ui/Tabs';
import { DayHeader } from '../../../components/day/DayHeader';
import { DayStats } from '../../../components/day/DayStats';
import { TimeRibbon } from '../../../components/day/TimeRibbon';
import { ActivityBars } from '../../../components/day/ActivityBars';
import { TimeEntriesList } from '../../../components/day/TimeEntriesList';
import { DayAppUsage } from '../../../components/day/DayAppUsage';
import { IdlePeriods } from '../../../components/day/IdlePeriods';
import { ScreenshotsPanel } from './ScreenshotsPanel';
import { toScreenshotView } from './screenshot-view';
import { redactScreenshotAction } from './actions';
import { ApprovalsPanel } from './ApprovalsPanel';
import type {
  ActivitySample,
  IdleEvent,
  Project,
  Screenshot,
  TeamAppUsage,
  TimeEntry,
  TimesheetApproval,
} from '@timetrack/contracts';

const TABS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'activity', label: 'Activity' },
  { key: 'screenshots', label: 'Screenshots' },
  { key: 'idle', label: 'Idle' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/**
 * PRD §4.3 / §11 — the employee self-view. Same API as the manager view, scoped to self.
 * Date-aware: `?date=YYYY-MM-DD` selects the day rendered below; invalid/missing falls back to
 * today (UTC). `?tab=` selects the panel.
 *
 * Tabbed rather than stacked, unlike the manager's per-person page: the self view is read one
 * question at a time ("what did I do", "how busy was I", "what was captured", "what was idle"),
 * and the URL carries the answer so every panel stays server-rendered.
 */
export default async function MyDataPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const { date: rawDate, tab: rawTab } = await searchParams;
  const date = resolveDayDate(rawDate, new Date());
  const tab: Tab = TABS.some((t) => t.key === rawTab) ? (rawTab as Tab) : 'timeline';

  const todayParams = new URLSearchParams({
    userId: session.userId,
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
  });

  // Self-scoped; each read is independent — a failure in one degrades to an empty panel.
  const [entries, samples, screenshots, approvals, projects, appUsage, idleEvents] =
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
      api.listIdleEvents(session.accessToken, todayParams).catch((): IdleEvent[] => []),
    ]);

  const myApprovals = selfApprovals(approvals, session.userId);

  const model = personDayView({
    date,
    now: new Date(),
    isSelf: true,
    subjectName: 'My time',
    entries,
    samples,
    screenshots,
    projects,
  });

  const hrefFor = (key: Tab) => {
    const q = new URLSearchParams({ date });
    if (key !== 'timeline') q.set('tab', key);
    return `/me?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <DayHeader
        date={model.date}
        subjectName={model.subjectName}
        isSelf={model.isSelf}
        isToday={model.isToday}
        recordingNow={model.recordingNow}
      />

      <ApprovalsPanel rows={myApprovals} />

      <DayStats stats={model.stats} entryCount={model.entries.length} />

      <Tabs
        label="My time sections"
        items={TABS.map((t) => ({ href: hrefFor(t.key), label: t.label }))}
        activeHref={hrefFor(tab)}
      />

      {tab === 'timeline' ? (
        <Card padding="md" className="flex flex-col gap-5">
          <TimeRibbon ribbon={model.ribbon} />
          <TimeEntriesList entries={model.entries} />
        </Card>
      ) : null}

      {tab === 'activity' ? (
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
          <Card padding="md" className="flex flex-col gap-3.5">
            <SectionHeader label="Active minutes" note="keyboard &amp; mouse" />
            <ActivityBars buckets={model.activityBuckets} />
          </Card>
          <Card padding="md" className="flex flex-col gap-3.5">
            <SectionHeader label="Your apps &amp; sites" />
            <DayAppUsage usage={appUsage} />
          </Card>
        </div>
      ) : null}

      {tab === 'screenshots' ? (
        <Card padding="md" className="flex flex-col gap-3.5">
          <SectionHeader label="Screenshots" note="Blurred · you can redact any of your own" />
          <ScreenshotsPanel
            shots={screenshots.map(toScreenshotView)}
            onRedact={redactScreenshotAction}
          />
        </Card>
      ) : null}

      {tab === 'idle' ? (
        <Card padding="md" className="flex flex-col gap-3.5">
          <SectionHeader label="Idle periods" note="Over the team's idle threshold" />
          <p className="text-text-secondary text-caption m-0 max-w-[62ch]">
            Each period was answered on your Mac, in the prompt that appears when you come back.
            Nothing is deleted either way.
          </p>
          <IdlePeriods rows={idlePeriodRows(idleEvents)} />
        </Card>
      ) : null}
    </div>
  );
}
