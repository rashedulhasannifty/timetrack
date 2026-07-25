import type { ProjectSummary, TeamOverviewRow, TeamSummary } from '@timetrack/contracts';
import { SetPageTitle } from '../../components/ui/PageTitleContext';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { DonutChart } from '../../components/charts/DonutChart';
import { Gauge } from '../../components/charts/Gauge';
import { BarMeter } from '../../components/charts/BarMeter';
import { ReportRangePicker } from '../../components/reports/ReportRangePicker';
import { getSession } from '../../lib/session';
import { api, ApiError } from '../../lib/api-client';
import { defaultReportRange } from '../../lib/reports-view';
import { formatDuration } from '../../lib/format';
import {
  donutFromProjects,
  haventTracked,
  overviewKpis,
  topByActivity,
  topByHours,
} from '../../lib/overview-view';

/**
 * Slice 8 — the reskinned dashboard home: a ranged Overview with KPI tiles, the top-projects
 * donut, who hasn't tracked today, and the two top-users leaderboards. Server Component
 * (PRD §7.6); the API scopes every row to the caller's team.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getSession();
  if (!session) return null; // the layout already gated; this satisfies type-narrowing.

  const sp = await searchParams;
  const fb = defaultReportRange(new Date());
  const from = sp.from ?? fb.from;
  const to = sp.to ?? fb.to;
  const params = new URLSearchParams({ from, to });

  let team: TeamSummary | null = null;
  let projects: ProjectSummary | null = null;
  let forbidden = false;
  try {
    // API enforces MANAGER/ADMIN + team scope; a 403 becomes the not-authorized state.
    [team, projects] = await Promise.all([
      api.teamSummary(session.accessToken, params),
      api.projectSummary(session.accessToken, params),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden = true;
  }

  let overviewRows: TeamOverviewRow[] = [];
  try {
    overviewRows = (await api.teamOverview(session.accessToken)).rows;
  } catch {
    overviewRows = [];
  }

  const kpis = overviewKpis(team?.rows ?? [], overviewRows);
  const donut = donutFromProjects(projects?.rows ?? []);
  const topHours = topByHours(team?.rows ?? []);
  const topActivity = topByActivity(team?.rows ?? []);
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
        <div className="flex flex-col gap-6">
          <div className="flex justify-end">
            <ReportRangePicker from={from} to={to} basePath="/" />
          </div>

          <section className="flex flex-col gap-3">
            <SectionHeader label="Overview" />
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
              <StatCard label="Time tracked" value={formatDuration(kpis.totalSeconds)} />
              <StatCard label="Active users" value={String(kpis.activeUsers)} />
              <StatCard label="Currently tracking" value={String(kpis.tracking)} />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader label="Latest data" />
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
              <Card padding="md">
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
                  <p className="text-text-secondary text-body">No project data in this range.</p>
                )}
              </Card>
              <Card padding="md">
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
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader label="Top users" />
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
              <Card padding="md">
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
              <Card padding="md">
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
            </div>
          </section>

          <p className="text-caption text-text-secondary">
            Meeting-time, app-usage and trend widgets appear once their data sources are connected.
          </p>
        </div>
      )}
    </>
  );
}
