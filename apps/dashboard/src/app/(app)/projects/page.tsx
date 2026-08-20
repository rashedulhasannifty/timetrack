import Link from 'next/link';
import { dayOf } from '@timetrack/contracts';
import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { Card } from '../../../components/ui/Card';
import { Meter } from '../../../components/ui/Meter';
import { buttonClasses } from '../../../components/ui/Button';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { NewProjectForm } from '../../../components/projects/NewProjectForm';
import { ProjectArchiveToggle } from '../../../components/projects/ProjectArchiveToggle';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';
import { defaultReportRange } from '../../../lib/reports-view';
import { toProjectIndexRows } from '../../../lib/projects-index-view';
import { formatDuration } from '../../../lib/format';
import { ProjectTeamPicker } from '../../../components/projects/ProjectTeamPicker';
import type { Project, ProjectSummary, TeamListItem } from '@timetrack/contracts';

// Next 16 — searchParams is async. Projects index: per-project tracked hours over a range.
// Hours come from /reports/projects (MANAGER/ADMIN); a 403 becomes the not-permitted state,
// exactly like the Reports page. The nav item stays visible to everyone.
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; includeArchived?: string; teamId?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const sp = await searchParams;
  const fallback = defaultReportRange(new Date());
  const from = sp.from ?? fallback.from;
  const to = sp.to ?? fallback.to;
  const includeArchived = sp.includeArchived === 'true';

  // ADMIN-only team dimension. A non-admin never sees the picker and the API pins them to
  // their own team anyway, so a hand-typed ?teamId can't widen anything.
  const [teams, ownTeam] =
    session.role === 'ADMIN'
      ? await Promise.all([
          api.listTeams(session.accessToken).catch((): TeamListItem[] => []),
          // Which pill to mark active when no ?teamId is set: the API defaults to the
          // caller's own team, so that is what the list is showing.
          api
            .getCurrentTeam(session.accessToken)
            .then((t) => t.id)
            .catch(() => undefined),
        ])
      : [[] as TeamListItem[], undefined];
  const selectedTeamId = teams.some((t) => t.id === sp.teamId) ? sp.teamId : undefined;

  let projectList: Project[] | null = null;
  let summary: ProjectSummary | null = null;
  let forbidden = false;
  try {
    [projectList, summary] = await Promise.all([
      api.listProjects(session.accessToken, {
        includeArchived,
        ...(selectedTeamId ? { teamId: selectedTeamId } : {}),
      }),
      api.projectSummary(session.accessToken, new URLSearchParams({ from, to })),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden = true;
    projectList = null;
    summary = null;
  }

  const view = projectList && summary ? toProjectIndexRows(projectList, summary.rows) : null;

  // "Show/Hide archived" toggle preserves the current range and flips includeArchived.
  const toggle = new URLSearchParams({ from, to });
  if (selectedTeamId) toggle.set('teamId', selectedTeamId);
  if (!includeArchived) toggle.set('includeArchived', 'true');
  const toggleHref = `/projects?${toggle.toString()}`;

  return (
    <>
      {/* The shell header already renders the page title; this only supplies the range line. */}
      <SetPageTitle
        title="Projects"
        kicker={`Tracked hours · ${dayOf(new Date(from))} – ${to.slice(0, 10)}`}
      />
      {forbidden ? (
        <p className="text-text-secondary text-body">You’re not permitted to view projects.</p>
      ) : view === null ? (
        <p className="text-text-secondary text-body">
          Something went wrong loading projects. Please try again.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <ProjectTeamPicker
            teams={teams}
            selectedId={selectedTeamId ?? ownTeam ?? ''}
            from={from}
            to={to}
            includeArchived={includeArchived}
          />
          <NewProjectForm />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="tt-numeric text-text-secondary text-label">
              {view.rows.length} {view.rows.length === 1 ? 'project' : 'projects'} ·{' '}
              {formatDuration(view.totalSeconds)} this period
            </span>
            <div className="flex flex-wrap items-center gap-2.5">
              <ReportRangePicker from={from} to={to} basePath="/projects" />
              <Link href={toggleHref} className={buttonClasses('secondary', 'sm')}>
                {includeArchived ? 'Hide archived' : 'Show archived'}
              </Link>
            </div>
          </div>

          {view.rows.length === 0 ? (
            <p className="text-text-secondary text-body">No projects yet.</p>
          ) : (
            <Card padding="none" className="overflow-hidden">
              <ul className="m-0 flex list-none flex-col p-0">
                {view.rows.map((row) => (
                  <li
                    key={row.projectId}
                    className="border-separator hover:bg-surface flex flex-wrap items-center gap-3.5 border-b px-[26px] py-4 transition-colors"
                  >
                    <span
                      className="inline-block h-[9px] w-[9px] shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                      aria-hidden="true"
                    />
                    <Link
                      href={`/projects/${row.projectId}`}
                      className="text-text hover:text-accent min-w-[190px] flex-none truncate text-[14px] font-bold transition-colors"
                    >
                      {row.name}
                    </Link>
                    {row.archived && (
                      <span className="text-text-secondary border-separator text-micro rounded-full border px-2.5 py-0.5">
                        Archived
                      </span>
                    )}
                    <span className="text-text-secondary text-caption min-w-[130px]">
                      {row.taskCount === 0
                        ? 'no tasks'
                        : `${row.taskCount} ${row.taskCount === 1 ? 'task' : 'tasks'}`}
                    </span>
                    <Meter pct={row.sharePct} />
                    <span className="tt-numeric w-20 shrink-0 text-right text-[13px] font-bold">
                      {formatDuration(row.trackedSeconds)}
                    </span>
                    <span className="tt-numeric text-neutral w-10 shrink-0 text-right text-caption">
                      {Math.round(row.sharePct)}%
                    </span>
                    <ProjectArchiveToggle id={row.projectId} archived={row.archived} />
                  </li>
                ))}
                {view.noProjectSeconds > 0 && (
                  <li className="text-text-secondary flex flex-wrap items-center gap-3.5 px-[26px] py-4">
                    <span
                      className="bg-separator inline-block h-[9px] w-[9px] shrink-0 rounded-full"
                      aria-hidden="true"
                    />
                    <span className="min-w-[190px] flex-none text-[14px]">No project</span>
                    <span className="min-w-[130px]" />
                    <Meter
                      pct={
                        view.totalSeconds === 0
                          ? 0
                          : (view.noProjectSeconds / view.totalSeconds) * 100
                      }
                    />
                    <span className="tt-numeric w-20 shrink-0 text-right text-[13px]">
                      {formatDuration(view.noProjectSeconds)}
                    </span>
                    <span className="w-10 shrink-0" />
                  </li>
                )}
                {view.residualSeconds > 0 && (
                  <li className="text-text-secondary border-separator flex flex-wrap items-center gap-3.5 border-t px-[26px] py-4">
                    <span
                      className="bg-separator inline-block h-[9px] w-[9px] shrink-0 rounded-full"
                      aria-hidden="true"
                    />
                    <span className="min-w-[190px] flex-none text-[14px]">Projects not listed</span>
                    <span className="text-caption min-w-[130px]">
                      archived — turn on “Show archived”
                    </span>
                    <Meter
                      pct={
                        view.totalSeconds === 0
                          ? 0
                          : (view.residualSeconds / view.totalSeconds) * 100
                      }
                    />
                    <span className="tt-numeric w-20 shrink-0 text-right text-[13px]">
                      {formatDuration(view.residualSeconds)}
                    </span>
                    <span className="w-10 shrink-0" />
                  </li>
                )}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
