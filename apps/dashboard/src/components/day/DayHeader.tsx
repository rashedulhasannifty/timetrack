import Link from 'next/link';
import type { ReactNode } from 'react';
import { APP_TIMEZONE, dayOf, dayStartInstant, shiftDay } from '@timetrack/contracts';
import { Card } from '../ui/Card';
import { DayPicker } from './DayPicker';

function formatDayLabel(date: string): string {
  return dayStartInstant(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: APP_TIMEZONE,
  });
}

/**
 * Day-view chrome shared by `/me` and `people/[userId]`: a date picker plus prev / today / next
 * navigation (query-string `<Link>`s — the URL is the state), the "Recording now" pill (today +
 * an open entry), and the self-only reassurance banner.
 *
 * The arrows alone made this look like a filter permanently stuck on today: the middle control
 * is a fixed "Today" action, not a label, and reaching a date weeks back meant clicking ‹ dozens
 * of times. DayPicker is the only client component here; the rest stays server-rendered.
 */
export function DayHeader({
  date,
  subjectName,
  isSelf,
  isToday,
  recordingNow,
  avatar,
}: {
  date: string;
  subjectName: string;
  isSelf: boolean;
  isToday: boolean;
  recordingNow: boolean;
  avatar?: ReactNode;
}) {
  const prevDate = shiftDay(date, -1);
  const nextDate = shiftDay(date, 1);
  const today = dayOf(new Date());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          {avatar}
          <div>
            <h2 className="text-h2 font-display font-extrabold tracking-[-0.02em]">
              {subjectName}
            </h2>
            <p className="text-text-secondary text-caption tt-numeric mt-0.5">
              {formatDayLabel(date)}
            </p>
          </div>
        </div>
        <div className="flex flex-none items-center gap-3">
          {recordingNow ? (
            <span className="bg-tint text-accent text-caption flex items-center gap-1.5 rounded-full px-3 py-1 font-bold">
              <span
                className="bg-accent tt-pulse h-[6px] w-[6px] flex-none rounded-full"
                aria-hidden="true"
              />
              Tracking
            </span>
          ) : null}
          <DayPicker date={date} today={today} />
          <nav
            className="border-separator bg-surface-raised shadow-e1 flex items-center gap-1 rounded-full border p-0.5"
            aria-label="Day navigation"
          >
            <Link
              href={`?date=${prevDate}`}
              className="text-text hover:bg-surface text-caption rounded-full px-2.5 py-1 font-semibold"
              aria-label="Previous day"
            >
              ‹
            </Link>
            <Link
              href={`?date=${today}`}
              className="text-text hover:bg-surface text-caption rounded-full px-2.5 py-1 font-semibold"
            >
              Today
            </Link>
            {isToday ? (
              <span
                aria-disabled="true"
                aria-label="Next day"
                className="text-text-secondary text-caption cursor-not-allowed rounded-full px-2.5 py-1 font-semibold opacity-40"
              >
                ›
              </span>
            ) : (
              <Link
                href={`?date=${nextDate}`}
                className="text-text hover:bg-surface text-caption rounded-full px-2.5 py-1 font-semibold"
                aria-label="Next day"
              >
                ›
              </Link>
            )}
          </nav>
        </div>
      </div>
      {isSelf ? (
        <Card padding="md" className="flex items-start gap-2.5">
          <span
            className="bg-accent mt-[7px] h-[7px] w-[7px] flex-none rounded-full"
            aria-hidden="true"
          />
          <p className="text-body m-0">
            You’re viewing your own record — the same view your manager sees. Nothing here is hidden
            from you.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
