import type {
  ProjectHoursTrendRow,
  ProjectMemberRow,
  ProjectSubprojectRow,
  ProjectTeamRow,
  ProjectTaskRow,
  Subproject,
  Task,
} from '@timetrack/contracts';

// Same rounding as reports-view's toProjectBars: seconds → hours to 0.1.
const toHours = (seconds: number): number => Math.round((seconds / 3600) * 10) / 10;

/** Day 'YYYY-MM-DD' → 'MM-DD' axis label; seconds → hours. */
export function toTrendBars(trend: ProjectHoursTrendRow[]): { label: string; hours: number }[] {
  return trend.map((r) => ({ label: r.day.slice(5), hours: toHours(r.trackedSeconds) }));
}

export function toMemberBars(members: ProjectMemberRow[]): { name: string; hours: number }[] {
  return members.map((m) => ({ name: m.name, hours: toHours(m.trackedSeconds) }));
}

export function toTaskBars(tasks: ProjectTaskRow[]): { name: string; hours: number }[] {
  return tasks.map((t) => ({ name: t.name, hours: toHours(t.trackedSeconds) }));
}

export type SubprojectGroup = { subproject: Subproject; trackedSeconds: number; tasks: Task[] };

/** Tasks nested under their subproject, in the order the API lists subprojects (default first). */
export function groupTasksBySubproject(
  subprojects: Subproject[],
  tasks: Task[],
  hours: ProjectSubprojectRow[],
): SubprojectGroup[] {
  const secondsById = new Map(hours.map((h) => [h.subprojectId, h.trackedSeconds]));
  return subprojects.map((subproject) => ({
    subproject,
    trackedSeconds: secondsById.get(subproject.id) ?? 0,
    tasks: tasks.filter((t) => t.subprojectId === subproject.id),
  }));
}

/** Move-select options: active subprojects plus the task's current one (labelled when archived). */
export function taskMoveOptions(
  subprojects: Subproject[],
  currentSubprojectId: string,
): { id: string; label: string }[] {
  return subprojects
    .filter((s) => !s.archived || s.id === currentSubprojectId)
    .map((s) => ({ id: s.id, label: s.archived ? `${s.name} (archived)` : s.name }));
}

/** The client's time by team, for the split table (spec §6). Share is of the whole client. */
export function toTeamSplitRows(
  byTeam: ProjectTeamRow[],
  totalSeconds: number,
): { key: string; name: string; seconds: number; pct: number }[] {
  return byTeam.map((t) => ({
    key: t.teamId ?? 'unassigned',
    name: t.teamName,
    seconds: t.trackedSeconds,
    pct: totalSeconds === 0 ? 0 : (t.trackedSeconds / totalSeconds) * 100,
  }));
}

/** Mirrors the API's assertCanOwn: a shared client is ADMIN-only to archive or recolor. */
export function canOwnProject(role: string, teamIds: readonly string[]): boolean {
  return role === 'ADMIN' || teamIds.length <= 1;
}
