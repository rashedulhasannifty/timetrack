import type { TimeEntry } from '@timetrack/contracts';
import { formatDuration, formatTimeRange } from '../../lib/format';

/**
 * A person's time entries as a vertical list. Types come from @timetrack/contracts —
 * never a hand-written response interface (CLAUDE.md §4).
 */
export function Timeline({ entries }: { entries: TimeEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-text-secondary text-body">No entries in range.</p>;
  }
  return (
    <ul className="flex flex-col">
      {entries.map((e) => {
        const durationLabel = e.endTime
          ? formatDuration(Math.round((Date.parse(e.endTime) - Date.parse(e.startTime)) / 1000))
          : 'running';
        return (
          <li key={e.id} className="border-separator flex items-center gap-3.5 border-b py-3">
            <span className="tt-numeric w-[132px] flex-none text-[13px] text-text-secondary">
              {formatTimeRange(e.startTime, e.endTime)}
            </span>
            <span className="bg-separator h-[9px] w-[9px] flex-none rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px]">{e.note ?? 'Untitled entry'}</div>
            </div>
            <span className="tt-numeric flex-none text-[13px]">{durationLabel}</span>
          </li>
        );
      })}
    </ul>
  );
}
