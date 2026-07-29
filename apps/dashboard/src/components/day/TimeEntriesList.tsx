import type { DayEntryRow } from '../../lib/person-day-view';
import { formatDuration, formatTimeRange } from '../../lib/format';

/**
 * Upgraded `Timeline`: takes the transform's `DayEntryRow[]` (epoch ms, precomputed duration,
 * a `running` flag) instead of raw `TimeEntry[]`, so it never re-derives open/closed state.
 * The leading dot is a fixed category-neutral color — this list carries no per-entry category
 * (that lives on the ribbon blocks), so it stays a plain marker rather than implying one.
 */
export function TimeEntriesList({ entries }: { entries: DayEntryRow[] }) {
  if (entries.length === 0) {
    return <p className="text-text-secondary text-body">No entries in range.</p>;
  }
  return (
    <ul className="flex flex-col">
      {entries.map((e) => (
        <li key={e.id} className="border-separator flex items-center gap-3.5 border-b py-3">
          <span className="tt-numeric w-[132px] flex-none text-[13px] text-text-secondary">
            {formatTimeRange(
              new Date(e.startMs).toISOString(),
              e.endMs === null ? null : new Date(e.endMs).toISOString(),
            )}
          </span>
          <span className="bg-category-neutral h-[9px] w-[9px] flex-none rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px]">{e.label}</div>
          </div>
          <span className="tt-numeric flex-none text-[13px]">
            {e.running ? 'running' : formatDuration(e.durationSeconds)}
          </span>
        </li>
      ))}
    </ul>
  );
}
