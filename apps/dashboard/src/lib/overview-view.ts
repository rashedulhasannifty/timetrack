import type {
  ProjectSummaryRow,
  TeamActivityRow,
  TeamOverviewRow,
  TeamSummaryRow,
  TeamTrends,
  TeamActivity,
  TeamAppUsage,
} from '@timetrack/contracts';
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

export function haventTracked(overview: TeamOverviewRow[]): TeamOverviewRow[] {
  return overview.filter((r) => r.trackedSecondsToday === 0);
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

export interface PeopleRow {
  userId: string;
  name: string;
  trackedSeconds: number;
  activityPct: number;
  productivePct: number;
  unproductivePct: number;
  idlePct: number;
  idleMinutes: number;
  tracking: boolean;
}

/**
 * The overview's people table: one row per person, tracked time descending. Three endpoints
 * carry the columns — the range summary has hours and activity, the activity rollup has the
 * category split and idle, and the live overview says who is tracking right now — so they are
 * joined here on userId rather than in the page. A person present in the summary but missing
 * from the activity rollup keeps their row with zeroed category columns: dropping the row would
 * silently shrink a headcount the reader is reading off the table.
 */
export function peopleTableRows(
  team: TeamSummaryRow[],
  activity: TeamActivityRow[],
  overview: TeamOverviewRow[],
): PeopleRow[] {
  const byUser = new Map(activity.map((r) => [r.userId, r]));
  const live = new Set(overview.filter((r) => r.tracking).map((r) => r.userId));
  return [...team]
    .sort((a, b) => b.trackedSeconds - a.trackedSeconds || a.name.localeCompare(b.name))
    .map((r) => {
      const a = byUser.get(r.userId);
      return {
        userId: r.userId,
        name: r.name,
        trackedSeconds: r.trackedSeconds,
        activityPct: r.activityPct,
        productivePct: a?.productivePct ?? 0,
        unproductivePct: a?.unproductivePct ?? 0,
        idlePct: a?.idlePct ?? 0,
        idleMinutes: a?.idleMinutes ?? 0,
        tracking: live.has(r.userId),
      };
    });
}

export interface ProjectBar {
  key: string;
  name: string;
  trackedSeconds: number;
  /** Share of all tracked time in the range — the number shown beside the bar. */
  sharePct: number;
  /** Share of the largest project — the bar's own width, so the top project fills the track. */
  widthPct: number;
  color: string;
}

/** Top projects as a bar list: share of the range for the label, share of the leader for the bar. */
export function projectBars(projects: ProjectSummaryRow[], n = 5): ProjectBar[] {
  const kept = projects.filter((p) => p.trackedSeconds > 0);
  const total = kept.reduce((sum, p) => sum + p.trackedSeconds, 0);
  const max = Math.max(1, ...kept.map((p) => p.trackedSeconds));
  return [...kept]
    .sort((a, b) => b.trackedSeconds - a.trackedSeconds)
    .slice(0, n)
    .map((p) => ({
      key: p.projectId ?? 'none',
      name: p.name,
      trackedSeconds: p.trackedSeconds,
      sharePct: pct(p.trackedSeconds, total),
      widthPct: (p.trackedSeconds / max) * 100,
      color: projectColor(p.projectId ?? 'none'),
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
