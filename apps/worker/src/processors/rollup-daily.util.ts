import { dayOf, dayStartInstant, shiftDay } from '@timetrack/contracts';

/** Pure Dhaka-day window math for the daily rollup — unit-tested without a DB. */

export interface DhakaWindow {
  /**
   * What gets STORED in `activity_daily_summaries.day` (`@db.Date`). Prisma persists the UTC
   * date part of a JS Date, so this must be UTC midnight of the day's NAME — not the instant
   * the Dhaka day begins, which would persist the previous date.
   */
  dayLabel: Date;
  /** UTC instant the Dhaka day begins (inclusive). */
  from: Date;
  /** UTC instant the Dhaka day ends (exclusive). */
  to: Date;
}

export function dhakaWindow(day: string): DhakaWindow {
  return {
    dayLabel: new Date(`${day}T00:00:00.000Z`),
    from: dayStartInstant(day),
    to: dayStartInstant(shiftDay(day, 1)),
  };
}

/** The Dhaka day before the one containing `now`. */
export function previousDhakaDay(now: Date): string {
  return shiftDay(dayOf(now), -1);
}
