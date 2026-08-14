/**
 * The ISO week the weekly emails report on: the LAST fully-closed one, never the week in
 * progress. Pure, so the boundary maths is unit-testable without a clock or a database.
 *
 * Monday-start UTC, byte-identical to the `date_trunc('week', ts AT TIME ZONE 'UTC')` the
 * timesheet generator uses (Postgres weeks are ISO/Monday-start). That equality matters: the
 * weekly summary counts PENDING rows by `periodStart`, and a one-day drift would count none.
 */

export interface ClosedWeek {
  /** Monday 00:00:00.000 UTC of the closed week. */
  periodStart: Date;
  /** The following Monday 00:00:00.000 UTC — half-open, matching TimesheetApproval.periodEnd. */
  periodEnd: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Monday 00:00 UTC of the week containing `at`. */
export function utcWeekStart(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 0, 0, 0, 0));
  // getUTCDay: 0=Sunday..6=Saturday. Shift so Monday is 0 and Sunday is 6.
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - mondayOffset * DAY_MS);
}

/** The most recent week that has fully ended as of `now`. */
export function closedWeek(now: Date): ClosedWeek {
  const currentWeekStart = utcWeekStart(now);
  const periodStart = new Date(currentWeekStart.getTime() - WEEK_MS);
  return { periodStart, periodEnd: currentWeekStart };
}

// Spelled out rather than via toLocaleString: Node's bundled ICU renders en-GB September as
// 'Sept', and which ICU build the container ships is not something an email subject should
// depend on. Three letters, every month, forever.
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Human label for the week, e.g. `3–9 Aug 2026`. `periodEnd` is exclusive, so the last day
 * shown is `periodEnd - 1 day` — printing the Monday itself would claim an eighth day.
 */
export function formatWeekRange(week: ClosedWeek): string {
  const last = new Date(week.periodEnd.getTime() - DAY_MS);
  const day = (d: Date) => String(d.getUTCDate());
  const month = (d: Date) => MONTHS[d.getUTCMonth()]!;
  const year = (d: Date) => String(d.getUTCFullYear());

  if (month(week.periodStart) === month(last)) {
    return `${day(week.periodStart)}–${day(last)} ${month(last)} ${year(last)}`;
  }
  if (year(week.periodStart) === year(last)) {
    return `${day(week.periodStart)} ${month(week.periodStart)} – ${day(last)} ${month(last)} ${year(last)}`;
  }
  return `${day(week.periodStart)} ${month(week.periodStart)} ${year(week.periodStart)} – ${day(last)} ${month(last)} ${year(last)}`;
}
