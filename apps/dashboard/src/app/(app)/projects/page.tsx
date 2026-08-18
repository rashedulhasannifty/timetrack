import Link from 'next/link';
import { PageHeader } from '../../../components/ui/PageHeader';
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
            <Link
              href={toggleHref}
              className="border-separator text-text hover:bg-surface inline-flex items-center rounded-md border px-3 py-1.5 text-label font-medium transition-colors"
            >
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </Link>
          </div>

          {view.rows.length === 0 ? (
            <p className="text-text-secondary text-body">No projects yet.</p>
          ) : (
            <ul className="bg-surface-raised border-separator divide-separator divide-y rounded-lg border shadow-e1">
              {view.rows.map((row) => (
                <li
                  key={row.projectId}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <Link
                    href={`/projects/${row.projectId}`}
                    className="hover:text-accent flex min-w-0 flex-1 items-center gap-3 transition-colors"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                      aria-hidden="true"
                    />
                    <span className="text-text truncate font-medium">{row.name}</span>
                    {row.archived && (
                      <span className="text-text-secondary border-separator text-caption rounded-full border px-2 py-0.5">
                        Archived
                      </span>
                    )}
                  </Link>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tt-numeric text-text-secondary text-label">
                      {formatDuration(row.trackedSeconds)}
                    </span>
                    <ProjectArchiveToggle id={row.projectId} archived={row.archived} />
                  </span>
                </li>
              ))}
              {view.noProjectSeconds > 0 && (
                <li className="text-text-secondary flex items-center justify-between gap-4 px-4 py-3">
                  <span className="flex items-center gap-3">
                    <span
                      className="bg-separator inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      aria-hidden="true"
                    />
                    <span>No project</span>
                  </span>
                  <span className="tt-numeric text-label shrink-0">
                    {formatDuration(view.noProjectSeconds)}
                  </span>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
