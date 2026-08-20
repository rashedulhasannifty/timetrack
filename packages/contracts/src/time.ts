/**
 * The organisation's single time zone. Every day boundary in the product — dashboard
 * navigation, API day series, the worker's daily rollup — is a calendar day in THIS zone.
 *
 * Deliberately org-wide, not per-user (spec §2): a per-user zone would mean the rollup can
 * no longer store one `activity_daily_summaries` row per user-day.
 *
 * These helpers derive the offset from the zone via `Intl` rather than assuming +06:00, so
 * they stay correct if this constant is ever changed to a zone that observes DST. Bangladesh
 * does not currently observe DST, so no fold/gap case arises today.
 */
export const APP_TIMEZONE = 'Asia/Dhaka';

// en-CA formats as YYYY-MM-DD, which is exactly our day-label shape.
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// hourCycle 'h23' pins midnight to 00, not 24 (which some ICU builds emit for hour12:false).
const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The 'YYYY-MM-DD' Dhaka calendar day containing `instant`. */
export function dayOf(instant: Date): string {
  return DAY_FORMAT.format(instant);
}

/** 'HH:MM' Dhaka wall-clock time for `instant`, 24-hour. */
export function clockOf(instant: Date): string {
  return CLOCK_FORMAT.format(instant);
}

/** True when `day` is a 'YYYY-MM-DD' string naming a real calendar date. */
export function isValidDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return false;
  // Date.parse accepts 2026-02-30 in some engines by rolling over; round-trip to reject it.
  return new Date(ms).toISOString().slice(0, 10) === day;
}

/**
 * Shift a 'YYYY-MM-DD' day label by `days`. Pure calendar arithmetic on the label — no zone
 * is involved, because a label is not an instant.
 *
 * Precondition: `day` must satisfy `isValidDay`. Throws a `RangeError` otherwise, rather than
 * silently returning a plausible-looking but wrong day label.
 */
export function shiftDay(day: string, days: number): string {
  if (!isValidDay(day)) throw new RangeError(`shiftDay: not a YYYY-MM-DD day: ${day}`);
  const parts = day.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const dayOfMonth = Number(parts[2]);
  return new Date(Date.UTC(year, month - 1, dayOfMonth + days)).toISOString().slice(0, 10);
}

/** The UTC instant at which the Dhaka day `day` begins. */
export function dayStartInstant(day: string): Date {
  if (!isValidDay(day)) throw new RangeError(`dayStartInstant: not a YYYY-MM-DD day: ${day}`);
  // Treat the label as if it were UTC midnight, then walk back by the zone's offset. Applying
  // the offset a second time at the candidate instant settles any DST transition; for a
  // fixed-offset zone the second pass is a no-op.
  const asUtcMidnight = new Date(`${day}T00:00:00.000Z`);
  const candidate = new Date(asUtcMidnight.getTime() - offsetMsAt(asUtcMidnight));
  return new Date(asUtcMidnight.getTime() - offsetMsAt(candidate));
}

/** How far ahead of UTC `APP_TIMEZONE` runs at `at`, in milliseconds. */
function offsetMsAt(at: Date): number {
  const parts = PARTS_FORMAT.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`offsetMsAt: missing ${type} part`);
    return Number(found.value);
  };
  const wallClockAsUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  // Compare against `at` truncated to whole seconds — the formatted parts carry no millis.
  return wallClockAsUtc - (at.getTime() - at.getMilliseconds());
}
