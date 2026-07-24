import type { TimeEntry } from '@timetrack/contracts';
import { formatTimeRange } from '../../lib/format';

/**
 * A person's time entries as a vertical list. Types come from @timetrack/contracts —
 * never a hand-written response interface (CLAUDE.md §4).
 */
export function Timeline({ entries }: { entries: TimeEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-text-secondary text-body">No entries in range.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => (
        <li
          key={e.id}
          className="bg-surface-raised border-separator text-body rounded-md border px-3 py-2"
        >
          <span className="font-medium">{formatTimeRange(e.startTime, e.endTime)}</span>
          {e.note ? <span className="text-text-secondary ml-2">{e.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}
