import { dayOf } from '@timetrack/contracts';
import { SectionHeader } from '../ui/SectionHeader';
import { Card } from '../ui/Card';
import { ReportRangePicker } from '../reports/ReportRangePicker';
import { ProjectHoursChart } from '../charts/ProjectHoursChart';
import { ProjectHoursTrendChart } from '../charts/ProjectHoursTrendChart';
import { BarMeter } from '../charts/BarMeter';
import { ProjectRecolor } from './ProjectRecolor';
import { ProjectArchiveToggle } from './ProjectArchiveToggle';
import { NewTaskForm } from './NewTaskForm';
import { TaskArchiveToggle } from './TaskArchiveToggle';
import { ProjectTeamMove } from './ProjectTeamMove';
import { api, ApiError } from '../../lib/api-client';
import type { Session } from '../../lib/session';
import { defaultReportRange } from '../../lib/reports-view';
import { toTrendBars, toMemberBars, toTaskBars } from '../../lib/project-detail-view';
import { projectColor } from '../../lib/project-color';
import { formatDuration } from '../../lib/format';
import type { ProjectDetail, Task, ProjectTopApps, TeamListItem } from '@timetrack/contracts';

/**
 * One project's detail, fetched once and rendered by BOTH `projects/[projectId]/page.tsx` (a
 * direct load) and the drawer that intercepts the same URL from the Projects index — so the two
 * can never disagree about what a project shows.
 *
 * Split into a loader and a view rather than one async component because each caller needs the
 * project's name for its own chrome (the page's header title + kicker, the drawer's title bar),
 * and that must come from the same single fetch. Server-only: the token never reaches the
 * browser.
 */
export type ProjectDetailData = Awaited<ReturnType<typeof loadProjectDetail>>;

// Detail hours come from /projects/:id/detail (MANAGER/ADMIN, own-team); 404 → not-found,
// 403 → not-permitted, mirroring the reports pages.
export async function loadProjectDetail({
  session,
  projectId,
  rawFrom,
  rawTo,
}: {
  session: Session;
  projectId: string;
  rawFrom: string | undefined;
  rawTo: string | undefined;
}) {
  const fallback = defaultReportRange(new Date());
  const from = rawFrom ?? fallback.from;
  const to = rawTo ?? fallback.to;

  let detail: ProjectDetail | null = null;
  let state: 'ok' | 'notfound' | 'forbidden' | 'error' = 'ok';
  try {
    detail = await api.getProjectDetail(
      session.accessToken,
      projectId,
      new URLSearchParams({ from, to }),
    );
  } catch (e) {
    detail = null;
    if (e instanceof ApiError && e.status === 404) state = 'notfound';
    else if (e instanceof ApiError && e.status === 403) state = 'forbidden';
    else state = 'error';
  }

  // Editable task list for the management section. Degradeable: a task-fetch hiccup shows an
  // empty Tasks section rather than blanking the analytics.
  let tasks: Task[] = [];
  if (detail) {
    try {
      tasks = await api.listProjectTasks(session.accessToken, projectId);
    } catch {
      tasks = [];
    }
  }

  // Degradeable: a top-apps fetch hiccup skips the section rather than blanking the page.
  let topApps: ProjectTopApps | null = null;
  if (detail) {
    try {
      topApps = await api.getProjectTopApps(
        session.accessToken,
        projectId,
        new URLSearchParams({ from, to }),
      );
    } catch {
      topApps = null;
    }
  }

  // ADMIN-only "move to team" options. Degradeable: a team-list hiccup hides the control.
  const teams: TeamListItem[] =
    detail && session.role === 'ADMIN'
      ? await api.listTeams(session.accessToken).catch((): TeamListItem[] => [])
      : [];

  return { from, to, detail, state, tasks, topApps, teams };
}

