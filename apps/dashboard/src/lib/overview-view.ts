import type {
  ProjectSummaryRow,
  TeamOverviewRow,
  TeamSummaryRow,
  TeamTrends,
  TeamActivity,
  TeamAppUsage,
} from '@timetrack/contracts';
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

export interface DayLetter {
  letter: string;
  weekend: boolean;
}
export interface HoursLineModel {
  values: number[];
  max: number;
  axis: string[];
  dayLetters: DayLetter[];
  labels: string[];
}
export interface ProductivityBarsModel {
  values: number[];
  dayLetters: DayLetter[];
}
export interface AppUsageItem {
  appName: string;
  seconds: number;
  category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE';
  pct: number;
}

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A 'YYYY-MM-DD' day string, read in UTC so results are deterministic (Vitest node-env).
function dayLetter(day: string): DayLetter {
  const d = new Date(`${day}T00:00:00.000Z`);
  const wd = d.getUTCDay();
  return { letter: WEEKDAY[wd]!, weekend: wd === 0 || wd === 6 };
}
function monthDay(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  return `${MONTH[d.getUTCMonth()]!} ${d.getUTCDate()}`;
}
function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part * 100) / whole);
}

export function teamCategoryKpis(trends: TeamTrends): {
  productivePct: number;
  unproductivePct: number;
} {
  let p = 0,
    n = 0,
    u = 0;
  for (const d of trends.days) {
    p += d.productiveSeconds;
    n += d.neutralSeconds;
    u += d.unproductiveSeconds;
  }
  const total = p + n + u;
  return { productivePct: pct(p, total), unproductivePct: pct(u, total) };
}

export function teamIdleKpi(activity: TeamActivity): { idlePct: number } {
  let idle = 0,
    active = 0;
  for (const r of activity.rows) {
    idle += r.idleMinutes;
    active += r.activeMinutes;
  }
  return { idlePct: pct(idle, idle + active) };
}

export function trendsToHoursLine(trends: TeamTrends): HoursLineModel {
  const values = trends.days.map((d) => Math.round((d.trackedSeconds / 3600) * 10) / 10);
  const maxH = Math.max(0, ...values);
  const max = Math.max(6, Math.ceil(maxH / 6) * 6);
  const axis = [max, (max * 2) / 3, max / 3, 0].map((v) => String(v));
  return {
    values,
    max,
    axis,
    dayLetters: trends.days.map((d) => dayLetter(d.day)),
    labels: trends.days.map((d) => monthDay(d.day)),
  };
}

export function trendsToProductivityBars(trends: TeamTrends): ProductivityBarsModel {
  return {
    values: trends.days.map((d) =>
      pct(d.productiveSeconds, d.productiveSeconds + d.neutralSeconds + d.unproductiveSeconds),
    ),
    dayLetters: trends.days.map((d) => dayLetter(d.day)),
  };
}

export function topByProductive(
  activity: TeamActivity,
  n = 6,
): { userId: string; name: string; pct: number }[] {
  return [...activity.rows]
    .sort((a, b) => b.productivePct - a.productivePct)
    .slice(0, n)
    .map((r) => ({ userId: r.userId, name: r.name, pct: r.productivePct }));
}

export function topByUnproductive(
  activity: TeamActivity,
  n = 6,
): { userId: string; name: string; pct: number }[] {
  return [...activity.rows]
    .sort((a, b) => b.unproductivePct - a.unproductivePct)
    .slice(0, n)
    .map((r) => ({ userId: r.userId, name: r.name, pct: r.unproductivePct }));
}

export function topByIdle(
  activity: TeamActivity,
  n = 5,
): { userId: string; name: string; idlePct: number; idleMinutes: number }[] {
  return [...activity.rows]
    .sort((a, b) => b.idlePct - a.idlePct)
    .slice(0, n)
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      idlePct: r.idlePct,
      idleMinutes: r.idleMinutes,
    }));
}

export function appUsageByCategory(
  appUsage: TeamAppUsage,
  n = 5,
): { topUsed: AppUsageItem[]; unproductive: AppUsageItem[]; unrated: AppUsageItem[] } {
  const toItems = (rows: TeamAppUsage['rows']): AppUsageItem[] => {
    const max = Math.max(1, ...rows.map((r) => r.seconds));
    return rows.slice(0, n).map((r) => ({
      appName: r.appName,
      seconds: r.seconds,
      category: r.category,
      pct: (r.seconds / max) * 100,
    }));
  };
  return {
    topUsed: toItems(appUsage.rows),
    unproductive: toItems(appUsage.rows.filter((r) => r.category === 'UNPRODUCTIVE')),
    unrated: toItems(appUsage.rows.filter((r) => r.category === 'NEUTRAL')),
  };
}
