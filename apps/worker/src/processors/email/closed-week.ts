import { dayOf, dayStartInstant, shiftDay, weekStartDay } from '@timetrack/contracts';

/**
 * The ISO week the weekly emails report on: the LAST fully-closed one, never the week in
 * progress. Pure, so the boundary maths is unit-testable without a clock or a database.
 *
 * Monday 00:00 in APP_TIMEZONE, built from the same `weekStartDay` + `dayStartInstant` helpers
 * the dashboard and `/reports` use, and byte-identical to the
 * `date_trunc('week', ts AT TIME ZONE $tz) AT TIME ZONE $tz` the timesheet generator writes as
 * `TimesheetApproval.periodStart`. That equality matters: the weekly summary counts PENDING
 * rows by exact `periodStart`, and anchoring this to UTC instead (6h off) counted none.
 */

export interface ClosedWeek {
  /** The instant Monday 00:00 APP_TIMEZONE begins the closed week. */
  periodStart: Date;
  /** The following Monday 00:00 APP_TIMEZONE — half-open, matching TimesheetApproval.periodEnd. */
  periodEnd: Date;
}

/** The most recent week that has fully ended as of `now`. */
export function closedWeek(now: Date): ClosedWeek {
  const currentWeekStartDay = weekStartDay(dayOf(now));
  return {
    periodStart: dayStartInstant(shiftDay(currentWeekStartDay, -7)),
    periodEnd: dayStartInstant(currentWeekStartDay),
  };
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
 * Human label for the week, e.g. `3–9 Aug 2026`, in APP_TIMEZONE calendar days — the instants
 * themselves fall on the previous UTC day, so reading UTC fields here would mislabel the week.
 * `periodEnd` is exclusive, so the last day shown is the day before it — printing the Monday
 * itself would claim an eighth day.
 */
export function formatWeekRange(week: ClosedWeek): string {
  const first = dayOf(week.periodStart);
  const last = shiftDay(dayOf(week.periodEnd), -1);
  // 'YYYY-MM-DD' labels: slice rather than parse, so no zone can creep back in.
  const day = (d: string) => String(Number(d.slice(8, 10)));
  const month = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1]!;
  const year = (d: string) => d.slice(0, 4);

  if (month(first) === month(last)) {
    return `${day(first)}–${day(last)} ${month(last)} ${year(last)}`;
  }
  if (year(first) === year(last)) {
    return `${day(first)} ${month(first)} – ${day(last)} ${month(last)} ${year(last)}`;
  }
  return `${day(first)} ${month(first)} ${year(first)} – ${day(last)} ${month(last)} ${year(last)}`;
}