/** The detail body: the not-found / not-permitted copy, or the header, controls and sections. */
export function ProjectDetailContent({ data }: { data: ProjectDetailData }) {
  const { from, to, detail, state, tasks, topApps, teams } = data;
  const topAppsMax = topApps ? Math.max(1, ...topApps.apps.map((a) => a.trackedSeconds)) : 0;

  return detail === null ? (
    <>
      <p className="text-text-secondary text-body">
        {state === 'notfound'
          ? 'Project not found.'
          : state === 'forbidden'
            ? 'You’re not permitted to view this project.'
            : 'Something went wrong loading this project. Please try again.'}
      </p>
    </>
  ) : (
    <>
      <div className="mb-6 flex items-center gap-3">
        <span
          className="inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: detail.color ?? projectColor(detail.projectId) }}
          aria-hidden="true"
        />
        <h2 className="text-text text-h2 font-display font-extrabold tracking-[-0.02em]">
          {detail.name}
        </h2>
        {detail.archived && (
          <span className="text-text-secondary border-separator text-micro rounded-full border px-2.5 py-0.5">
            Archived
          </span>
        )}
        <span className="tt-numeric text-text-secondary text-label ml-auto">
          {formatDuration(detail.totalSeconds)} tracked · {dayOf(new Date(from))} –{' '}
          {to.slice(0, 10)}
        </span>
      </div>

      <div className="border-separator mb-6 flex flex-wrap items-center gap-4 border-b pb-4">
        <ProjectRecolor id={detail.projectId} color={detail.color} />
        <ProjectArchiveToggle id={detail.projectId} archived={detail.archived} />
        <ProjectTeamMove
          id={detail.projectId}
          projectName={detail.name}
          teamId={detail.teamId}
          teams={teams}
        />
      </div>

      <div className="mb-6">
        <ReportRangePicker from={from} to={to} basePath={`/projects/${detail.projectId}`} />
      </div>

      <div className="flex flex-col gap-8">
        <section>
          <h2 className="text-text text-h2 mb-3 font-semibold">Hours over time</h2>
          <ProjectHoursTrendChart data={toTrendBars(detail.trend)} />
        </section>
        <section>
          <h2 className="text-text text-h2 mb-3 font-semibold">By member</h2>
          <ProjectHoursChart data={toMemberBars(detail.members)} />
        </section>
        <section>
          <h2 className="text-text text-h2 mb-3 font-semibold">By task</h2>
          <ProjectHoursChart data={toTaskBars(detail.tasks)} />
        </section>
        {topApps && (
          <section className="flex flex-col gap-3">
            <SectionHeader label="Top apps" />
            <Card padding="md">
              <p className="text-caption text-text-secondary">
                App data covers {topApps.coveragePct}% of this project’s tracked time.
              </p>
              {topApps.apps.length === 0 ? (
                <p className="text-text-secondary text-body">
                  No app activity recorded for this project’s tracked time.
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-3.5">
                  {topApps.apps.map((a) => (
                    <BarMeter
                      key={a.appName}
                      label={a.appName}
                      value={formatDuration(a.trackedSeconds)}
                      fills={[
                        {
                          pct: topAppsMax > 0 ? (a.trackedSeconds / topAppsMax) * 100 : 0,
                          color: 'var(--tt-accent)',
                        },
                      ]}
                    />
                  ))}
                </div>
              )}
            </Card>
          </section>
        )}
        <section>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-text text-h2 font-semibold">Tasks</h2>
            <NewTaskForm projectId={detail.projectId} />
          </div>
          {tasks.length === 0 ? (
            <p className="text-text-secondary text-body">No tasks yet.</p>
          ) : (
            <ul className="bg-surface-raised border-separator divide-separator divide-y rounded-lg border shadow-e1">
              {tasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-text truncate">{task.name}</span>
                    {task.archived && (
                      <span className="text-text-secondary border-separator text-caption rounded-full border px-2 py-0.5">
                        Archived
                      </span>
                    )}
                  </span>
                  <TaskArchiveToggle
                    id={task.id}
                    projectId={detail.projectId}
                    archived={task.archived}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
