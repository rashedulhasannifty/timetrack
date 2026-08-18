import type { TeamAppUsage } from '@timetrack/contracts';
import type { AppUsageItem } from './overview-view';

/** How many apps a single day's panel shows before it stops being a list and starts being noise. */
export const DAY_APP_LIMIT = 8;

/**
 * Rows for one person's day, longest first.
 *
 * `pct` is the row's time relative to the BUSIEST row, not to the day — it drives a bar length,
 * so the longest app always fills the track and the rest are read against it. Treating it as a
 * share of tracked time would be wrong: the API returns the top N apps, and their sum is not
 * the day.
 */
export function dayAppUsage(usage: TeamAppUsage, limit = DAY_APP_LIMIT): AppUsageItem[] {
  const rows = [...usage.rows].sort((a, b) => b.seconds - a.seconds).slice(0, limit);
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  return rows.map((r) => ({
    appName: r.appName,
    seconds: r.seconds,
    category: r.category,
    pct: (r.seconds / max) * 100,
  }));
}
