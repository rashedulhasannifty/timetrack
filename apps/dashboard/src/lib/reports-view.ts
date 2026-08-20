import type { ProjectSummaryRow, TeamSummaryRow } from '@timetrack/contracts';
import { dayOf, dayStartInstant, isValidDay, shiftDay } from '@timetrack/contracts';

const DAY_MS = 86_400_000;

/** Last 7 Dhaka days, inclusive of the day `now` falls in. */
export function defaultReportRange(now: Date): { from: string; to: string } {
  const dayStart = dayStartInstant(dayOf(now));
  const from = new Date(dayStart.getTime() - 6 * DAY_MS);
  const to = new Date(dayStart.getTime() + DAY_MS - 1); // ...end of the Dhaka day
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Widen a `<input type="date">` value ('YYYY-MM-DD') to the ISO instant bound
 * `ReportRangePicker` writes into the URL for `from`/`to`. `reports.repository.ts` filters
 * with `startTime < to` (exclusive), but this deliberately uses the same "1ms before the next
 * Dhaka day" encoding as `defaultReportRange` above rather than the bare exclusive boundary —
 * both are functionally identical against a strict `<`, and picking the same day in the UI
 * should always produce the same `to` value regardless of which of the two callers built it.
 *
 * Returns `null` for a value that isn't a real calendar day (an empty/cleared date input, or a
 * bad paste) — the caller should skip the update rather than let `dayStartInstant`/`shiftDay`
 * throw on it from a client `onChange` handler.
 */
export function reportRangeBound(dateOnly: string, key: 'from' | 'to'): string | null {
  if (!isValidDay(dateOnly)) return null;
  if (key === 'from') return dayStartInstant(dateOnly).toISOString();
  return new Date(dayStartInstant(shiftDay(dateOnly, 1)).getTime() - 1).toISOString();
}

export function toProjectBars(rows: ProjectSummaryRow[]): { name: string; hours: number }[] {
  return rows.map((r) => ({
    name: r.name,
    hours: Math.round((r.trackedSeconds / 3600) * 10) / 10,
  }));
}

export function hasReportData(team: TeamSummaryRow[], projects: ProjectSummaryRow[]): boolean {
  return team.length > 0 || projects.length > 0;
}

/** Pure, stable sort of team rows by column; does not mutate `rows`. */
export function sortTeamRows(
  rows: TeamSummaryRow[],
  key: 'name' | 'trackedSeconds' | 'activityPct',
  dir: 'asc' | 'desc',
): TeamSummaryRow[] {
  const sorted = [...rows].sort((a, b) => {
    const cmp = key === 'name' ? a.name.localeCompare(b.name) : a[key] - b[key];
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}
