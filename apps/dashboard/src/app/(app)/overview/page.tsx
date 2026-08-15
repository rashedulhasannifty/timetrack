import type {
  ProjectSummary,
  TeamActivity,
  TeamAppUsage,
  TeamOverviewRow,
  TeamSummary,
  TeamTrends,
} from '@timetrack/contracts';
import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { SectionHeader } from '../../../components/ui/SectionHeader';
import { StatCard } from '../../../components/ui/StatCard';
import { Card } from '../../../components/ui/Card';
import { Avatar } from '../../../components/ui/Avatar';
import { DonutChart } from '../../../components/charts/DonutChart';
import { Gauge } from '../../../components/charts/Gauge';
import { BarMeter } from '../../../components/charts/BarMeter';
import { LineChart } from '../../../components/charts/LineChart';
import { StackedDayBars } from '../../../components/charts/StackedDayBars';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { AppUsageList } from '../../../components/overview/AppUsageList';
import { WidgetVisibilityProvider } from '../../../components/overview/WidgetVisibilityProvider';
import { Widget } from '../../../components/overview/Widget';
import { WidgetsDrawer, type WidgetGroup } from '../../../components/overview/WidgetsDrawer';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { defaultReportRange } from '../../../lib/reports-view';
import { formatDuration } from '../../../lib/format';
import {
  appUsageByCategory,
  donutFromProjects,
  haventTracked,
  overviewKpis,
  teamCategoryKpis,
  teamIdleKpi,
  topByActivity,
  topByHours,
  topByIdle,
  topByProductive,
  topByUnproductive,
  trendsToHoursLine,
  trendsToProductivityBars,
} from '../../../lib/overview-view';

