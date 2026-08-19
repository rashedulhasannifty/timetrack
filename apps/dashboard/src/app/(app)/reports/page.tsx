import { PageHeader } from '../../../components/ui/PageHeader';
import { SectionHeader } from '../../../components/ui/SectionHeader';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ReportsByPersonTable } from '../../../components/reports/ReportsByPersonTable';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { defaultReportRange, hasReportData } from '../../../lib/reports-view';
import { projectBars } from '../../../lib/overview-view';
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

  // Every project, not the overview's top five — this is the report you export from.
  const bars = projectBars(projects?.rows ?? [], Number.MAX_SAFE_INTEGER);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`Range ${formatDate(from)} – ${formatDate(to)} · ${team?.rows.length ?? 0} users · ${projects?.rows.length ?? 0} projects`}
      />
      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view reports.</p>
      ) : team === null || projects === null ? (
        <p className="text-text-secondary text-body">
          Something went wrong loading reports. Please try again.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-end gap-3">
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
              <ReportsByPersonTable rows={team.rows} />
              <Card padding="md" className="flex flex-col gap-4">
                <SectionHeader label="By project" />
                <div className="flex flex-col gap-3.5">
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
