import Link from 'next/link';
import { Card } from '../ui/Card';

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
 * Day-view chrome shared by `/me` and `people/[userId]`: date navigation (prev / today / next
 * as query-string `<Link>`s — the URL is the state, no client component needed), the
 * "Recording now" pill (today + an open entry), and the self-only reassurance banner.
 */
export function DayHeader({
  date,
  subjectName,
  isSelf,
  isToday,
  recordingNow,
}: {
  date: string;
  subjectName: string;
  isSelf: boolean;
  isToday: boolean;
  recordingNow: boolean;
}) {
  const prevDate = shiftDateUTC(date, -1);
  const nextDate = shiftDateUTC(date, 1);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h1 font-display font-semibold">{subjectName}</h1>
          <p className="text-text-secondary text-label mt-0.5">{formatDayLabel(date)}</p>
        </div>
        <div className="flex flex-none items-center gap-3">
          {recordingNow ? (
            <span className="bg-recording/12 text-recording flex items-center gap-1.5 rounded-full px-3 py-1 text-label font-medium">
              <span
                className="bg-recording h-[7px] w-[7px] flex-none rounded-full"
                aria-hidden="true"
              />
              Recording now
            </span>
          ) : null}
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
