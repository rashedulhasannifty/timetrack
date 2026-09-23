import Link from 'next/link';
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../lib/redirect';
import { dayOf } from '@timetrack/contracts';
import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { buttonClasses } from '../../../components/ui/Button';
import { ReportRangePicker } from '../../../components/reports/ReportRangePicker';
import { NewProjectForm } from '../../../components/projects/NewProjectForm';
import { ProjectsList } from '../../../components/projects/ProjectsList';
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
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo('/projects'));

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

  // `from` is a raw, unvalidated query-string ISO instant (unlike a resolveDayDate-style
  // 'YYYY-MM-DD' label, so `isValidDay` doesn't apply here). `dayOf` calls
  // Intl.DateTimeFormat.format(), which throws RangeError on an unparseable Date — and this
  // kicker renders unconditionally, above the forbidden/view-null branches below, so a stale
  // bookmark or hand-edited ?from= must not reach it un-guarded. By the time `from` is this
  // broken, the API has already rejected the same value and `view` is already null, so falling
  // back to the pre-Dhaka raw slice here is enough to avoid crashing the render; the page's
  // existing "Something went wrong" branch takes it from there.
  const fromMs = new Date(from).getTime();
  const fromLabel = Number.isNaN(fromMs) ? from.slice(0, 10) : dayOf(new Date(fromMs));
  // Same range text as the kicker, handed to the drawer as a ready-made string rather than
  // recomputing it client-side.
  const rangeLabel = `${fromLabel} – ${to.slice(0, 10)}`;

  return (
    <>
      {/* The shell header already renders the page title; this only supplies the range line. */}
      <SetPageTitle title="Projects" kicker={`Tracked hours · ${rangeLabel}`} />
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
          <NewProjectForm
            teamId={selectedTeamId ?? ownTeam ?? ''}
            teamName={
              teams.length >= 2
                ? (teams.find((t) => t.id === (selectedTeamId ?? ownTeam))?.name ?? null)
                : null
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="tt-numeric text-text-secondary text-label">
              {view.rows.length} {view.rows.length === 1 ? 'project' : 'projects'} ·{' '}
              {formatDuration(view.totalSeconds)} this period
            </span>
            {/* items-end, not items-center: the range picker carries labels above its inputs, so
                centering put the button level with the label-plus-input block, not the inputs. */}
            <div className="flex flex-wrap items-end gap-2.5">
              <ReportRangePicker from={from} to={to} basePath="/projects" />
              <Link href={toggleHref} className={buttonClasses('secondary', 'sm')}>
                {includeArchived ? 'Hide archived' : 'Show archived'}
              </Link>
            </div>
          </div>

          <ProjectsList
            rows={view.rows}
            noProjectSeconds={view.noProjectSeconds}
            residualSeconds={view.residualSeconds}
            totalSeconds={view.totalSeconds}
            rangeLabel={rangeLabel}
          />
        </div>
      )}
    </>
  );
}
