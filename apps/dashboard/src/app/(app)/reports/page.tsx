import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { SectionHeader } from '../../../components/ui/SectionHeader';
import { Card, CardTitle } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Meter } from '../../../components/ui/Meter';
import { ReportsByPersonTable } from '../../../components/reports/ReportsByPersonTable';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { defaultReportRange, hasReportData } from '../../../lib/reports-view';
import { formatDuration, formatDate } from '../../../lib/format';
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

  const projectsMax = projects ? Math.max(1, ...projects.rows.map((r) => r.trackedSeconds)) : 1;

  return (
    <>
      <SetPageTitle title="Reports" />
      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view reports.</p>
      ) : team === null || projects === null ? (
        <p className="text-text-secondary text-body">
          Something went wrong loading reports. Please try again.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-label text-text-secondary tt-numeric">
              Range {formatDate(from)} – {formatDate(to)} · {team.rows.length} users ·{' '}
              {projects.rows.length} projects
            </span>
            <div className="flex items-center gap-3">
              <ReportRangePicker from={from} to={to} />
              <Button
                variant="secondary"
                size="sm"
                href={`/reports/export?${params.toString()}`}
                download
              >
                Export CSV
              </Button>
            </div>
          </div>
          {hasReportData(team.rows, projects.rows) ? (
            <>
              <div className="flex flex-col gap-3">
                <SectionHeader label="By person" />
                <ReportsByPersonTable rows={team.rows} />
              </div>
              <Card padding="md">
                <CardTitle className="mb-2">By project</CardTitle>
                <ul className="m-0 flex list-none flex-col p-0">
                  {projects.rows.map((p) => (
                    <li
                      key={p.projectId ?? 'none'}
                      className="border-separator flex items-center gap-3 border-t py-3"
                    >
                      <span className="flex-1 truncate text-[13px] font-semibold">{p.name}</span>
                      <Meter pct={(p.trackedSeconds / projectsMax) * 100} width={280} />
                      <span className="tt-numeric text-text-secondary w-[70px] text-right text-[13px]">
                        {formatDuration(p.trackedSeconds)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : (
            <p className="text-text-secondary text-body">No data in this range.</p>
          )}
        </div>
      )}
    </>
  );
}
