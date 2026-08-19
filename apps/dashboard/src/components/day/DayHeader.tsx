import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '../ui/Card';
import { buttonClasses } from '../ui/Button';
import { DayPicker } from './DayPicker';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shift a 'YYYY-MM-DD' UTC calendar day by `days` (may be negative). */
function shiftDateUTC(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

function formatDayLabel(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
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
  back,
}: {
  date: string;
  subjectName: string;
  isSelf: boolean;
  isToday: boolean;
  recordingNow: boolean;
  avatar?: ReactNode;
  /** Where this day view was opened from. Sits inline with the name, as in the handoff. */
  back?: { href: string; label: string };
}) {
  const prevDate = shiftDateUTC(date, -1);
  const nextDate = shiftDateUTC(date, 1);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          {back ? (
            <Link href={back.href} className={buttonClasses('secondary', 'xs')}>
              ← {back.label}
            </Link>
          ) : null}
          {avatar}
          <div>
            <h1 className="text-h2 font-display font-semibold tracking-[-0.01em]">{subjectName}</h1>
            <p className="text-text-secondary text-caption tt-numeric mt-0.5">
              {formatDayLabel(date)}
            </p>
          </div>
        </div>
        <div className="flex flex-none items-center gap-3">
          {recordingNow ? (
            <span className="text-recording text-caption flex items-center gap-1.5">
              <span
                className="bg-recording tt-pulse h-[7px] w-[7px] flex-none rounded-full"
                aria-hidden="true"
              />
              tracking now
            </span>
          ) : null}
          <DayPicker date={date} today={today} />
          <nav
            className="border-separator flex items-center gap-1 rounded-md border p-0.5"
            aria-label="Day navigation"
          >
            <Link
              href={`?date=${prevDate}`}
              className="text-text hover:bg-surface rounded px-2.5 py-1 text-label"
              aria-label="Previous day"
            >
              ‹
            </Link>
            <Link
              href={`?date=${today}`}
              className="text-text hover:bg-surface rounded px-2.5 py-1 text-label"
            >
              Today
            </Link>
            {isToday ? (
              <span
                aria-disabled="true"
                aria-label="Next day"
                className="text-text-secondary cursor-not-allowed rounded px-2.5 py-1 text-label opacity-40"
              >
                ›
              </span>
            ) : (
              <Link
                href={`?date=${nextDate}`}
                className="text-text hover:bg-surface rounded px-2.5 py-1 text-label"
                aria-label="Next day"
              >
                ›
              </Link>
            )}
          </nav>
        </div>
      </div>
      {isSelf ? (
        <Card className="flex items-start gap-2.5 px-[18px] py-3">
          <span
            className="bg-accent mt-[6px] h-[7px] w-[7px] flex-none rounded-full"
            aria-hidden="true"
          />
          <p className="text-label m-0">
            You’re viewing your own record — the same view your manager sees. Nothing here is hidden
            from you.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
