import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../lib/redirect';
import type {
  ProjectSummary,
  TeamActivity,
  TeamAppUsage,
  TeamOverviewRow,
  TeamSummary,
  TeamTrends,
} from '@timetrack/contracts';
import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { StatCard } from '../../../components/ui/StatCard';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
import { HeroPanel, HeroDelta } from '../../../components/ui/HeroPanel';
import { Button } from '../../../components/ui/Button';
import { StackedDayBars } from '../../../components/charts/StackedDayBars';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { DayColumnsChart } from '../../../components/overview/DayColumnsChart';
import { AttentionPanel } from '../../../components/overview/AttentionPanel';
import { PeopleTable } from '../../../components/overview/PeopleTable';
import { ProjectShareList } from '../../../components/overview/ProjectShareList';
import { AppUsageTabs } from '../../../components/overview/AppUsageTabs';
import { WidgetVisibilityProvider } from '../../../components/overview/WidgetVisibilityProvider';
import { Widget } from '../../../components/overview/Widget';
import { WidgetsDrawer, type WidgetGroup } from '../../../components/overview/WidgetsDrawer';
import { IconApprovals, IconClock, IconTeam } from '../../../components/ui/icons';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { defaultReportRange } from '../../../lib/reports-view';
import { formatDuration } from '../../../lib/format';
import {
  appUsageByCategory,
  attentionItems,
  heroTotals,
  overviewKpis,
  personRows,
  previousRange,
  projectShares,
  teamCategoryKpis,
  teamIdleKpi,
  trendsToDayColumns,
  trendsToProductivityBars,
} from '../../../lib/overview-view';

