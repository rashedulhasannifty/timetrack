import { PageHeader } from '../../../components/ui/PageHeader';
import { TeamSummaryTable } from '../../../components/reports/TeamSummaryTable';
import { ProjectHoursChart } from '../../../components/charts/ProjectHoursChart';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { defaultReportRange, toProjectBars, hasReportData } from '../../../lib/reports-view';
import type { ProjectSummary, TeamSummary } from '@timetrack/contracts';

// Next 16 — searchParams is async.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; teamId?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const fallback = defaultReportRange(new Date());
  const from = sp.from ?? fallback.from;
  const to = sp.to ?? fallback.to;

  const params = new URLSearchParams({ from, to });
  if (sp.teamId) params.set('teamId', sp.teamId);

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
    team = null;
    projects = null;
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Per-user and per-project rollups (PRD §6.5)." />
      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view reports.</p>
      ) : team === null || projects === null ? (
        <p className="text-text-secondary text-body">
          Something went wrong loading reports. Please try again.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="flex items-center justify-between gap-4">
            <ReportRangePicker from={from} to={to} />
            <a
              href={`/reports/export?${params.toString()}`}
              className="border-separator text-text hover:bg-surface inline-flex items-center rounded-md border px-3 py-1.5 text-label font-medium transition-colors"
              download
            >
              Export CSV
            </a>
          </div>
          {hasReportData(team.rows, projects.rows) ? (
            <>
              <section>
                <h2 className="text-text text-h2 mb-3 font-semibold">By person</h2>
                <TeamSummaryTable rows={team.rows} />
              </section>
              <section>
                <h2 className="text-text text-h2 mb-3 font-semibold">By project</h2>
                <ProjectHoursChart data={toProjectBars(projects.rows)} />
              </section>
            </>
          ) : (
            <p className="text-text-secondary text-body">No data in this range.</p>
          )}
        </div>
      )}
    </>
  );
}
