import type { ActivityDailySummary } from '@timetrack/contracts';
import type { DailyActivityPoint } from '../components/charts/ActivityDailyChart';

const CATEGORY_ORDER = ['PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE'] as const;
export type ActivityCategory = (typeof CATEGORY_ORDER)[number];

export interface AppSlice {
  name: string;
  minutes: number;
  /** Share of the busiest app's minutes, 0..100 — drives the bar width. */
  pct: number;
}

export interface CategorySlice {
  category: ActivityCategory;
  minutes: number;
  /** Share of total categorized minutes, 0..100. */
  pct: number;
}

const DAY_MS = 86_400_000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC window of `days` calendar days ending *yesterday* (rollups never cover today). */
export function activitySummaryWindow(now: Date, days = 7): { from: string; to: string } {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: isoDate(todayUtc - DAY_MS * days), // `days` days back, inclusive of `to`
    to: isoDate(todayUtc - DAY_MS), // yesterday
  };
}

/** One point per calendar day in [from, to], zero-filling days without a summary. */
export function toDailyActivityPoints(
  summaries: ActivityDailySummary[],
  from: string,
  to: string,
): DailyActivityPoint[] {
  const byDay = new Map(summaries.map((s) => [s.day, s.avgActivityPct]));
  const points: DailyActivityPoint[] = [];
  const end = Date.parse(`${to}T00:00:00.000Z`);
  for (let cursor = Date.parse(`${from}T00:00:00.000Z`); cursor <= end; cursor += DAY_MS) {
    const day = isoDate(cursor);
    points.push({ label: day.slice(5), activityPct: byDay.get(day) ?? 0 });
  }
  return points;
}

/** Sum per-app minutes across the window, busiest first, capped at `topN`. */
export function aggregateApps(summaries: ActivityDailySummary[], topN = 6): AppSlice[] {
  const totals = new Map<string, number>();
  for (const s of summaries) {
    for (const [name, min] of Object.entries(s.byApp)) {
      totals.set(name, (totals.get(name) ?? 0) + min);
    }
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, topN);
  const max = top[0]?.[1] ?? 0;
  return top.map(([name, minutes]) => ({
    name,
    minutes,
    pct: max === 0 ? 0 : Math.round((minutes / max) * 100),
  }));
}

/** Sum per-category minutes across the window in a fixed order, with total shares. */
export function aggregateCategories(summaries: ActivityDailySummary[]): CategorySlice[] {
  const totals: Record<ActivityCategory, number> = { PRODUCTIVE: 0, NEUTRAL: 0, UNPRODUCTIVE: 0 };
  for (const s of summaries) {
    for (const [cat, min] of Object.entries(s.byCategory)) {
      if (cat in totals) totals[cat as ActivityCategory] += min;
    }
  }
  const sum = totals.PRODUCTIVE + totals.NEUTRAL + totals.UNPRODUCTIVE;
  return CATEGORY_ORDER.map((category) => ({
    category,
    minutes: totals[category],
    pct: sum === 0 ? 0 : Math.round((totals[category] / sum) * 100),
  }));
}

export function totalActiveMinutes(summaries: ActivityDailySummary[]): number {
  return summaries.reduce((acc, s) => acc + s.activeMinutes, 0);
}
