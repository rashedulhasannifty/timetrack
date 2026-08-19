import type { Project, ProjectSummaryRow } from '@timetrack/contracts';
import { projectColor } from './project-color';

export type ProjectIndexRow = {
  projectId: string;
  name: string;
  archived: boolean;
  trackedSeconds: number;
  color: string;
  /** Non-archived tasks on the project, from the nested `tasks` the list endpoint returns. */
  taskCount: number;
  /** Share of the range's total tracked time, 0–100. */
  sharePct: number;
};

export type ProjectIndexView = {
  rows: ProjectIndexRow[];
  noProjectSeconds: number;
  /**
   * Hours belonging to a project that isn't in `projects` — reachable on the default view,
   * where /reports/projects aggregates archived projects too but listProjects returns
   * active-only. Kept as its own bucket so the shares reconcile to 100 instead of silently
   * losing the time. Zero once `includeArchived` is on.
   */
  residualSeconds: number;
  /** Everything the summary reported, including both buckets — the shares' denominator. */
  totalSeconds: number;
};

/**
 * Merge the project list (names, archived, tasks) with per-project hours (from
 * /reports/projects) into sorted index rows. The null-projectId "No project" bucket is not a
 * project — its seconds are returned separately for a muted footer row. Pure; unit-tested. No I/O.
 *
 * Both joins are now covered. A summary row whose non-null projectId has no matching project
 * used to have its seconds dropped entirely; they land in `residualSeconds` instead, which is
 * what lets `sharePct` add up to 100.
 */
export function toProjectIndexRows(
  projects: Project[],
  summaryRows: ProjectSummaryRow[],
): ProjectIndexView {
  const secondsById = new Map<string, number>();
  let noProjectSeconds = 0;
  for (const r of summaryRows) {
    if (r.projectId === null) noProjectSeconds += r.trackedSeconds;
    else secondsById.set(r.projectId, r.trackedSeconds);
  }

  const known = new Set(projects.map((p) => p.id));
  let residualSeconds = 0;
  for (const [projectId, seconds] of secondsById) {
    if (!known.has(projectId)) residualSeconds += seconds;
  }

  const totalSeconds = summaryRows.reduce((sum, r) => sum + r.trackedSeconds, 0);
  const share = (seconds: number): number =>
    totalSeconds === 0 ? 0 : (seconds / totalSeconds) * 100;

  const rows: ProjectIndexRow[] = projects.map((p) => {
    const trackedSeconds = secondsById.get(p.id) ?? 0;
    return {
      projectId: p.id,
      name: p.name,
      archived: p.archived,
      trackedSeconds,
      color: p.color ?? projectColor(p.id),
      taskCount: p.tasks?.length ?? 0,
      sharePct: share(trackedSeconds),
    };
  });

  rows.sort((a, b) => b.trackedSeconds - a.trackedSeconds || a.name.localeCompare(b.name));
  return { rows, noProjectSeconds, residualSeconds, totalSeconds };
}
