import { PageHeader } from '../../../components/ui/PageHeader';
import { TeamSummaryTable } from '../../../components/reports/TeamSummaryTable';
import { ProjectHoursChart } from '../../../components/charts/ProjectHoursChart';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';
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
  try {
    // API enforces MANAGER/ADMIN + team scope; a 403 becomes the not-authorized state.
    [team, projects] = await Promise.all([
      api.teamSummary(session.accessToken, params),
      api.projectSummary(session.accessToken, params),
    ]);
  } catch {
    team = null;
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Per-user and per-project rollups (PRD §6.5)." />
      {team === null || projects === null ? (
        <p className="text-sm text-neutral-500">You’re not permitted to view reports.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <ReportRangePicker from={from} to={to} />
          {hasReportData(team.rows, projects.rows) ? (
            <>
              <section>
                <h2 className="mb-3 text-lg font-medium">By person</h2>
                <TeamSummaryTable rows={team.rows} />
              </section>
              <section>
                <h2 className="mb-3 text-lg font-medium">By project</h2>
                <ProjectHoursChart data={toProjectBars(projects.rows)} />
              </section>
            </>
          ) : (
            <p className="text-sm text-neutral-500">No data in this range.</p>
          )}
        </div>
      )}
    </>
  );
}
