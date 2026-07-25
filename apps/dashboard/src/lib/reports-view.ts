import type { ProjectSummaryRow, TeamSummaryRow } from '@timetrack/contracts';

const DAY_MS = 86_400_000;

/** Last 7 UTC days, inclusive of the day `now` falls in. */
export function defaultReportRange(now: Date): { from: string; to: string } {
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const from = new Date(dayStart.getTime() - 6 * DAY_MS);
  const to = new Date(dayStart.getTime() + DAY_MS - 1); // ...T23:59:59.999Z
  return { from: from.toISOString(), to: to.toISOString() };
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
