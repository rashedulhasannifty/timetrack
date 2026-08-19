import type {
  ProjectSummary,
  TeamActivity,
  TeamAppUsage,
  TeamOverviewRow,
  TeamSummary,
  TeamTrends,
} from '@timetrack/contracts';
import { Card } from '../../../components/ui/Card';
import { SectionHeader } from '../../../components/ui/SectionHeader';
import { Tabs } from '../../../components/ui/Tabs';
import { Avatar } from '../../../components/ui/Avatar';
import { LineChart } from '../../../components/charts/LineChart';
import { AppUsageList } from '../../../components/overview/AppUsageList';
import { PeopleTable } from '../../../components/overview/PeopleTable';
import { WidgetVisibilityProvider } from '../../../components/overview/WidgetVisibilityProvider';
import { Widget } from '../../../components/overview/Widget';
import { WidgetsDrawer, type WidgetGroup } from '../../../components/overview/WidgetsDrawer';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { defaultReportRange } from '../../../lib/reports-view';
import { formatDuration } from '../../../lib/format';
import {
  appUsageByCategory,
  haventTracked,
  overviewKpis,
  peopleTableRows,
  projectBars,
  teamCategoryKpis,
  teamIdleKpi,
  trendsToHoursLine,
} from '../../../lib/overview-view';

const GROUPS: WidgetGroup[] = [
  {
    label: 'Overview',
    items: [
      { id: 'period', label: 'This period' },
      { id: 'havent', label: 'Haven’t tracked' },
    ],
  },
  {
    label: 'Detail',
    items: [
      { id: 'people', label: 'People' },
      { id: 'projects', label: 'Projects' },
      { id: 'apps', label: 'Apps & websites' },
    ],
  },
];

