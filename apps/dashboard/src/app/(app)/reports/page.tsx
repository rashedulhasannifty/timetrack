import { SectionHeader } from '../../../components/ui/SectionHeader';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { BarMeter } from '../../../components/charts/BarMeter';
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
              <section className="flex flex-col gap-3">
                <SectionHeader label="By person" />
                <ReportsByPersonTable rows={team.rows} />
              </section>
              <section className="flex flex-col gap-3">
                <SectionHeader label="By project" />
                <Card padding="md">
                  <div className="flex flex-col gap-3.5">
                    {projects.rows.map((p) => (
                      <BarMeter
                        key={p.projectId ?? 'none'}
                        label={p.name}
                        value={formatDuration(p.trackedSeconds)}
                        fills={[
                          {
                            pct: (p.trackedSeconds / projectsMax) * 100,
                            color: 'var(--tt-accent)',
                          },
                        ]}
                      />
                    ))}
                  </div>
                </Card>
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
