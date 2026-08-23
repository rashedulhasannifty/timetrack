import Link from 'next/link';
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../../lib/redirect';
import { dayOf } from '@timetrack/contracts';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { SectionHeader } from '../../../../components/ui/SectionHeader';
import { buttonClasses } from '../../../../components/ui/Button';
import { Card } from '../../../../components/ui/Card';
import { ReportRangePicker } from '../../../../components/reports/ReportRangePicker';
import { ProjectHoursChart } from '../../../../components/charts/ProjectHoursChart';
import { ProjectHoursTrendChart } from '../../../../components/charts/ProjectHoursTrendChart';
import { BarMeter } from '../../../../components/charts/BarMeter';
import { ProjectRecolor } from '../../../../components/projects/ProjectRecolor';
import { ProjectArchiveToggle } from '../../../../components/projects/ProjectArchiveToggle';
import { NewTaskForm } from '../../../../components/projects/NewTaskForm';
import { TaskArchiveToggle } from '../../../../components/projects/TaskArchiveToggle';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';
import { defaultReportRange } from '../../../../lib/reports-view';
import { toTrendBars, toMemberBars, toTaskBars } from '../../../../lib/project-detail-view';
import { projectColor } from '../../../../lib/project-color';
import { formatDuration } from '../../../../lib/format';
import type { ProjectDetail, Task, ProjectTopApps } from '@timetrack/contracts';

// Next 16 — params and searchParams are async. Detail hours come from /projects/:id/detail
// (MANAGER/ADMIN, own-team); 404 → not-found, 403 → not-permitted, mirroring the reports pages.
export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { projectId } = await params;
  const session = await getSession();
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo(`/projects/${projectId}`));

  const sp = await searchParams;
  const fallback = defaultReportRange(new Date());
  const from = sp.from ?? fallback.from;
  const to = sp.to ?? fallback.to;

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
  const topAppsMax = topApps ? Math.max(1, ...topApps.apps.map((a) => a.trackedSeconds)) : 0;

  return (
    <>
      <SetPageTitle
        title={detail?.name ?? 'Project'}
        kicker={
          detail
            ? `${formatDuration(detail.totalSeconds)} tracked · ${dayOf(new Date(from))} – ${to.slice(0, 10)}`
            : 'Project'
        }
      />
      <div className="mb-3">
        <Link href="/projects" className={buttonClasses('secondary', 'sm')}>
          ← Projects
        </Link>
      </div>

      {detail === null ? (
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
                    <li
                      key={task.id}
                      className="flex items-center justify-between gap-4 px-4 py-2.5"
                    >
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
      )}
    </>
  );
}