// Which slice of the app-usage rollup the "Apps & websites" panel is showing. The URL carries
// it so the panel behind the tabs stays a Server Component.
const APP_TABS = [
  { key: 'all', label: 'All' },
  { key: 'unproductive', label: 'Unproductive' },
  { key: 'unrated', label: 'Unrated' },
] as const;
type AppTab = (typeof APP_TABS)[number]['key'];

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; apps?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const fb = defaultReportRange(new Date());
  const from = sp.from ?? fb.from;
  const to = sp.to ?? fb.to;
  const params = new URLSearchParams({ from, to });
  const appTab: AppTab = APP_TABS.some((t) => t.key === sp.apps) ? (sp.apps as AppTab) : 'all';

  let team: TeamSummary | null = null;
  let projects: ProjectSummary | null = null;
  let trends: TeamTrends | null = null;
  let activity: TeamActivity | null = null;
  let apps: TeamAppUsage | null = null;

  // Fetch every panel's source independently: one endpoint failing (a 500 or a timeout)
  // degrades only its own card to an empty state instead of blanking the whole dashboard. The
  // team-scoped calls share one authorization gate, so a 403 on the canonical team summary
  // means the viewer can't see the overview at all.
  const [teamR, projectsR, trendsR, activityR, appsR] = await Promise.allSettled([
    api.teamSummary(session.accessToken, params),
    api.projectSummary(session.accessToken, params),
    api.trends(session.accessToken, params),
    api.teamActivity(session.accessToken, params),
    api.appUsage(session.accessToken, params),
  ]);

  const forbidden =
    teamR.status === 'rejected' && teamR.reason instanceof ApiError && teamR.reason.status === 403;

  if (teamR.status === 'fulfilled') team = teamR.value;
  if (projectsR.status === 'fulfilled') projects = projectsR.value;
  if (trendsR.status === 'fulfilled') trends = trendsR.value;
  if (activityR.status === 'fulfilled') activity = activityR.value;
  if (appsR.status === 'fulfilled') apps = appsR.value;

  let overviewRows: TeamOverviewRow[] = [];
  try {
    overviewRows = (await api.teamOverview(session.accessToken)).rows;
  } catch {
    overviewRows = [];
  }

  const kpis = overviewKpis(team?.rows ?? [], overviewRows);
  const cat = teamCategoryKpis(trends ?? { from, to, days: [] });
  const idle = teamIdleKpi(activity ?? { from, to, rows: [] });
  const hoursLine = trendsToHoursLine(trends ?? { from, to, days: [] });
  const people = peopleTableRows(team?.rows ?? [], activity?.rows ?? [], overviewRows);
  const bars = projectBars(projects?.rows ?? []);
  const appLists = appUsageByCategory(apps ?? { from, to, rows: [] });
  const appItems =
    appTab === 'unproductive'
      ? appLists.unproductive
      : appTab === 'unrated'
        ? appLists.unrated
        : appLists.topUsed;
  const notTracked = haventTracked(overviewRows);
  const trackingNow = overviewRows.filter((r) => r.tracking).map((r) => r.name);
  const hasData = (team?.rows.length ?? 0) > 0 || (projects?.rows.length ?? 0) > 0;

  const rangeQuery = (tab: AppTab) => {
    const q = new URLSearchParams({ from, to });
    if (tab !== 'all') q.set('apps', tab);
    return `/overview?${q.toString()}`;
  };

  if (forbidden) {
    return (
      <p className="text-text-secondary text-body">
        You’re not permitted to view the team overview.
      </p>
    );
  }
  if (!hasData) {
    return <p className="text-text-secondary text-body">No team activity in this range.</p>;
  }

  return (
    <WidgetVisibilityProvider>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <WidgetsDrawer groups={GROUPS} />
          <ReportRangePicker from={from} to={to} basePath="/overview" />
        </div>

        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))] xl:[grid-template-columns:1fr_360px]">
          <Widget id="period">
            <Card padding="md" className="h-full">
              <SectionHeader
                label="This period"
                note={`${hoursLine.values.length} days · ${kpis.activeUsers} active`}
              />
              {/* Four numbers, each behind a rule rather than in its own box: the handoff reads
                  them as one statement about the period, not four unrelated tiles. */}
              <div className="mt-4 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]">
                <Kpi
                  label="Time tracked"
                  value={formatDuration(kpis.totalSeconds)}
                  note={`${kpis.activeUsers} of ${team?.rows.length ?? 0} people`}
                />
                <Kpi
                  label="Productive"
                  value={`${cat.productivePct}%`}
                  note="of categorized time"
                />
                <Kpi label="Idle" value={`${idle.idlePct}%`} note="of active + idle" />
                <Kpi
                  label="Tracking now"
                  value={`${kpis.tracking} / ${team?.rows.length ?? 0}`}
                  note={trackingNow.length > 0 ? trackingNow.join(', ') : 'nobody right now'}
                />
              </div>
              <div className="border-separator mt-[18px] border-t pt-4">
                <h3 className="text-caption text-text-secondary mb-2">Hours per day</h3>
                <LineChart
                  values={hoursLine.values}
                  max={hoursLine.max}
                  axis={hoursLine.axis}
                  dayLetters={hoursLine.dayLetters}
                  labels={hoursLine.labels}
                  color="var(--tt-accent)"
                  unit="h"
                />
              </div>
            </Card>
          </Widget>

          <Widget id="havent">
            <Card padding="md" className="h-full">
              <SectionHeader label="Haven’t tracked" />
              <p className="text-caption text-text-secondary mb-3.5 mt-1">
                Nobody on the team has logged time for these people today.
              </p>
              {notTracked.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {notTracked.map((row) => (
                    <li
                      key={row.userId}
                      className="border-separator flex items-center gap-2.5 border-t py-2.5"
                    >
                      <Avatar name={row.name} size={26} />
                      <span className="text-text flex-1 text-[13px] font-medium">{row.name}</span>
                      <a href={`/people/${row.userId}`} className="text-caption whitespace-nowrap">
                        View day
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-text-secondary text-body">Everyone tracked time today.</p>
              )}
            </Card>
          </Widget>
        </div>

        <Widget id="people">
          <Card padding="none" className="overflow-hidden">
            <div className="border-separator flex items-center gap-3 border-b px-[22px] py-4">
              <SectionHeader
                label="People"
                note="Sorted by tracked time · open a row for the day view"
              />
            </div>
            <PeopleTable rows={people} />
          </Card>
        </Widget>

        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
          <Widget id="projects">
            <Card padding="md" className="h-full">
              <SectionHeader
                label="Projects"
                action={
                  <a href={`/projects?from=${from}&to=${to}`} className="text-caption">
                    Projects report
                  </a>
                }
              />
              {bars.length > 0 ? (
                <div className="mt-4 flex flex-col gap-3.5">
                  {bars.map((p) => (
                    <div key={p.key} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-text flex-1 truncate text-[13px]">{p.name}</span>
                        <span className="tt-numeric text-text-secondary text-[13px]">
                          {formatDuration(p.trackedSeconds)}
                        </span>
                        <span className="tt-numeric text-text-secondary text-caption w-9 text-right">
                          {p.sharePct}%
                        </span>
                      </div>
                      <div className="bg-separator h-2 overflow-hidden rounded-[2px]">
                        <div
                          className="h-full"
                          style={{ width: `${p.widthPct}%`, background: p.color, opacity: 0.85 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-text-secondary text-body mt-4">No project data in this range.</p>
              )}
            </Card>
          </Widget>

          <Widget id="apps">
            <Card padding="md" className="h-full">
              <SectionHeader
                label="Apps &amp; websites"
                action={
                  <Tabs
                    label="App usage category"
                    tone="sunken"
                    activeHref={rangeQuery(appTab)}
                    items={APP_TABS.map((t) => ({ href: rangeQuery(t.key), label: t.label }))}
                  />
                }
              />
              <div className="mt-4">
                <AppUsageList items={appItems} />
              </div>
            </Card>
          </Widget>
        </div>
      </div>
    </WidgetVisibilityProvider>
  );
}

/** One number in the "This period" card: rule, label, figure, and the line that qualifies it. */
function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-separator flex flex-col gap-1 border-l pl-3.5">
      <span className="text-caption text-text-secondary">{label}</span>
      <span className="tt-numeric text-[26px] font-semibold leading-[1.1] tracking-[-0.02em]">
        {value}
      </span>
      <span className="text-caption text-text-secondary truncate">{note}</span>
    </div>
  );
}