const GROUPS: WidgetGroup[] = [
  { label: 'Overview', items: [{ id: 'kpis', label: 'KPI tiles' }] },
  {
    label: 'Trends',
    items: [
      { id: 'trend-hours', label: 'Hours tracked' },
      { id: 'trend-productivity', label: 'Productivity %' },
    ],
  },
  {
    label: 'Latest data',
    items: [
      { id: 'projects', label: 'Top projects' },
      { id: 'havent', label: 'Haven’t tracked' },
    ],
  },
  {
    label: 'Top users',
    items: [
      { id: 'top-hours', label: 'Tracked most hours' },
      { id: 'top-activity', label: 'Highest activity %' },
      { id: 'top-productive', label: 'Highest productive %' },
      { id: 'top-unproductive', label: 'Highest unproductive %' },
      { id: 'top-idle', label: 'Highest idle %' },
    ],
  },
  {
    label: 'Websites & applications',
    items: [
      { id: 'apps-used', label: 'Top used' },
      { id: 'apps-unproductive', label: 'Top unproductive' },
      { id: 'apps-unrated', label: 'Top unrated' },
    ],
  },
];

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const fb = defaultReportRange(new Date());
  const from = sp.from ?? fb.from;
  const to = sp.to ?? fb.to;
  const params = new URLSearchParams({ from, to });

  let team: TeamSummary | null = null;
  let projects: ProjectSummary | null = null;
  let trends: TeamTrends | null = null;
  let activity: TeamActivity | null = null;
  let apps: TeamAppUsage | null = null;

  // Fetch every widget's source independently: one endpoint failing (a 500 or
  // a timeout) degrades only its own card to an empty state instead of blanking
  // the whole dashboard. The team-scoped calls share one authorization gate, so
  // a 403 on the canonical team summary means the viewer can't see the overview
  // at all.
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
  const donut = donutFromProjects(projects?.rows ?? []);
  const hoursLine = trendsToHoursLine(trends ?? { from, to, days: [] });
  const prodBars = trendsToProductivityBars(trends ?? { from, to, days: [] });
  const topHours = topByHours(team?.rows ?? []);
  const topActivity = topByActivity(team?.rows ?? []);
  const topProd = topByProductive(activity ?? { from, to, rows: [] });
  const topUnprod = topByUnproductive(activity ?? { from, to, rows: [] });
  const topIdle = topByIdle(activity ?? { from, to, rows: [] });
  const appLists = appUsageByCategory(apps ?? { from, to, rows: [] });
  const notTracked = haventTracked(overviewRows);
  const hasData = (team?.rows.length ?? 0) > 0 || (projects?.rows.length ?? 0) > 0;

  return (
    <>
      <SetPageTitle title="Overview" />
      {forbidden ? (
        <p className="text-text-secondary text-body">
          You’re not permitted to view the team overview.
        </p>
      ) : !hasData ? (
        <p className="text-text-secondary text-body">No team activity in this range.</p>
      ) : (
        <WidgetVisibilityProvider>
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3">
              <WidgetsDrawer groups={GROUPS} />
              <ReportRangePicker from={from} to={to} basePath="/" />
            </div>

            <Widget id="kpis">
              <section className="flex flex-col gap-3">
                <SectionHeader label="Overview" />
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
                  <StatCard label="Time tracked" value={formatDuration(kpis.totalSeconds)} />
                  <StatCard label="Active users" value={String(kpis.activeUsers)} />
                  <StatCard label="Currently tracking" value={String(kpis.tracking)} />
                  <StatCard
                    label="Productive"
                    value={`${cat.productivePct}%`}
                    bar={{
                      pct: cat.productivePct,
                      color: 'var(--tt-good)',
                      caption: 'of categorized time',
                    }}
                  />
                  <StatCard
                    label="Unproductive"
                    value={`${cat.unproductivePct}%`}
                    bar={{
                      pct: cat.unproductivePct,
                      color: 'var(--tt-category-unproductive)',
                      caption: 'of categorized time',
                    }}
                  />
                  <StatCard
                    label="Idle"
                    value={`${idle.idlePct}%`}
                    bar={{
                      pct: idle.idlePct,
                      color: 'var(--tt-text-secondary)',
                      caption: 'of active + idle',
                    }}
                  />
                </div>
              </section>
            </Widget>

            <section className="flex flex-col gap-3">
              <SectionHeader label="Trends" />
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
                <Widget id="trend-hours">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Hours tracked
                    </h3>
                    <LineChart
                      values={hoursLine.values}
                      max={hoursLine.max}
                      axis={hoursLine.axis}
                      dayLetters={hoursLine.dayLetters}
                      labels={hoursLine.labels}
                      color="var(--tt-accent)"
                      unit="h"
                    />
                  </Card>
                </Widget>
                <Widget id="trend-productivity">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-1 font-semibold">
                      Productivity % per day
                    </h3>
                    <p className="text-caption text-text-secondary mb-3.5">
                      Green: productive share of categorized time. Remainder: neutral +
                      unproductive.
                    </p>
                    <StackedDayBars values={prodBars.values} dayLetters={prodBars.dayLetters} />
                  </Card>
                </Widget>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader label="Latest data" />
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
                <Widget id="projects">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Top projects
                    </h3>
                    {donut.segments.length > 0 ? (
                      <DonutChart
                        items={donut.segments}
                        centerValue={formatDuration(donut.totalSeconds)}
                        centerLabel="tracked"
                      />
                    ) : (
                      <p className="text-text-secondary text-body">
                        No project data in this range.
                      </p>
                    )}
                  </Card>
                </Widget>
                <Widget id="havent">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Haven’t tracked
                    </h3>
                    {notTracked.length > 0 ? (
                      <ul className="m-0 flex list-none flex-col gap-3 p-0">
                        {notTracked.map((row) => (
                          <li key={row.userId} className="flex items-center gap-2.5">
                            <Avatar name={row.name} size={30} />
                            <div className="flex flex-col">
                              <span className="text-text text-[13px]">{row.name}</span>
                              <span className="text-text-secondary text-caption">
                                Never tracked today
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-text-secondary text-body">Everyone tracked time today.</p>
                    )}
                  </Card>
                </Widget>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader label="Top users" />
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
                <Widget id="top-hours">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Tracked most hours
                    </h3>
                    {topHours.length > 0 ? (
                      <div className="flex flex-col gap-3.5">
                        {topHours.map((row) => (
                          <BarMeter
                            key={row.userId}
                            label={
                              <span className="inline-flex items-center gap-2">
                                <Avatar name={row.name} size={22} />
                                {row.name}
                              </span>
                            }
                            value={formatDuration(row.trackedSeconds)}
                            fills={[{ pct: row.pct, color: 'var(--tt-accent)' }]}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
                <Widget id="top-activity">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Highest activity %
                    </h3>
                    {topActivity.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {topActivity.map((row) => (
                          <div key={row.userId} className="flex flex-col items-center gap-1.5">
                            <Gauge pct={row.activityPct} color="var(--tt-good)" />
                            <Avatar name={row.name} size={22} />
                            <span className="text-caption text-text-secondary">
                              {row.name.split(' ')[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
                <Widget id="top-productive">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Highest productive %
                    </h3>
                    {topProd.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {topProd.map((row) => (
                          <div key={row.userId} className="flex flex-col items-center gap-1.5">
                            <Gauge pct={row.pct} color="var(--tt-good)" />
                            <Avatar name={row.name} size={22} />
                            <span className="text-caption text-text-secondary">
                              {row.name.split(' ')[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
                <Widget id="top-unproductive">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Highest unproductive %
                    </h3>
                    {topUnprod.length > 0 ? (
                      <div className="flex flex-wrap gap-4">
                        {topUnprod.map((row) => (
                          <div key={row.userId} className="flex flex-col items-center gap-1.5">
                            <Gauge pct={row.pct} color="var(--tt-category-unproductive)" />
                            <Avatar name={row.name} size={22} />
                            <span className="text-caption text-text-secondary">
                              {row.name.split(' ')[0]}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
                <Widget id="top-idle">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Highest idle %
                    </h3>
                    {topIdle.length > 0 ? (
                      <div className="flex flex-col gap-3.5">
                        {topIdle.map((row) => (
                          <BarMeter
                            key={row.userId}
                            label={
                              <span className="inline-flex items-center gap-2">
                                <Avatar name={row.name} size={22} />
                                {row.name}
                              </span>
                            }
                            value={`${row.idlePct}% (${row.idleMinutes}m)`}
                            fills={[{ pct: row.idlePct, color: 'var(--tt-text-secondary)' }]}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-body">No data in this range.</p>
                    )}
                  </Card>
                </Widget>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader label="Websites & applications" />
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
                <Widget id="apps-used">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Top used
                    </h3>
                    <AppUsageList items={appLists.topUsed} />
                  </Card>
                </Widget>
                <Widget id="apps-unproductive">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Top unproductive
                    </h3>
                    <AppUsageList items={appLists.unproductive} />
                  </Card>
                </Widget>
                <Widget id="apps-unrated">
                  <Card padding="md" className="h-full">
                    <h3 className="text-label text-text-secondary mb-3.5 font-semibold">
                      Top unrated
                    </h3>
                    <AppUsageList items={appLists.unrated} />
                  </Card>
                </Widget>
              </div>
            </section>
          </div>
        </WidgetVisibilityProvider>
      )}
    </>
  );
}
