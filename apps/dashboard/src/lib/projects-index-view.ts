import type { Project, ProjectSummaryRow } from '@timetrack/contracts';
import { projectColor } from './project-color';

export type ProjectIndexRow = {
  projectId: string;
  name: string;
  archived: boolean;
  trackedSeconds: number;
  color: string;
};

/**
 * Merge the project list (names, archived) with per-project hours (from /reports/projects) into
 * sorted index rows. The null-projectId "No project" bucket is not a project — its seconds are
 * returned separately for a muted footer row. Pure; unit-tested. No I/O.
 *
 * KNOWN GAP (revisit when a slice renders a grand total): only the forward join is covered —
 * every project gets a row. A non-null-projectId summary row with NO matching project in
 * `projects` has its seconds silently dropped (neither a row nor `noProjectSeconds`). This IS
 * reachable on the default view: /reports/projects aggregates all projects incl. archived, but
 * listProjects returns active-only by default, so an archived project with in-range hours is
 * absent from `projects`. Benign here (Slice 1 shows no total, so nothing fails to reconcile);
 * when a total/reconciliation is added, route unmatched non-null seconds into a residual bucket.
 */
export function toProjectIndexRows(
  projects: Project[],
  summaryRows: ProjectSummaryRow[],
): { rows: ProjectIndexRow[]; noProjectSeconds: number } {
  const secondsById = new Map<string, number>();
  let noProjectSeconds = 0;
  for (const r of summaryRows) {
    if (r.projectId === null) noProjectSeconds += r.trackedSeconds;
    else secondsById.set(r.projectId, r.trackedSeconds);
  }

  const rows: ProjectIndexRow[] = projects.map((p) => ({
    projectId: p.id,
    name: p.name,
    archived: p.archived,
    trackedSeconds: secondsById.get(p.id) ?? 0,
    color: projectColor(p.id),
  }));

  rows.sort((a, b) => b.trackedSeconds - a.trackedSeconds || a.name.localeCompare(b.name));
  return { rows, noProjectSeconds };
}
