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

/* ---------------------------------------------------------------------------
   Redesign additions. Everything below derives from responses the page already
   fetches — no new endpoint is called except the one extra `teamSummary` for the
   previous window, which the hero delta needs and which the API already supports.
   --------------------------------------------------------------------------- */

/**
 * The window of the same length immediately before `[from, to]`, for period-over-period
 * comparison. Both bounds are ISO instants, so this is arithmetic on the actual span rather
 * than a calendar-month guess — a 7-day range compares against the 7 days before it.
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const span = toMs - fromMs;
  return {
    from: new Date(fromMs - span - 1).toISOString(),
    to: new Date(fromMs - 1).toISOString(),
  };
}

export interface HeroModel {
  totalSeconds: number;
  /** Percent change vs the previous window; null when there is no prior total to divide by. */
  deltaPct: number | null;
}

export function heroTotals(
  current: TeamSummaryRow[],
  previous: TeamSummaryRow[] | null,
): HeroModel {
  const totalSeconds = current.reduce((sum, r) => sum + r.trackedSeconds, 0);
  if (previous === null) return { totalSeconds, deltaPct: null };
  const prev = previous.reduce((sum, r) => sum + r.trackedSeconds, 0);
  // A zero prior total makes the percentage undefined, not infinite — say nothing rather than
  // rendering "+∞%" the first time a team tracks anything.
  if (prev === 0) return { totalSeconds, deltaPct: null };
  return { totalSeconds, deltaPct: Math.round(((totalSeconds - prev) / prev) * 1000) / 10 };
}

export interface DayColumn {
  day: string;
  label: string;
  hours: number;
  /** Height as a share of the tallest day, 0–100. */
  heightPct: number;
  weekend: boolean;
  productivePct: number;
}

export interface DayColumnsModel {
  columns: DayColumn[];
  peakHours: number;
  averageHours: number;
  /** Evenly spaced ticks for the axis under the bars (first, two interior, last). */
  axisLabels: string[];
}

/**
 * The hours-per-day bar chart. Bars are scaled against the tallest day rather than a rounded
 * axis maximum, so the shape of a flat month is still readable instead of all bars collapsing
 * to the same nub.
 */
export function trendsToDayColumns(trends: TeamTrends): DayColumnsModel {
  const columns: DayColumn[] = trends.days.map((d) => {
    const hours = Math.round((d.trackedSeconds / 3600) * 10) / 10;
    const categorized = d.productiveSeconds + d.neutralSeconds + d.unproductiveSeconds;
    return {
      day: d.day,
      label: monthDay(d.day),
      hours,
      heightPct: 0,
      weekend: dayLetter(d.day).weekend,
      productivePct: pct(d.productiveSeconds, categorized),
    };
  });
  const peakHours = Math.max(0, ...columns.map((c) => c.hours));
  for (const c of columns) c.heightPct = peakHours === 0 ? 0 : (c.hours / peakHours) * 100;

  const tracked = columns.filter((c) => c.hours > 0);
  const averageHours =
    tracked.length === 0
      ? 0
      : Math.round((tracked.reduce((s, c) => s + c.hours, 0) / tracked.length) * 10) / 10;

  const axisLabels: string[] = [];
  if (columns.length > 0) {
    const picks = [
      0,
      Math.floor(columns.length / 3),
      Math.floor((columns.length * 2) / 3),
      columns.length - 1,
    ];
    for (const i of [...new Set(picks)]) axisLabels.push(columns[i]!.label);
  }

  return { columns, peakHours, averageHours, axisLabels };
}

export interface PersonRow {
  userId: string;
  name: string;
  trackedSeconds: number;
  activityPct: number;
  /** Null when the team-activity call failed or the person has no categorized time. */
  productivePct: number | null;
  unproductivePct: number | null;
  idlePct: number | null;
  idleMinutes: number | null;
  live: boolean;
}

/**
 * The People table: one row per person in the team summary, widened with the activity mix and
 * the live-tracking flag when those calls succeeded.
 *
 * Left-joined on the team summary deliberately — that is the call whose 403 gates the whole
 * page, so it is the only row set the viewer is definitely allowed to see. Activity and live
 * state degrade to null/false independently rather than dropping a person from the table.
 */
export function personRows(
  team: TeamSummaryRow[],
  activity: TeamActivity,
  overview: TeamOverviewRow[],
): PersonRow[] {
  const byActivity = new Map(activity.rows.map((r) => [r.userId, r]));
  const liveIds = new Set(overview.filter((r) => r.tracking).map((r) => r.userId));
  return [...team]
    .sort((a, b) => b.trackedSeconds - a.trackedSeconds)
    .map((r) => {
      const a = byActivity.get(r.userId);
      return {
        userId: r.userId,
        name: r.name,
        trackedSeconds: r.trackedSeconds,
        activityPct: r.activityPct,
        productivePct: a?.productivePct ?? null,
        unproductivePct: a?.unproductivePct ?? null,
        idlePct: a?.idlePct ?? null,
        idleMinutes: a?.idleMinutes ?? null,
        live: liveIds.has(r.userId),
      };
    });
}

