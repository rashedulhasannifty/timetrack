import type { ProjectSummaryRow, TeamOverviewRow, TeamSummaryRow } from '@timetrack/contracts';
import { formatDuration } from './format';
import { projectColor } from './project-color';

/** Pure view-transforms for the reskinned Overview page. No React, no I/O. */

export function overviewKpis(
  team: TeamSummaryRow[],
  overview: TeamOverviewRow[],
): { totalSeconds: number; activeUsers: number; tracking: number } {
  const totalSeconds = team.reduce((sum, r) => sum + r.trackedSeconds, 0);
  const activeUsers = team.filter((r) => r.trackedSeconds > 0).length;
  const tracking = overview.filter((r) => r.tracking === true).length;
  return { totalSeconds, activeUsers, tracking };
}

export function topByHours(
  team: TeamSummaryRow[],
  n = 5,
): { userId: string; name: string; trackedSeconds: number; pct: number }[] {
  const maxSeconds = Math.max(1, ...team.map((r) => r.trackedSeconds));
  return [...team]
    .sort((a, b) => b.trackedSeconds - a.trackedSeconds)
    .slice(0, n)
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      trackedSeconds: r.trackedSeconds,
      pct: (r.trackedSeconds / maxSeconds) * 100,
    }));
}

export function topByActivity(
  team: TeamSummaryRow[],
  n = 6,
): { userId: string; name: string; activityPct: number }[] {
  return [...team]
    .sort((a, b) => b.activityPct - a.activityPct)
    .slice(0, n)
    .map((r) => ({ userId: r.userId, name: r.name, activityPct: r.activityPct }));
}

export function haventTracked(overview: TeamOverviewRow[]): TeamOverviewRow[] {
  return overview.filter((r) => r.trackedSecondsToday === 0);
}

export function donutFromProjects(projects: ProjectSummaryRow[]): {
  segments: { label: string; value: number; color: string; display: string }[];
  totalSeconds: number;
} {
  const kept = projects.filter((p) => p.trackedSeconds > 0);
  const segments = kept.map((p) => ({
    label: p.name,
    value: p.trackedSeconds,
    color: projectColor(p.projectId ?? 'none'),
    display: formatDuration(p.trackedSeconds),
  }));
  const totalSeconds = kept.reduce((sum, p) => sum + p.trackedSeconds, 0);
  return { segments, totalSeconds };
}
