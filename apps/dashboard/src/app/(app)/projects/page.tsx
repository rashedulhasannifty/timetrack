import Link from 'next/link';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { buttonClasses } from '../../../components/ui/Button';
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
      <PageHeader
        title="Projects"
        subtitle={`Tracked hours · ${from.slice(0, 10)} – ${to.slice(0, 10)}`}
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
          <div className="flex items-center justify-between gap-4">
            <ReportRangePicker from={from} to={to} basePath="/projects" />
            <Link href={toggleHref} className={buttonClasses('secondary', 'md')}>
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </Link>
          </div>

          {view.rows.length === 0 ? (
            <p className="text-text-secondary text-body">No projects yet.</p>
          ) : (
            <ul className="bg-surface-raised border-separator divide-separator m-0 list-none divide-y rounded-md border p-0 shadow-e1">
              {view.rows.map((row) => (
                <li key={row.projectId} className="flex items-center gap-3.5 px-5 py-3.5">
                  <Link
                    href={`/projects/${row.projectId}`}
                    className="hover:text-accent flex min-w-[190px] items-center gap-3.5 transition-colors"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                      aria-hidden="true"
                    />
                    <span className="text-text truncate font-medium">{row.name}</span>
                  </Link>
                  {row.archived && (
                    <span className="text-text-secondary border-separator text-caption shrink-0 rounded-full border px-2 py-0.5">
                      Archived
                    </span>
                  )}
                  {/* The bar is a comparison between projects; the number beside it is the
                      project's share of the whole range. */}
                  <span className="bg-separator relative h-1.5 flex-1 overflow-hidden rounded-[3px]">
                    <span
                      className="absolute inset-y-0 left-0 rounded-[3px]"
                      style={{
                        width: `${row.widthPct}%`,
                        background: row.color,
                        opacity: 0.8,
                      }}
                    />
                  </span>
                  <span className="tt-numeric w-20 shrink-0 text-right text-[13px]">
                    {formatDuration(row.trackedSeconds)}
                  </span>
                  <span className="tt-numeric text-text-secondary text-caption w-11 shrink-0 text-right">
                    {row.sharePct}%
                  </span>
                  <ProjectArchiveToggle id={row.projectId} archived={row.archived} />
                </li>
              ))}
              {view.noProjectSeconds > 0 && (
                <li className="text-text-secondary flex items-center gap-3.5 px-5 py-3.5">
                  <span className="flex min-w-[190px] items-center gap-3.5">
                    <span
                      className="bg-separator inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      aria-hidden="true"
                    />
                    <span>No project</span>
                  </span>
                  <span className="flex-1" />
                  <span className="tt-numeric w-20 shrink-0 text-right text-[13px]">
                    {formatDuration(view.noProjectSeconds)}
                  </span>
                  <span className="w-11 shrink-0" />
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
