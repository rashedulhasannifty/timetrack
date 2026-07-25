import type { ProjectHoursTrendRow, ProjectMemberRow, ProjectTaskRow } from '@timetrack/contracts';

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