export interface ProjectShare {
  projectId: string | null;
  name: string;
  trackedSeconds: number;
  /** Share of the range's total tracked time, 0–100. */
  sharePct: number;
}

/**
 * Projects as shares of the whole range. The denominator is the sum of every row the endpoint
 * returned — including the unnamed "no project" bucket — so the percentages add to 100 rather
 * than to whatever fraction happens to be displayed.
 */
export function projectShares(rows: ProjectSummaryRow[]): {
  shares: ProjectShare[];
  totalSeconds: number;
} {
  const totalSeconds = rows.reduce((sum, r) => sum + r.trackedSeconds, 0);
  const shares = [...rows]
    .filter((r) => r.trackedSeconds > 0)
    .sort((a, b) => b.trackedSeconds - a.trackedSeconds)
    .map((r) => ({
      projectId: r.projectId,
      name: r.name,
      trackedSeconds: r.trackedSeconds,
      sharePct: totalSeconds === 0 ? 0 : (r.trackedSeconds / totalSeconds) * 100,
    }));
  return { shares, totalSeconds };
}

export type AttentionTone = 'bad' | 'warn' | 'neutral';

export interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  action: string;
  href: string;
  tone: AttentionTone;
}

/**
 * The "Needs attention" list — the few things on this page that someone should actually do
 * something about, pulled from data the page already has.
 *
 * Each item is worded to match exactly what was measured. The mockup's "has never tracked
 * time" became "hasn't tracked today", because `teamOverview` reports one day and there is no
 * endpoint for lifetime-never-tracked; overstating it would send a manager after the wrong
 * person. Same reason the unrated-apps line says "of the top apps": `app-usage` returns a
 * top-N, so a total count of unrated apps is not knowable from here.
 */
export function attentionItems(input: {
  overview: TeamOverviewRow[];
  activity: TeamActivity;
  apps: TeamAppUsage;
  pendingApprovals: number;
  /**
   * Display cutoff: the idle share below which nobody is worth surfacing. This is a
   * presentation choice, NOT the team's configured policy — `TeamSettings` carries
   * `idleThresholdMinutes`, a duration, which is a different quantity from a share of tracked
   * time and is not comparable to it. The copy below is careful not to call this a threshold.
   */
  minIdlePct?: number;
}): AttentionItem[] {
  const { overview, activity, apps, pendingApprovals, minIdlePct = 10 } = input;
  const items: AttentionItem[] = [];

  const untracked = overview.filter((r) => r.trackedSecondsToday === 0);
  if (untracked.length > 0) {
    const names = untracked
      .slice(0, 3)
      .map((r) => r.name)
      .join(', ');
    const rest = untracked.length - Math.min(untracked.length, 3);
    items.push({
      id: 'untracked',
      title: `${untracked.length} ${untracked.length === 1 ? 'person hasn’t' : 'people haven’t'} tracked today`,
      detail: rest > 0 ? `${names} +${rest} more` : names,
      action: 'Review',
      href: '/reports',
      tone: 'bad',
    });
  }

  if (pendingApprovals > 0) {
    items.push({
      id: 'approvals',
      title: `${pendingApprovals} ${pendingApprovals === 1 ? 'timesheet' : 'timesheets'} waiting on you`,
      detail: 'Flagged weeks are held back from payroll export.',
      action: 'Review',
      href: '/approvals?status=PENDING',
      tone: 'warn',
    });
  }

  const worstIdle = [...activity.rows].sort((a, b) => b.idlePct - a.idlePct)[0];
  if (worstIdle && worstIdle.idlePct >= minIdlePct) {
    items.push({
      id: 'idle',
      title: `${worstIdle.name} idle ${worstIdle.idlePct}% of tracked time`,
      detail: `${worstIdle.idleMinutes}m idle · the highest share on the team this period`,
      action: 'Open',
      href: `/people/${worstIdle.userId}`,
      tone: 'warn',
    });
  }

  const unrated = apps.rows.filter((r) => r.category === 'NEUTRAL');
  if (unrated.length > 0) {
    const names = unrated
      .slice(0, 2)
      .map((r) => r.appName)
      .join(', ');
    const rest = unrated.length - Math.min(unrated.length, 2);
    items.push({
      id: 'unrated',
      title: `${unrated.length} of the top apps ${unrated.length === 1 ? 'is' : 'are'} unrated`,
      detail: rest > 0 ? `${names} +${rest} more` : names,
      action: 'Rate',
      href: '/admin/settings',
      tone: 'neutral',
    });
  }

  return items;
}