// Widget ids are persisted per user in localStorage['tt-widgets'] as a hidden-map. The
// redesign retired `havent`, `apps-used`, `apps-unproductive`, `apps-unrated` and the five
// `top-*` ids, and added `attention`, `people` and `apps`. Stale keys are simply ignored and
// the new widgets default to visible, so an existing preference degrades to "everything on"
// rather than breaking -- but someone who had hidden `top-idle` will see its replacement.
const GROUPS: WidgetGroup[] = [
  { label: 'Overview', items: [{ id: 'kpis', label: 'Headline + KPI tiles' }] },
  {
    label: 'Trends',
    items: [
      { id: 'trend-hours', label: 'Hours per day' },
      { id: 'attention', label: 'Needs attention' },
      { id: 'trend-productivity', label: 'Productivity % per day' },
    ],
  },
  { label: 'Team', items: [{ id: 'people', label: 'People' }] },
  {
    label: 'Latest data',
    items: [
      { id: 'projects', label: 'Projects' },
      { id: 'apps', label: 'Apps & websites' },
    ],
  },
];

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getSession();
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo('/overview'));

  const sp = await searchParams;
  const fb = defaultReportRange(new Date());
  const from = sp.from ?? fb.from;
  const to = sp.to ?? fb.to;
  const params = new URLSearchParams({ from, to });
  const prev = previousRange(from, to);
  const prevParams = new URLSearchParams({ from: prev.from, to: prev.to });

  let team: TeamSummary | null = null;
  let previousTeam: TeamSummary | null = null;
  let projects: ProjectSummary | null = null;
  let trends: TeamTrends | null = null;
  let activity: TeamActivity | null = null;
  let apps: TeamAppUsage | null = null;
  let pendingApprovals = 0;

  // Fetch every widget's source independently: one endpoint failing (a 500 or
  // a timeout) degrades only its own card to an empty state instead of blanking
  // the whole dashboard. The team-scoped calls share one authorization gate, so
  // a 403 on the canonical team summary means the viewer can't see the overview
  // at all. The second team-summary call is the previous window, for the hero's
  // period-over-period delta; if it fails the headline simply omits the delta.
  const [teamR, prevTeamR, projectsR, trendsR, activityR, appsR, approvalsR] =
    await Promise.allSettled([
      api.teamSummary(session.accessToken, params),
      api.teamSummary(session.accessToken, prevParams),
      api.projectSummary(session.accessToken, params),
      api.trends(session.accessToken, params),
      api.teamActivity(session.accessToken, params),
      api.appUsage(session.accessToken, params),
      api.listApprovals(session.accessToken, new URLSearchParams({ status: 'PENDING' })),
    ]);

  const forbidden =
    teamR.status === 'rejected' && teamR.reason instanceof ApiError && teamR.reason.status === 403;

  if (teamR.status === 'fulfilled') team = teamR.value;
  if (prevTeamR.status === 'fulfilled') previousTeam = prevTeamR.value;
  if (projectsR.status === 'fulfilled') projects = projectsR.value;
  if (trendsR.status === 'fulfilled') trends = trendsR.value;
  if (activityR.status === 'fulfilled') activity = activityR.value;
  if (appsR.status === 'fulfilled') apps = appsR.value;
  if (approvalsR.status === 'fulfilled') pendingApprovals = approvalsR.value.length;

  let overviewRows: TeamOverviewRow[] = [];
  try {
    overviewRows = (await api.teamOverview(session.accessToken)).rows;
  } catch {
    overviewRows = [];
  }

  const emptyTrends: TeamTrends = { from, to, days: [] };
  const emptyActivity: TeamActivity = { from, to, rows: [] };
  const emptyApps: TeamAppUsage = { from, to, rows: [] };

  const kpis = overviewKpis(team?.rows ?? [], overviewRows);
  const hero = heroTotals(team?.rows ?? [], previousTeam?.rows ?? null);
  const cat = teamCategoryKpis(trends ?? emptyTrends);
  const idle = teamIdleKpi(activity ?? emptyActivity);
  const days = trendsToDayColumns(trends ?? emptyTrends);
  const prodBars = trendsToProductivityBars(trends ?? emptyTrends);
  const people = personRows(team?.rows ?? [], activity ?? emptyActivity, overviewRows);
  const shares = projectShares(projects?.rows ?? []);
  const appLists = appUsageByCategory(apps ?? emptyApps);
  const attention = attentionItems({
    overview: overviewRows,
    activity: activity ?? emptyActivity,
    apps: apps ?? emptyApps,
    pendingApprovals,
  });
  const trackingNames = overviewRows
    .filter((r) => r.tracking)
    .map((r) => r.name.split(' ')[0])
    .slice(0, 3)
    .join(', ');
  const hasData = (team?.rows.length ?? 0) > 0 || (projects?.rows.length ?? 0) > 0;

  return (
    <>
      <SetPageTitle title="Overview" />
      {forbidden ? (
        <p className="text-text-secondary text-body">
          You’re not permitted to view the team overview.
        </p>
      ) : !hasData ? (
        <EmptyOverview />
      ) : (
        <WidgetVisibilityProvider>
          <div className="flex flex-col gap-[30px]">
            <div className="flex items-center justify-between gap-3">
              <WidgetsDrawer groups={GROUPS} />
              <ReportRangePicker from={from} to={to} basePath="/overview" />
            </div>

            <Widget id="kpis">
              <div className="grid gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))] xl:[grid-template-columns:400px_1fr]">
                <HeroPanel
                  label="Team time this period"
                  footer={
                    hero.deltaPct === null ? (
                      <HeroDelta note="no comparable previous period">—</HeroDelta>
                    ) : (
                      <HeroDelta note="vs the previous period">
                        {hero.deltaPct >= 0 ? '↑' : '↓'} {Math.abs(hero.deltaPct)}%
                      </HeroDelta>
                    )
                  }
                >
                  <span className="tt-numeric mt-2 text-display font-extrabold tracking-[-0.045em]">
                    {formatDuration(hero.totalSeconds)}
                  </span>
                </HeroPanel>

                <div className="grid gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
                  <StatCard
                    label="Productive"
                    value={`${cat.productivePct}%`}
                    icon={<IconApprovals width={14} height={14} />}
                    delta={{ text: `${cat.unproductivePct}% unproductive`, tone: 'flat' }}
                    bar={{
                      pct: cat.productivePct,
                      color: 'var(--tt-accent)',
                      caption: 'of categorized time',
                    }}
                  />
                  <StatCard
                    label="Idle"
                    value={`${idle.idlePct}%`}
                    icon={<IconClock width={14} height={14} />}
                    delta={{ text: 'of active + idle time', tone: 'flat' }}
                    bar={{
                      pct: idle.idlePct,
                      color: 'var(--tt-category-unproductive)',
                      caption: 'of active + idle',
                    }}
                  />
                  <StatCard
                    label="Tracking now"
                    value={`${kpis.tracking}/${kpis.activeUsers || people.length}`}
                    icon={<IconTeam width={14} height={14} />}
                    delta={{ text: trackingNames || 'nobody right now', tone: 'flat' }}
                    bar={{
                      pct: people.length === 0 ? 0 : (kpis.tracking / people.length) * 100,
                      color: 'var(--tt-accent)',
                      caption: `${formatDuration(kpis.totalSeconds)} tracked`,
                    }}
                  />
                </div>
              </div>
            </Widget>

            <div className="grid items-start gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))] xl:[grid-template-columns:1fr_350px]">
              <Widget id="trend-hours">
                <Card padding="md" className="h-full">
                  <div className="mb-[18px] flex items-baseline justify-between gap-3">
                    <div className="flex flex-col gap-px">
                      <span className="text-h3 font-bold">Hours per day</span>
                      <span className="tt-numeric text-text-secondary text-caption">
                        peak {days.peakHours}h · average {days.averageHours}h
                      </span>
                    </div>
                    <div className="text-text-secondary text-micro flex gap-3.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="bg-accent h-2 w-2 rounded-[2px]" />
                        Weekday
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="bg-separator h-2 w-2 rounded-[2px]" />
                        Weekend
                      </span>
                    </div>
                  </div>
                  <DayColumnsChart columns={days.columns} />
                  <div className="tt-numeric text-neutral mt-2.5 flex justify-between text-micro">
                    {days.axisLabels.map((l) => (
                      <span key={l}>{l}</span>
                    ))}
                  </div>
                </Card>
              </Widget>

              <Widget id="attention">
                <Card padding="md" className="h-full">
                  <CardTitle
                    className="mb-1.5"
                    action={
                      attention.length > 0 ? (
                        <span className="tt-numeric bg-tint text-accent text-caption rounded-full px-2.5 py-0.5 font-bold">
                          {attention.length}
                        </span>
                      ) : undefined
                    }
                  >
                    Needs attention
                  </CardTitle>
                  <AttentionPanel items={attention} />
                </Card>
              </Widget>
            </div>

            <Widget id="people">
              <Card padding="none" className="overflow-hidden">
                <CardHeader
                  title="People"
                  note="click a row for the day view"
                  action={
                    <Button href="/reports" variant="secondary" size="sm">
                      Full report
                    </Button>
                  }
                />
                <PeopleTable rows={people} />
              </Card>
            </Widget>

            <div className="grid items-start gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
              <Widget id="projects">
                <Card padding="md" className="h-full">
                  <CardTitle
                    className="mb-2"
                    action={
                      <a href="/reports" className="text-caption font-bold">
                        Full report →
                      </a>
                    }
                  >
                    Projects
                  </CardTitle>
                  <ProjectShareList shares={shares.shares} />
                </Card>
              </Widget>
              <Widget id="apps">
                <Card padding="md" className="h-full">
                  <AppUsageTabs
                    lists={{
                      All: appLists.topUsed,
                      Unproductive: appLists.unproductive,
                      Unrated: appLists.unrated,
                    }}
                  />
                </Card>
              </Widget>
            </div>

            <Widget id="trend-productivity">
              <Card padding="md">
                <CardTitle className="mb-1">Productivity % per day</CardTitle>
                <p className="text-caption text-text-secondary mb-3.5">
                  Teal: productive share of categorized time. Remainder: neutral + unproductive.
                </p>
                <StackedDayBars values={prodBars.values} dayLetters={prodBars.dayLetters} />
              </Card>
            </Widget>
          </div>
        </WidgetVisibilityProvider>
      )}
    </>
  );
}

/** First-run state: nothing has been tracked yet, so say what to do rather than showing zeros. */
function EmptyOverview() {
  return (
    <div className="flex flex-col items-center gap-3.5 px-10 py-[110px] text-center">
      <span className="bg-tint inline-flex h-14 w-14 items-center justify-center rounded-[18px]">
        <IconClock width={26} height={26} className="text-accent" />
      </span>
      <span className="text-h2 font-extrabold tracking-[-0.02em]">No time tracked yet</span>
      <span className="text-text-secondary max-w-[400px] text-[13.5px] leading-relaxed text-pretty">
        Numbers appear here as soon as someone starts the Mac app. Invite your team, or start your
        own timer to see how it works.
      </span>
      <div className="mt-1.5 flex gap-2.5">
        <Button href="/admin/users" variant="primary" size="md">
          Invite your team
        </Button>
        <Button href="/install" variant="secondary" size="md">
          Install the Mac app
        </Button>
      </div>
    </div>
  );
}
