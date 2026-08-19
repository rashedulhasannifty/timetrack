import Link from 'next/link';
import type { WeekStripDay } from '../../lib/person-day-view';

/**
 * The seven days of the viewed day's week, each with a mini fill bar. Clicking one moves the
 * whole day view to it — the same `?date=` the arrows use, so the URL stays the state.
 *
 * A future day is rendered as inert text rather than a link: it can't have data, and offering
 * it as a destination invites a click that lands on an empty day.
 */
export function WeekStrip({ days }: { days: WeekStripDay[] }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Week">
      {days.map((d) => {
        const inner = (
          <>
            <span className="text-[9.5px] font-bold tracking-wide">{d.dow}</span>
            <span
              aria-hidden="true"
              className="bg-separator relative h-3.5 w-4 overflow-hidden rounded-[3px]"
            >
              <span
                className="bg-accent absolute inset-x-0 bottom-0"
                style={{ height: `${d.fillPct}%` }}
              />
            </span>
            <span className="tt-numeric text-[10px]">{d.num}</span>
          </>
        );
        const shell = `flex w-[34px] flex-col items-center gap-[3px] rounded-[9px] border py-[5px] ${
          d.selected ? 'border-accent bg-tint text-accent' : 'border-separator text-text-secondary'
        }`;
        if (d.future) {
          return (
            <span key={d.date} className={`${shell} opacity-40`} aria-disabled="true">
              {inner}
            </span>
          );
        }
        return (
          <Link
            key={d.date}
            href={`?date=${d.date}`}
            aria-current={d.selected ? 'date' : undefined}
            aria-label={`${d.date} — ${d.hours}h tracked`}
            className={`${shell} hover:border-text-secondary transition-colors`}
          >
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
