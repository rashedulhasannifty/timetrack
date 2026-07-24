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
